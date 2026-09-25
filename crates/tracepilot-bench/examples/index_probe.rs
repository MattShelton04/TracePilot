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
//! (index-unavailable disk scans), `analytics-sql`.
//!
//! Prints one JSON line with the wall time and, on Linux, the process peak
//! resident set size. Run one mode per process so peaks are attributable.
//! Only public library APIs are used so CI can build this file against the
//! base revision of a pull request (see `scripts/perf/probe-compare.mjs`).

use std::path::Path;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: index_probe <mode> <session-state-dir> <index-db> [n]");
        std::process::exit(2);
    }
    let mode = args[1].as_str();
    let sessions = Path::new(&args[2]);
    let db = Path::new(&args[3]);
    let start = Instant::now();
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
    let peak = peak_rss_kib()
        .map(|kib| kib.to_string())
        .unwrap_or_else(|| "null".to_string());
    println!(
        "{{\"mode\":\"{mode}\",\"elapsed_ms\":{},\"peak_rss_kib\":{peak},\"detail\":\"{detail}\"}}",
        start.elapsed().as_millis()
    );
}

/// Peak resident set size (VmHWM) on Linux; `None` elsewhere.
fn peak_rss_kib() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status
        .lines()
        .find_map(|line| line.strip_prefix("VmHWM:"))
        .and_then(|value| value.trim().trim_end_matches("kB").trim().parse().ok())
}
