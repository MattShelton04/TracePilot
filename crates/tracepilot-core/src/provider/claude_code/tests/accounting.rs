//! Exact usage accounting on synthetic fixtures (implementation-plan.md L0).
//! Expected values are computed by hand from the usage in each fixture.

use tracepilot_test_support::claude::{HAIKU, OPUS};
use tracepilot_test_support::claude_scenarios as fixtures;

use super::parse;
use crate::provider::claude_code::{ClaudeCallUsage, TokenTotals, sum_calls_by_model};

fn totals(calls: u64, input: u64, cache_read: u64, cache_write: u64, output: u64) -> TokenTotals {
    TokenTotals {
        calls,
        input_tokens: input,
        cache_read_tokens: cache_read,
        cache_write_tokens: cache_write,
        output_tokens: output,
    }
}

fn call<'a>(calls: &'a [ClaudeCallUsage], id: &str) -> &'a ClaudeCallUsage {
    calls.iter().find(|c| c.message_id == id).unwrap()
}

#[test]
fn per_block_records_collapse_to_the_last_usage() {
    let parsed = parse(&fixtures::tool_hazards());
    let ids: Vec<_> = parsed.calls.iter().map(|c| c.message_id.as_str()).collect();
    assert_eq!(ids, ["msg_a1", "msg_a2", "msg_a3"]);
    let a1 = call(&parsed.calls, "msg_a1");
    assert_eq!(a1.output_tokens, 90, "last record, not a growing partial");
    assert_eq!(
        (a1.cache_write_1h_tokens, a1.cache_write_5m_tokens),
        (200, 0)
    );
    assert_eq!(a1.inclusive_input(), 1210);
    assert_eq!(a1.stop_reason.as_deref(), Some("tool_use"));

    let sums = sum_calls_by_model(&parsed.calls);
    assert_eq!(sums.len(), 1);
    assert_eq!(sums[OPUS], totals(3, 18, 3500, 250, 150));

    // The identical exit pair is one snapshot, consistent with the transcript;
    // the Haiku side model exists only in cost-state.
    assert_eq!(parsed.cost_snapshots.len(), 1);
    let snapshot = &parsed.cost_snapshots[0];
    let opus = &snapshot.model_usage[OPUS];
    assert_eq!(
        (
            opus.input_tokens,
            opus.cache_read_input_tokens,
            opus.cache_creation_input_tokens,
            opus.output_tokens
        ),
        (18, 3500, 250, 150)
    );
    assert!(snapshot.model_usage.contains_key(HAIKU));
    assert_eq!(parsed.tail_calls().count(), 0);
}

#[test]
fn subagent_calls_count_once_and_anchor_at_their_launch() {
    let parsed = parse(&fixtures::subagents());
    assert_eq!(parsed.calls.len(), 7);
    let sums = sum_calls_by_model(&parsed.calls);
    assert_eq!(sums[OPUS], totals(6, 14, 140, 0, 14));
    assert_eq!(sums[HAIKU], totals(1, 4, 40, 0, 4));

    let launch_a = call(&parsed.calls, "msg_A1").snapshot_anchor;
    assert!(launch_a.is_some());
    assert_eq!(call(&parsed.calls, "msg_A2").snapshot_anchor, launch_a);
    assert_eq!(
        call(&parsed.calls, "msg_C1").snapshot_anchor,
        launch_a,
        "nested: A's launch"
    );
    assert_eq!(
        call(&parsed.calls, "msg_C1").agent_id.as_deref(),
        Some("agentC")
    );
    assert!(call(&parsed.calls, "msg_B1").snapshot_anchor > launch_a);
    assert_eq!(
        call(&parsed.calls, "msg_D1").snapshot_anchor,
        None,
        "orphan"
    );
}

#[test]
fn abandoned_calls_still_count() {
    let parsed = parse(&fixtures::rewind_fork());
    assert_eq!(
        sum_calls_by_model(&parsed.calls)[OPUS],
        totals(3, 6, 0, 0, 60)
    );
    assert!(call(&parsed.calls, "msg_r2").abandoned);
    assert!(!call(&parsed.calls, "msg_r3").abandoned);
}

#[test]
fn resumed_and_ended_session_is_covered_by_its_last_snapshot() {
    let parsed = parse(&fixtures::resumed(false));
    assert_eq!(
        parsed.cost_snapshots.len(),
        2,
        "one per exit; identical pairs collapse"
    );
    let [first, last] = [&parsed.cost_snapshots[0], &parsed.cost_snapshots[1]];
    assert!(first.line < last.line);
    // Cumulative: the later snapshot is the earlier one plus e2, to the token.
    assert_eq!(
        first.model_usage[OPUS].input_tokens + 20,
        last.model_usage[OPUS].input_tokens
    );
    let transcript = sum_calls_by_model(&parsed.calls)[OPUS];
    assert_eq!(transcript, totals(2, 30, 300, 60, 12));
    assert_eq!(
        last.model_usage[OPUS].output_tokens,
        transcript.output_tokens
    );
    assert_eq!(parsed.tail_calls().count(), 0);
}

#[test]
fn resumed_and_running_session_has_a_tail() {
    let parsed = parse(&fixtures::resumed(true));
    let tail: Vec<_> = parsed.tail_calls().map(|c| c.message_id.as_str()).collect();
    assert_eq!(tail, ["msg_e3"]);
    let last = &parsed.cost_snapshots.last().unwrap().model_usage[OPUS];
    let tail_sum = sum_calls_by_model(parsed.tail_calls())[OPUS];
    // Current total = last snapshot + tail.
    assert_eq!(
        (
            last.input_tokens + tail_sum.input_tokens,
            last.output_tokens + tail_sum.output_tokens
        ),
        (60, 23)
    );
}
