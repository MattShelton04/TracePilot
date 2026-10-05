// Fixtures fail fast on invalid setup.
#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Copilot regression gate for the provider seam.
//!
//! Golden snapshots of summaries, raw events, turns (as reconstructed and as
//! sent over IPC), diagnostics, fingerprints and analytics DTOs over the
//! synthetic corpus in `tracepilot_test_support::copilot_corpus`. Copilot output
//! must stay byte-identical across the provider refactor.
//!
//! Normalized volatile values (nothing else is touched):
//! - `fingerprint.*.modified`: file mtimes, which are wall-clock creation times
//!   of the temporary fixture files. Sizes are kept.
//! - `codeImpact.fileTypeBreakdown` and `codeImpact.mostModifiedFiles` are
//!   sorted, because `compute_code_impact` builds them from a `HashMap` and
//!   breaks count ties in iteration order (pre-existing nondeterminism).
//!
//! Regenerate after an intentional change with `TRACEPILOT_UPDATE_GOLDEN=1`.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use tracepilot_core::analytics::{
    compute_analytics, compute_code_impact, compute_tool_analysis, load_full_sessions,
};
use tracepilot_core::parsing::events::{events_to_jsonl, parse_typed_events_if_exists};
use tracepilot_core::summary::{load_session_snapshot, load_session_summary};
use tracepilot_core::turns::prepare_turns_for_ipc;
use tracepilot_test_support::copilot_corpus::write_copilot_corpus;
use tracepilot_test_support::golden::assert_golden;

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/copilot")
}

fn normalize_fingerprint(mut value: Value) -> Value {
    if let Value::Object(files) = &mut value {
        for file in files.values_mut() {
            if let Some(modified) = file.get_mut("modified") {
                *modified = json!("<mtime>");
            }
        }
    }
    value
}

fn sort_array(value: &mut Value) {
    if let Value::Array(items) = value {
        items.sort_by_key(|item| item.to_string());
    }
}

fn session_snapshot(dir: &Path) -> Value {
    let summary = load_session_summary(dir).ok();
    let raw_events = parse_typed_events_if_exists(&dir.join("events.jsonl"))
        .unwrap()
        .map(|parsed| {
            let raw: Vec<_> = parsed.events.iter().map(|e| e.raw.clone()).collect();
            events_to_jsonl(&raw)
        });
    let snapshot = match load_session_snapshot(dir, &|| false) {
        Ok((load, fingerprint)) => {
            let ipc_turns = load.turns.clone().map(|mut turns| {
                prepare_turns_for_ipc(&mut turns);
                turns
            });
            json!({
                "summary": load.summary,
                "eventCount": load.typed_events.as_ref().map(Vec::len),
                "turns": load.turns,
                "ipcTurns": ipc_turns,
                "diagnostics": load.diagnostics,
                "fingerprint": normalize_fingerprint(serde_json::to_value(fingerprint).unwrap()),
            })
        }
        Err(error) => json!({ "error": error.to_string() }),
    };
    json!({
        "summary": summary,
        "rawEventsJsonl": raw_events,
        "snapshot": snapshot,
    })
}

#[test]
fn copilot_corpus_matches_golden_snapshots() {
    let temp = tempfile::tempdir().unwrap();
    for (session, dir) in write_copilot_corpus(temp.path()) {
        assert_golden(
            &golden_dir().join(format!("{}.json", session.name)),
            session_snapshot(&dir),
        );
    }
}

#[test]
fn copilot_corpus_analytics_match_golden_snapshot() {
    let temp = tempfile::tempdir().unwrap();
    write_copilot_corpus(temp.path());
    let inputs = load_full_sessions(temp.path()).unwrap();
    let mut code_impact = serde_json::to_value(compute_code_impact(&inputs)).unwrap();
    sort_array(&mut code_impact["fileTypeBreakdown"]);
    sort_array(&mut code_impact["mostModifiedFiles"]);
    assert_golden(
        &golden_dir().join("analytics.json"),
        json!({
            "analytics": compute_analytics(&inputs),
            "toolAnalysis": compute_tool_analysis(&inputs),
            "codeImpact": code_impact,
        }),
    );
}
