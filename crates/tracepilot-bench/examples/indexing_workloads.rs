// Diagnostic executables fail fast on invalid setup.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::print_stdout,
    clippy::print_stderr
)]
//! Time each indexing workload the app runs, across both session sources.
//!
//! ```text
//! cargo run --release -p tracepilot-bench --example indexing_workloads -- \
//!     <mode> <copilot-session-state|-> <claude-config-dir|-> <index-db> [source]
//! ```
//!
//! `-` leaves a source out. Sessions are only read; the index database must be
//! a scratch path. Each mode runs the library calls the app makes, on the
//! database as the caller left it:
//!
//! - `first` (empty database) and `incr`: phase 1, then phase 2.
//! - `analytics-bump <source>`: reset that source's analytics version, then
//!   phase 1 and phase 2, as after an analytics version bump.
//! - `rebuild`: Settings full rebuild (`reindex_all` and a search rebuild).
//! - `search-rebuild`: search index rebuild only.
//! - `purge <source>`: disabling a source in Settings.
//! - `enable <source>`: phase 1 over that source alone, then phase 2 over all.
//!
//! Prints one JSON line: wall time per step and the process peak resident set
//! (read after timing). Run one mode per process so the peak is attributable;
//! measure CPU time from outside, for example with PowerShell's
//! `TotalProcessorTime`. See docs/performance-playbook.md.

// Shared with `index_probe`; only the peak reading is used here.
#[allow(dead_code)]
#[path = "index_probe/limits.rs"]
mod limits;

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use tracepilot_core::provider::claude_code::ClaudeCodeProvider;
use tracepilot_core::provider::{CopilotProvider, ProviderRegistry, SessionSource};
use tracepilot_indexer::IndexScope;
use tracepilot_indexer::index_db::IndexDb;

fn registry(copilot: &str, claude: &str, only: Option<SessionSource>) -> ProviderRegistry {
    let mut registry = ProviderRegistry::new();
    if copilot != "-" && only.is_none_or(|source| source == SessionSource::Copilot) {
        registry.register(Arc::new(CopilotProvider::new(copilot)));
    }
    if claude != "-" && only.is_none_or(|source| source == SessionSource::ClaudeCode) {
        registry.register(Arc::new(ClaudeCodeProvider::new(claude)));
    }
    registry
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 5 {
        eprintln!("usage: indexing_workloads <mode> <copilot|-> <claude|-> <index-db> [source]");
        std::process::exit(2);
    }
    let (mode, copilot, claude, db) = (
        args[1].as_str(),
        args[2].as_str(),
        args[3].as_str(),
        Path::new(&args[4]),
    );
    let source = || {
        args.get(5)
            .and_then(|name| SessionSource::from_stored(name))
            .expect("source: copilot or claudeCode")
    };
    let scope = IndexScope::standalone(registry(copilot, claude, None));
    let mut steps = serde_json::Map::new();
    let mut step = |name: &str, run: &mut dyn FnMut() -> String| {
        let start = Instant::now();
        let result = run();
        steps.insert(
            name.to_string(),
            serde_json::json!({ "ms": start.elapsed().as_millis() as u64, "result": result }),
        );
    };
    let phase1 = |scope: &IndexScope| {
        let (indexed, skipped) =
            tracepilot_indexer::reindex_incremental_scoped(scope, db, |_| {}).expect("phase1");
        format!("indexed={indexed} skipped={skipped}")
    };
    let phase2 = || {
        let (indexed, skipped) =
            tracepilot_indexer::reindex_search_content_scoped(&scope, db, |_| {}, || false)
                .expect("phase2");
        format!("indexed={indexed} skipped={skipped}")
    };
    let search_rebuild = || {
        let (indexed, skipped) =
            tracepilot_indexer::rebuild_search_content_scoped(&scope, db, |_| {}, || false)
                .expect("search rebuild");
        format!("indexed={indexed} skipped={skipped}")
    };
    let start = Instant::now();
    match mode {
        "first" | "incr" => {
            step("phase1", &mut || phase1(&scope));
            step("phase2", &mut || phase2());
        }
        "analytics-bump" => {
            let conn = rusqlite::Connection::open(db).expect("open");
            conn.execute(
                "UPDATE sessions SET analytics_version = 0 WHERE source = ?1",
                [source().as_str()],
            )
            .expect("reset analytics version");
            drop(conn);
            step("phase1", &mut || phase1(&scope));
            step("phase2", &mut || phase2());
        }
        "rebuild" => {
            step("reindex_all", &mut || {
                let indexed =
                    tracepilot_indexer::reindex_all_scoped(&scope, db, |_| {}).expect("reindex");
                format!("indexed={indexed}")
            });
            step("search_rebuild", &mut || search_rebuild());
        }
        "search-rebuild" => step("search_rebuild", &mut || search_rebuild()),
        "purge" => {
            let index = IndexDb::open_or_create(db).expect("open");
            step("purge", &mut || {
                let removed = index.purge_source(source(), &|| true).expect("purge");
                format!("removed={removed}")
            });
        }
        "enable" => {
            let only = IndexScope::standalone(registry(copilot, claude, Some(source())));
            step("phase1", &mut || phase1(&only));
            step("phase2", &mut || phase2());
        }
        other => {
            eprintln!("unknown mode {other}");
            std::process::exit(2);
        }
    }
    let elapsed_ms = start.elapsed().as_millis() as u64;
    println!(
        "{}",
        serde_json::json!({
            "mode": mode,
            "elapsed_ms": elapsed_ms,
            "peak_rss_kib": limits::peak_rss_kib(),
            "steps": steps,
        })
    );
}
