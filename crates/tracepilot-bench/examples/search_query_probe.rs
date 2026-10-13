//! Frozen search-index fixture and read-only query probe.
//!
//! Build with `cargo build --release -p tracepilot-bench --example search_query_probe`.
//! `generate <new-db> [sessions=600] [rows-per-session=500]` creates a synthetic
//! search workload through the production schema and search writer.
//! `measure <db> [repeats=7]` measures result pages including their exact count,
//! counts alone and facets. Each operation includes an output digest so copied
//! base/head executables can check parity on the same frozen database.
//! Timings exclude output hashing; this is a library probe, not desktop IPC.

#![allow(clippy::print_stdout, clippy::print_stderr)]

use std::fmt::Debug;
use std::path::Path;
use std::time::Instant;

use rusqlite::params;
use serde_json::{Value, json};
use tracepilot_core::SessionId;
use tracepilot_core::provider::SessionSource;
use tracepilot_indexer::SearchFilters;
use tracepilot_indexer::index_db::IndexDb;
use tracepilot_indexer::index_db::search_writer::SearchContentRow;

type AnyError = Box<dyn std::error::Error>;

fn main() {
    if let Err(error) = run() {
        eprintln!("search_query_probe: {error}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), AnyError> {
    let args: Vec<String> = std::env::args().collect();
    let path = args.get(2).map(Path::new).ok_or("missing database path")?;
    let report = match args.get(1).map(String::as_str) {
        Some("generate") => generate(path, positive(&args, 3, 600)?, positive(&args, 4, 500)?)?,
        Some("measure") => measure(path, positive(&args, 3, 7)?)?,
        _ => return Err("usage: search_query_probe generate <new-db> [sessions] [rows-per-session] | measure <db> [repeats]".into()),
    };
    println!("{}", serde_json::to_string(&report)?);
    Ok(())
}

fn positive(args: &[String], index: usize, default: usize) -> Result<usize, AnyError> {
    let value = args
        .get(index)
        .map(|v| v.parse())
        .transpose()?
        .unwrap_or(default);
    if value == 0 {
        return Err("sizes and repeats must be positive".into());
    }
    Ok(value)
}

fn generate(path: &Path, sessions: usize, rows_per_session: usize) -> Result<Value, AnyError> {
    if path.exists() {
        return Err("generation requires a new database path".into());
    }
    let expected_rows = sessions
        .checked_mul(rows_per_session)
        .ok_or("fixture size overflow")?;
    let db = IndexDb::open_or_create(path)?;
    let mut conn = rusqlite::Connection::open(path)?;
    tracepilot_core::utils::sqlite::configure_connection(&conn)?;
    let tx = conn.transaction()?;
    for session in 0..sessions {
        let id = session_id(session);
        tx.execute(
            "INSERT INTO sessions (id, path, summary, repository, updated_at, turn_count)
             VALUES (?1, 'synthetic/search', 'Synthetic search session', ?2,
                     '2026-01-31T12:00:00Z', ?3)",
            params![
                id,
                format!("synthetic/repository-{}", session % 10),
                rows_per_session
            ],
        )?;
    }
    tx.commit()?;
    for session in 0..sessions {
        let id = session_id(session);
        let rows: Vec<_> = (0..rows_per_session)
            .map(|index| {
                let absolute = session * rows_per_session + index;
                let content_type = [
                    "user_message",
                    "assistant_message",
                    "tool_call",
                    "tool_result",
                ][index % 4];
                SearchContentRow {
                    session_id: id.clone(),
                    content_type,
                    turn_number: Some((index / 4) as i64),
                    event_index: index as i64,
                    timestamp_unix: Some(1_767_225_600 + absolute as i64),
                    tool_name: (index % 4 >= 2)
                        .then(|| ["read_file", "edit_file", "powershell"][index % 3].to_string()),
                    content: format!(
                        "benchmark synthetic session {session} event {index} {} {}",
                        if absolute.is_multiple_of(4096) {
                            "needle"
                        } else {
                            "ordinary"
                        },
                        "Read source, review the change, and run the focused validation. "
                            .repeat(4)
                    ),
                    metadata_json: None,
                }
            })
            .collect();
        db.upsert_search_content(&SessionId::from_validated(id), &rows)?;
    }
    // Relabel after writing through the Copilot writer, matching mixed-source
    // search tests; source metadata does not change the stored search text.
    conn.execute(
        "UPDATE sessions SET source = 'claudeCode' WHERE rowid % 5 = 0",
        [],
    )?;
    conn.execute_batch("ANALYZE; PRAGMA wal_checkpoint(TRUNCATE);")?;
    let rows = db.search_content_row_count()?;
    if rows != expected_rows
        || db.query_count(Some("benchmark"), &SearchFilters::default())? as usize != expected_rows
    {
        return Err("generated search row count mismatch".into());
    }
    let integrity = db.fts_integrity_check()?;
    if integrity != "ok" {
        return Err(integrity.into());
    }
    Ok(
        json!({"fixture_version": 1, "sessions": sessions, "search_rows": rows, "rows_per_session": rows_per_session}),
    )
}

fn session_id(index: usize) -> String {
    format!("00000000-0000-4000-8000-{index:012x}")
}

fn measure(path: &Path, repeats: usize) -> Result<Value, AnyError> {
    let db = IndexDb::open_readonly(path)?;
    let mut operations = Vec::new();
    let filters = [
        ("all", SearchFilters::default()),
        (
            "content_type",
            SearchFilters {
                content_types: vec!["tool_call".into()],
                ..Default::default()
            },
        ),
        (
            "exclude_type",
            SearchFilters {
                exclude_content_types: vec!["tool_result".into()],
                ..Default::default()
            },
        ),
        (
            "source",
            SearchFilters {
                source: Some(SessionSource::Copilot),
                ..Default::default()
            },
        ),
        (
            "repository",
            SearchFilters {
                repositories: db.search_repositories()?.into_iter().take(1).collect(),
                ..Default::default()
            },
        ),
    ];
    for (filter_name, filters) in filters {
        for (query_name, query) in [
            ("browse", None),
            ("common", Some("benchmark")),
            ("rare", Some("needle")),
        ] {
            let response = sample(repeats, || {
                Ok((
                    db.query_content(query, &filters)?,
                    db.query_count(query, &filters)?,
                ))
            })?;
            let count = sample(repeats, || db.query_count(query, &filters))?;
            let facets = sample(repeats, || db.facets(query, &filters))?;
            operations.push(json!({"filter": filter_name, "query": query_name, "response": response, "count": count, "facets": facets}));
        }
    }
    Ok(json!({
        "revision": option_env!("TRACEPILOT_PROBE_REVISION"),
        "sessions": db.session_count()?,
        "search_rows": db.search_content_row_count()?,
        "repeats": repeats,
        "operations": operations,
    }))
}

fn sample<T: Debug>(
    repeats: usize,
    mut operation: impl FnMut() -> tracepilot_indexer::Result<T>,
) -> Result<Value, AnyError> {
    let expected = digest(&format!("{:?}", operation()?));
    let mut samples = Vec::with_capacity(repeats);
    for _ in 0..repeats {
        let start = Instant::now();
        let result = operation()?;
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
        if digest(&format!("{result:?}")) != expected {
            return Err("search output changed during measurement; use a frozen index".into());
        }
    }
    Ok(json!({"samples_ms": samples, "output_digest": format!("{expected:016x}")}))
}

// Stable FNV-1a fingerprint, for equality diagnostics rather than security.
fn digest(value: &str) -> u64 {
    value.bytes().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    })
}
