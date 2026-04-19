//! Micro-benchmark: SQLite multi-row INSERT batch size tuning.
//!
//! Two benches, reflecting the two real call sites:
//!
//! **`bench_session_writer`** — analytics child tables (session_model_metrics etc).
//! Schema: 9 columns (widest child table). Row counts: 5–100 (aggregate rows,
//! not per-event). Here chunk size barely matters; included for completeness.
//!
//! **`bench_search_writer`** — the actual hot path. Schema: 8 columns
//! (`search_content`). Row counts: 500–20 000, reflecting sessions with
//! 1k–40k+ events (roughly 1 searchable row per 2 events). With 10k+ events
//! per session being common, this is where chunk size selection matters.
//!
//! Run:
//!   cargo bench -p tracepilot-bench --bench batch_size
//!
//! To compare a specific group:
//!   cargo bench -p tracepilot-bench --bench batch_size -- search_writer

use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use rusqlite::{Connection, ToSql, params_from_iter};
use tracepilot_core::utils::sqlite::build_placeholder_sql;

// ── session_writer schema (9 cols, small row counts) ────────────────────────

const SESSION_SQL_PREFIX: &str =
    "INSERT INTO turns (session_id,turn_index,role,content,ts,model,tokens_in,tokens_out,cost) VALUES";
const SESSION_COLS: usize = 9;

type SessionRow = (i64, i64, String, String, i64, String, i64, i64, f64);

fn make_session_row(i: i64) -> SessionRow {
    (
        i % 100,
        i,
        "user".to_owned(),
        format!("content_{i}"),
        1_700_000_000 + i,
        "gpt-4".to_owned(),
        128,
        256,
        0.001,
    )
}

fn setup_session_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE turns (
            session_id INTEGER, turn_index INTEGER, role TEXT,
            content TEXT, ts INTEGER, model TEXT,
            tokens_in INTEGER, tokens_out INTEGER, cost REAL
        )",
    )
    .unwrap();
    conn
}

fn run_session_batch(conn: &Connection, rows: &[SessionRow], chunk_size: usize) {
    conn.execute_batch("BEGIN").unwrap();
    for chunk in rows.chunks(chunk_size) {
        let sql = build_placeholder_sql(SESSION_SQL_PREFIX, chunk.len(), SESSION_COLS);
        let mut stmt = conn.prepare(&sql).unwrap();
        let mut params: Vec<&dyn ToSql> = Vec::with_capacity(chunk.len() * SESSION_COLS);
        for (sid, ti, role, content, ts, model, tin, tout, cost) in chunk {
            params.push(sid); params.push(ti); params.push(role);
            params.push(content); params.push(ts); params.push(model);
            params.push(tin); params.push(tout); params.push(cost);
        }
        stmt.execute(params_from_iter(params.iter().copied())).unwrap();
    }
    conn.execute_batch("ROLLBACK").unwrap();
}

// ── search_writer schema (8 cols, large row counts) ──────────────────────────
//
// `search_content` is the real hot path: one row per searchable event chunk.
// With 10k+ events per session being common, this is where batch size matters.
//
// Max chunk size for 8 cols: 32766 / 8 = 4095 rows.

const SEARCH_SQL_PREFIX: &str =
    "INSERT INTO search_content \
     (session_id, content_type, turn_number, event_index, \
      timestamp_unix, tool_name, content, metadata_json) VALUES";
const SEARCH_COLS: usize = 8;

type SearchRow = (String, &'static str, Option<i64>, i64, Option<i64>, Option<String>, String, Option<String>);

fn make_search_row(i: i64) -> SearchRow {
    (
        format!("session-{:04}", i % 10),
        "tool_call",
        Some(i / 10),
        i,
        Some(1_700_000_000 + i),
        Some("read_file".to_owned()),
        format!("Extracted content for event {} with some realistic length text here", i),
        None,
    )
}

fn setup_search_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE search_content (
            id INTEGER PRIMARY KEY,
            session_id TEXT, content_type TEXT, turn_number INTEGER,
            event_index INTEGER, timestamp_unix INTEGER,
            tool_name TEXT, content TEXT, metadata_json TEXT
        )",
    )
    .unwrap();
    conn
}

fn run_search_batch(conn: &Connection, rows: &[SearchRow], chunk_size: usize) {
    conn.execute_batch("BEGIN").unwrap();
    for chunk in rows.chunks(chunk_size) {
        let sql = build_placeholder_sql(SEARCH_SQL_PREFIX, chunk.len(), SEARCH_COLS);
        let mut stmt = conn.prepare(&sql).unwrap();
        let mut params: Vec<&dyn ToSql> = Vec::with_capacity(chunk.len() * SEARCH_COLS);
        for (sid, ct, tn, ei, ts, tool, content, meta) in chunk {
            params.push(sid);
            params.push(ct as &dyn ToSql);
            match tn { Some(n) => params.push(n), None => params.push(&rusqlite::types::Null) }
            params.push(ei);
            match ts { Some(n) => params.push(n), None => params.push(&rusqlite::types::Null) }
            match tool { Some(s) => params.push(s), None => params.push(&rusqlite::types::Null) }
            params.push(content);
            match meta { Some(s) => params.push(s), None => params.push(&rusqlite::types::Null) }
        }
        stmt.execute(params_from_iter(params.iter().copied())).unwrap();
    }
    conn.execute_batch("ROLLBACK").unwrap();
}

// ── Benchmarks ───────────────────────────────────────────────────────────────

fn bench_session_writer(c: &mut Criterion) {
    // These are aggregate rows (not per-event). Even large sessions rarely exceed ~100 rows.
    let chunk_sizes: &[usize] = &[10, 25, 50, 100];
    let row_counts: &[usize] = &[5, 20, 50, 100];

    for &total_rows in row_counts {
        let mut group = c.benchmark_group(format!("session_writer/{total_rows}_rows"));
        group.throughput(Throughput::Elements(total_rows as u64));
        let rows: Vec<_> = (0..total_rows as i64).map(make_session_row).collect();
        for &chunk_size in chunk_sizes {
            group.bench_with_input(
                BenchmarkId::from_parameter(chunk_size),
                &chunk_size,
                |b, &cs| {
                    let conn = setup_session_db();
                    b.iter(|| run_session_batch(&conn, &rows, cs));
                },
            );
        }
        group.finish();
    }
}

fn bench_search_writer(c: &mut Criterion) {
    // Row counts reflecting real sessions:
    // ~500 rows → ~1k events (quick session)
    // ~2500 rows → ~5k events (standard agent session)
    // ~5000 rows → ~10k events (heavy session, user says "common")
    // ~10000 rows → ~20k events (large refactor)
    // Max safe chunk for 8 cols: 32766/8 = 4095
    let chunk_sizes: &[usize] = &[25, 50, 100, 200, 500, 1000, 2000, 4000];
    let row_counts: &[usize] = &[500, 2500, 5000, 10_000];

    for &total_rows in row_counts {
        let mut group = c.benchmark_group(format!("search_writer/{total_rows}_rows"));
        group.sample_size(20); // fewer samples for large row counts
        group.throughput(Throughput::Elements(total_rows as u64));
        let rows: Vec<_> = (0..total_rows as i64).map(make_search_row).collect();
        for &chunk_size in chunk_sizes {
            group.bench_with_input(
                BenchmarkId::from_parameter(chunk_size),
                &chunk_size,
                |b, &cs| {
                    let conn = setup_search_db();
                    b.iter(|| run_search_batch(&conn, &rows, cs));
                },
            );
        }
        group.finish();
    }
}

criterion_group!(benches, bench_session_writer, bench_search_writer);
criterion_main!(benches);
