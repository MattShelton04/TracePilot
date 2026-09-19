//! Agent-run extraction over the versioned session fixtures.

use std::path::PathBuf;

use tracepilot_core::agent_runs::{AgentRunExtraction, AgentRunOutcome, extract_agent_runs};
use tracepilot_core::parsing::events::parse_typed_events;
use tracepilot_core::turns::reconstruct_turns;

fn extract(fixture: &str) -> AgentRunExtraction {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/versions")
        .join(fixture);
    let events = parse_typed_events(&path).unwrap().events;
    let turns = reconstruct_turns(&events);
    extract_agent_runs(&events, &turns)
}

#[test]
fn every_version_fixture_extracts_without_panicking() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/versions");
    for entry in std::fs::read_dir(dir).unwrap() {
        let name = entry.unwrap().file_name().to_string_lossy().to_string();
        if name.ends_with(".jsonl") {
            let extraction = extract(&name);
            for run in &extraction.runs {
                assert!(!run.agent_name.is_empty(), "{name}: unnamed run");
                assert!(run.peak_siblings >= 1, "{name}: peak must include the run");
            }
        }
    }
}

#[test]
fn modern_agents_fixture_records_dispatch_configuration() {
    let extraction = extract("v1_0_83_agents.jsonl");
    assert!(!extraction.runs.is_empty());
    assert!(
        extraction
            .runs
            .iter()
            .any(|run| run.configured_model.is_some() && run.agent_type.is_some()),
        "1.0.83 runs carry subagent.configured and agentType: {:?}",
        extraction.runs
    );
}

#[test]
fn multi_turn_worker_counts_follow_ups_and_settles_once() {
    let extraction = extract("v1_0_83_multiturn.jsonl");
    let worker = extraction
        .runs
        .iter()
        .find(|run| run.tool_call_id.as_deref() == Some("launch"))
        .expect("launched worker");
    assert!(worker.follow_up_count >= 1, "{worker:?}");
    assert_ne!(worker.outcome, AgentRunOutcome::Failed);
    assert_eq!(extraction.runs.len(), 1, "follow-ups are not extra runs");
}
