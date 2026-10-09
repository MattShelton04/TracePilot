//! Session titles and the durations of sessions without a `cost-state`.

use tracepilot_test_support::claude::{OPUS, Transcript, Usage, text, write_session};
use tracepilot_test_support::claude_scenarios as fixtures;

use super::super::summary::summarize;
use super::parse;
use crate::ids::SessionId;

fn summary_of(t: &Transcript) -> crate::models::session_summary::SessionSummary {
    let files = write_session(t, &[]);
    summarize(&SessionId::from_validated("s"), &parse(&files)).0
}

#[test]
fn a_session_of_slash_commands_only_is_named_after_its_first_command() {
    let parsed = parse(&fixtures::commands_only());
    let (summary, _, metrics) = summarize(&SessionId::from_validated("s"), &parsed);
    assert_eq!(summary.summary.as_deref(), Some("/model claude-opus-5-5"));
    assert!(metrics.is_none(), "no model call, no metrics");
}

#[test]
fn a_typed_prompt_names_the_session_before_any_command() {
    let mut t = Transcript::main();
    t.user(serde_json::json!({"message": {"role": "user",
        "content": "<command-name>/model</command-name>\n<command-args>opus</command-args>"}}));
    t.prompt("Add retries.");
    assert_eq!(summary_of(&t).summary.as_deref(), Some("Add retries."));
}

#[test]
fn a_pasted_prompt_title_has_no_paste_tags() {
    let mut t = Transcript::main();
    t.prompt("<pasted_content id=\"7\">\nAdd retries to the uploader.\n</pasted_content id=\"7\">");
    assert_eq!(
        summary_of(&t).summary.as_deref(),
        Some("Add retries to the uploader.")
    );
}

/// The clock ticks one second per record. A call's API time runs from the
/// record before it to its last record.
#[test]
fn durations_without_a_snapshot_come_from_transcript_timestamps() {
    let u = Usage::new(1, 0, 0, 1);
    let mut t = Transcript::main();
    t.prompt("First."); // 1 s
    t.call("m1", OPUS, vec![text("a"), text("b")], u, "end_turn"); // 2 s, 3 s
    t.idle(60);
    t.prompt("Second."); // 64 s
    t.call("m2", OPUS, vec![text("c")], u, "end_turn"); // 65 s
    // A call whose clock goes backwards is left out, not counted as negative.
    t.prompt("Third."); // 66 s
    t.at(10).call("m3", OPUS, vec![text("d")], u, "end_turn");
    let metrics = summary_of(&t).shutdown_metrics.expect("recorded calls");
    assert_eq!(metrics.total_api_duration_ms, Some(2_000 + 1_000));
    assert_eq!(metrics.total_duration_ms, Some(65_000));
    assert_eq!(metrics.coverage.as_ref().unwrap().snapshot_line, None);
}

#[test]
fn durations_with_a_snapshot_stay_as_reported() {
    let files = fixtures::resumed(false);
    let parsed = parse(&files);
    let snapshot = parsed.cost_snapshots.last().expect("snapshot").clone();
    let (_, _, metrics) = summarize(&SessionId::from_validated("s"), &parsed);
    let metrics = metrics.expect("metrics");
    assert_eq!(
        metrics.total_api_duration_ms,
        snapshot.total_api_duration_ms
    );
    assert_eq!(metrics.total_duration_ms, snapshot.total_duration_ms);
}
