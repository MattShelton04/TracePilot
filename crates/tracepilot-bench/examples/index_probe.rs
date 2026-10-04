// Fixtures and diagnostic executables fail fast on invalid setup.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::print_stdout,
    clippy::print_stderr
)]
//! Diagnostic probe for individual backend phases against an existing session
//! directory. Sessions are only read; the index database path must be a
//! scratch location owned by the caller.
//!
//! ```text
//! cargo run --release -p tracepilot-bench --example index_probe -- <mode> <session-state-dir> <index-db> [n] [small]
//! ```
//!
//! Modes: `phase1` (session index), `phase2` (search index), `phase2-stale <n>
//! [small]` (incremental search pass after marking `n` sessions changed),
//! `list-fallback`, `analytics-fallback`, `tool-fallback`, `code-fallback`
//! (index-unavailable disk scans), `analytics-sql`, `phase2-cancel` (request
//! cancellation after 50 ms; fail above TRACEPILOT_CANCEL_BUDGET_MS, default 250).
//!
//! Prints wall time and process peak resident set size on Windows and Linux.
//! TRACEPILOT_MEMORY_BUDGET_MIB (default 1024) fails an over-budget run.
//! Run one mode per process so peaks are attributable.
//! Only public library APIs are used so CI can build this file against the
//! base revision of a pull request (see `scripts/perf/probe-compare.mjs`).

#[path = "index_probe/limits.rs"]
mod limits;

use std::path::Path;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // CI embeds the measured commit when compiling each isolated binary.
    // Check it before measurement so a stale copied executable fails loudly.
    if args.get(1).map(String::as_str) == Some("--revision") {
        println!(
            "{}",
            serde_json::json!({ "revision_sha": option_env!("TRACEPILOT_PROBE_REVISION") })
        );
        return;
    }
    if args.len() < 4 {
        eprintln!("usage: index_probe <mode> <session-state-dir> <index-db> [n]");
        std::process::exit(2);
    }
    let mode = args[1].as_str();
    let sessions = Path::new(&args[2]);
    let db = Path::new(&args[3]);
    let start = Instant::now();
    let mut cancellation = None;
    let detail = match mode {
        "phase1" => {
            let (indexed, skipped) =
                tracepilot_indexer::reindex_incremental(sessions, db).expect("phase1");
            format!("indexed={indexed} skipped={skipped}")
        }
        "phase2" => {
            let (indexed, skipped) =
                tracepilot_indexer::reindex_search_content(sessions, db, |_| {}, || false)
                    .expect("phase2");
            format!("indexed={indexed} skipped={skipped}")
        }
        "phase2-cancel" => match limits::cancellation_probe(sessions, db) {
            Ok(metrics) => {
                cancellation = Some(metrics);
                "cancelled search indexing".to_string()
            }
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        },
        "phase2-stale" => {
            // Simulate N changed sessions on an already indexed database.
            let n: usize = args.get(4).and_then(|v| v.parse().ok()).unwrap_or(12);
            let order = if args.get(5).map(String::as_str) == Some("small") {
                "ASC"
            } else {
                "DESC"
            };
            let conn = rusqlite::Connection::open(db).expect("open");
            conn.execute(
                &format!(
                    "UPDATE sessions SET search_indexed_at = NULL
                     WHERE id IN (SELECT id FROM sessions WHERE events_size > 0
                                  ORDER BY events_size {order} LIMIT ?1)"
                ),
                [n as i64],
            )
            .expect("mark stale");
            drop(conn);
            let t = Instant::now();
            let (indexed, skipped) =
                tracepilot_indexer::reindex_search_content(sessions, db, |_| {}, || false)
                    .expect("phase2");
            format!(
                "stale={n} indexed={indexed} skipped={skipped} pass_ms={}",
                t.elapsed().as_millis()
            )
        }
        "list-fallback" => {
            let found =
                tracepilot_core::session::discovery::discover_sessions(sessions).expect("discover");
            let mut ok = 0;
            for s in &found {
                if tracepilot_core::summary::load_session_summary(&s.path).is_ok() {
                    ok += 1;
                }
            }
            format!("sessions={ok}")
        }
        "analytics-fallback" => {
            let inputs = tracepilot_core::analytics::load_full_sessions_filtered(
                sessions, None, None, None, true,
            )
            .expect("load");
            let data = tracepilot_core::analytics::compute_analytics(&inputs);
            format!("inputs={} sessions={}", inputs.len(), data.total_sessions)
        }
        "tool-fallback" => {
            let inputs = tracepilot_core::analytics::load_full_sessions_filtered(
                sessions, None, None, None, true,
            )
            .expect("load");
            let data = tracepilot_core::analytics::compute_tool_analysis(&inputs);
            format!("inputs={} tools={}", inputs.len(), data.tools.len())
        }
        "code-fallback" => {
            let inputs = tracepilot_core::analytics::load_session_summaries_filtered(
                sessions, None, None, None, true,
            )
            .expect("load");
            let _ = tracepilot_core::analytics::compute_code_impact(&inputs);
            format!("inputs={}", inputs.len())
        }
        "analytics-sql" => {
            let idx = tracepilot_indexer::index_db::IndexDb::open_readonly(db).expect("open");
            let t = Instant::now();
            let a = idx.query_analytics(None, None, None, true).expect("a");
            let a_ms = t.elapsed().as_millis();
            let t = Instant::now();
            let _ = idx.query_tool_analysis(None, None, None, true).expect("t");
            let t_ms = t.elapsed().as_millis();
            let t = Instant::now();
            let _ = idx.query_code_impact(None, None, None, true).expect("c");
            let c_ms = t.elapsed().as_millis();
            format!(
                "sessions={} analytics_ms={a_ms} tools_ms={t_ms} code_ms={c_ms}",
                a.total_sessions
            )
        }
        other => {
            eprintln!("unknown mode {other}");
            std::process::exit(2);
        }
    };
    let elapsed_ms = start.elapsed().as_millis();
    let peak = limits::peak_rss_kib();
    let memory_budget = match limits::enforce_memory_budget(peak) {
        Ok(budget) => budget,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    println!(
        "{}",
        serde_json::json!({
            "mode": mode, "elapsed_ms": elapsed_ms, "peak_rss_kib": peak,
            "revision_sha": option_env!("TRACEPILOT_PROBE_REVISION"),
            "memory_budget_mib": memory_budget, "cancellation": cancellation, "detail": detail,
        })
    );
}
