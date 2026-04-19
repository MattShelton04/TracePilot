//! Micro-benchmark: SQLite multi-row INSERT batch size tuning.
//!
//! Measures the end-to-end cost of inserting N rows using varying chunk sizes.
//! The 9-column schema mirrors `conversation_turns` — the widest child table in
//! the indexer. A fully explicit SAVEPOINT/RELEASE wraps the batch, matching
//! the real code path.
//!
//! Run:
//!   cargo bench -p tracepilot-bench --bench batch_size
//!
//! To compare two sizes directly:
//!   cargo bench -p tracepilot-bench --bench batch_size -- chunk_100_rows_500

use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use rusqlite::{Connection, ToSql, params_from_iter};
use tracepilot_core::utils::sqlite::build_placeholder_sql;

const SQL_PREFIX: &str =
    "INSERT INTO turns (session_id,turn_index,role,content,ts,model,tokens_in,tokens_out,cost) VALUES";
const COLS: usize = 9;

fn make_row(i: i64) -> (i64, i64, String, String, i64, String, i64, i64, f64) {
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

fn setup_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE turns (
            session_id INTEGER,
            turn_index INTEGER,
            role TEXT,
            content TEXT,
            ts INTEGER,
            model TEXT,
            tokens_in INTEGER,
            tokens_out INTEGER,
            cost REAL
        )",
    )
    .unwrap();
    conn
}

/// Run one INSERT batch of `total_rows` using the given `chunk_size`.
fn run_batch(conn: &Connection, rows: &[(i64, i64, String, String, i64, String, i64, i64, f64)], chunk_size: usize) {
    conn.execute_batch("BEGIN").unwrap();
    for chunk in rows.chunks(chunk_size) {
        let sql = build_placeholder_sql(SQL_PREFIX, chunk.len(), COLS);
        let mut stmt = conn.prepare(&sql).unwrap();
        let mut params: Vec<&dyn ToSql> = Vec::with_capacity(chunk.len() * COLS);
        for (sid, ti, role, content, ts, model, tin, tout, cost) in chunk {
            params.push(sid);
            params.push(ti);
            params.push(role);
            params.push(content);
            params.push(ts);
            params.push(model);
            params.push(tin);
            params.push(tout);
            params.push(cost);
        }
        stmt.execute(params_from_iter(params.iter().copied())).unwrap();
    }
    conn.execute_batch("ROLLBACK").unwrap();
}

fn bench_batch_sizes(c: &mut Criterion) {
    // Chunk sizes to evaluate (all valid for 9-col table: max = 32766/9 = 3640)
    let chunk_sizes: &[usize] = &[10, 25, 50, 100, 200, 500, 1000];
    // Total row counts to test (typical session sizes)
    let row_counts: &[usize] = &[50, 200, 500, 1000];

    for &total_rows in row_counts {
        let mut group = c.benchmark_group(format!("chunk_{total_rows}_rows"));
        group.throughput(Throughput::Elements(total_rows as u64));

        // Pre-build the row data outside the benchmark loop
        let rows: Vec<_> = (0..total_rows as i64).map(make_row).collect();

        for &chunk_size in chunk_sizes {
            group.bench_with_input(
                BenchmarkId::from_parameter(chunk_size),
                &chunk_size,
                |b, &cs| {
                    let conn = setup_db();
                    b.iter(|| run_batch(&conn, &rows, cs));
                },
            );
        }
        group.finish();
    }
}

criterion_group!(benches, bench_batch_sizes);
criterion_main!(benches);
