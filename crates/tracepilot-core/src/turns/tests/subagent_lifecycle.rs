//! Subagent lifecycle tests.
//!
//! Tests for subagent event handling, state machine transitions, and edge cases.
//!
//! ## Tests Included
//! - Subagent event merging with tool calls
//! - Completion and failure handling
//! - Out-of-order event handling
//! - Incomplete lifecycle scenarios

use super::*;

// Helper functions
fn sub_completed_event(ts: &str, evt_id: &str) -> TypedEvent {
    subagent_complete("explore")
        .tool_call_id("tc-sub")
        .agent_display_name("Explore Agent")
        .id(evt_id)
        .timestamp(ts)
        .parent("evt-4")
        .build_event()
}
fn sub_failed_event(ts: &str, evt_id: &str, error: &str) -> TypedEvent {
    subagent_failed("explore")
        .tool_call_id("tc-sub")
        .agent_display_name("Explore Agent")
        .error(error)
        .id(evt_id)
        .timestamp(ts)
        .parent("evt-4")
        .build_event()
}
fn tool_complete_event(ts: &str, evt_id: &str, success: Option<bool>) -> TypedEvent {
    tool_complete("tc-sub")
        .model("claude-opus-4.6")
        .interaction_id("int-1")
        .success(success.unwrap_or(true))
        .result(json!("Agent completed successfully"))
        .id(evt_id)
        .timestamp(ts)
        .parent("evt-3")
        .build_event()
}
fn turn_end_event(ts: &str, evt_id: &str) -> TypedEvent {
    turn_end()
        .turn_id("turn-1")
        .id(evt_id)
        .timestamp(ts)
        .parent("evt-2")
        .build_event()
}
fn run_subagent_scenario(events: Vec<TypedEvent>) -> TurnToolCall {
    let turns = reconstruct_turns(&events);
    assert!(!turns.is_empty(), "Expected at least one turn");
    let subagent = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.is_subagent)
        .expect("Expected a subagent tool call");
    subagent.clone()
}

#[test]
fn treats_subagent_events_as_tool_calls() {
    let events = vec![
        user_msg("Run specialist")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        subagent_start("explore")
            .tool_call_id("sub-1")
            .agent_display_name("Explore Agent")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        subagent_complete("explore")
            .tool_call_id("sub-1")
            .agent_display_name("Explore Agent")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-2")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].tool_calls.len(), 1);
    let tool_call = &turns[0].tool_calls[0];
    assert_eq!(tool_call.tool_call_id.as_deref(), Some("sub-1"));
    assert_eq!(tool_call.tool_name, "explore");
    assert_eq!(tool_call.success, Some(true));
    assert!(tool_call.is_complete);
}
#[test]
fn subagent_started_merges_into_tool_exec_start() {
    // When SubagentStarted fires with the same toolCallId as a previous ToolExecStart,
    // it should MERGE into the existing entry (not create a duplicate).
    let events = vec![
        user_msg("Launch agent")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T10:00:00.000Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("evt-2")
            .timestamp("2026-03-10T10:00:00.100Z")
            .parent("evt-1")
            .build_event(),
        // ToolExecStart creates entry with arguments
        tool_start("task")
            .tool_call_id("tc-agent-1")
            .arguments(json!({ "prompt": "Review the code", "agent_type": "code-review" }))
            .id("evt-3")
            .timestamp("2026-03-10T10:00:01.000Z")
            .parent("evt-2")
            .build_event(),
        // SubagentStarted should merge into existing entry, not create duplicate
        subagent_start("code-review")
            .tool_call_id("tc-agent-1")
            .agent_display_name("Code Review Agent")
            .agent_description("Reviews code for issues")
            .id("evt-4")
            .timestamp("2026-03-10T10:00:01.003Z")
            .parent("evt-3")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("evt-5")
            .timestamp("2026-03-10T10:00:02.000Z")
            .parent("evt-2")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);

    let turn = &turns[0];
    // Should be 1 entry, not 2 (merged)
    assert_eq!(turn.tool_calls.len(), 1);

    let tc = &turn.tool_calls[0];
    assert_eq!(tc.tool_call_id.as_deref(), Some("tc-agent-1"));
    // Subagent fields from SubagentStarted
    assert!(tc.is_subagent);
    assert_eq!(tc.agent_display_name.as_deref(), Some("Code Review Agent"));
    assert_eq!(
        tc.agent_description.as_deref(),
        Some("Reviews code for issues")
    );
    // Arguments preserved from ToolExecStart
    assert!(tc.arguments.is_some());
    let args = tc.arguments.as_ref().unwrap();
    assert_eq!(args["prompt"], "Review the code");
    assert_eq!(args["agent_type"], "code-review");
    // tool_name updated from SubagentStarted agent_name
    assert_eq!(tc.tool_name, "code-review");
}
#[test]
fn subagent_completed_finds_entry_in_finalized_turn() {
    // SubagentCompleted may arrive after the turn is finalized.
    // It should still find and update the entry in the finalized turn.
    let events = vec![
        user_msg("Launch agent")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T10:00:00.000Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("evt-2")
            .timestamp("2026-03-10T10:00:00.100Z")
            .parent("evt-1")
            .build_event(),
        tool_start("task")
            .tool_call_id("tc-agent-1")
            .arguments(json!({ "prompt": "Explore codebase" }))
            .id("evt-3")
            .timestamp("2026-03-10T10:00:01.000Z")
            .parent("evt-2")
            .build_event(),
        subagent_start("explore")
            .tool_call_id("tc-agent-1")
            .agent_display_name("Explore Agent")
            .id("evt-4")
            .timestamp("2026-03-10T10:00:01.003Z")
            .parent("evt-3")
            .build_event(),
        // Turn ends BEFORE subagent completes
        turn_end()
            .turn_id("turn-1")
            .id("evt-5")
            .timestamp("2026-03-10T10:00:02.000Z")
            .parent("evt-2")
            .build_event(),
        // SubagentCompleted arrives after turn is finalized (4 minutes later)
        subagent_complete("explore")
            .tool_call_id("tc-agent-1")
            .agent_display_name("Explore Agent")
            .id("evt-6")
            .timestamp("2026-03-10T10:04:01.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);

    // The subagent entry in finalized turn 1 should have the completed_at from SubagentCompleted
    let tc = &turns[0].tool_calls[0];
    assert_eq!(tc.tool_call_id.as_deref(), Some("tc-agent-1"));
    assert!(tc.is_subagent);
    assert!(tc.is_complete);
    assert_eq!(tc.success, Some(true));
    // Duration should be ~4 minutes, not 5ms
    assert!(
        tc.duration_ms.unwrap() > 200_000,
        "Duration should be >200s, got {}ms",
        tc.duration_ms.unwrap()
    );
}
#[test]
fn subagent_failed_finds_entry_in_finalized_turn() {
    let events = vec![
        user_msg("Launch")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T10:00:00.000Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("evt-2")
            .timestamp("2026-03-10T10:00:00.100Z")
            .parent("evt-1")
            .build_event(),
        tool_start("task")
            .tool_call_id("tc-fail")
            .id("evt-3")
            .timestamp("2026-03-10T10:00:01.000Z")
            .parent("evt-2")
            .build_event(),
        subagent_start("general-purpose")
            .tool_call_id("tc-fail")
            .agent_display_name("General Agent")
            .id("evt-4")
            .timestamp("2026-03-10T10:00:01.003Z")
            .parent("evt-3")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("evt-5")
            .timestamp("2026-03-10T10:00:02.000Z")
            .parent("evt-2")
            .build_event(),
        // SubagentFailed arrives after turn
        subagent_failed("general-purpose")
            .tool_call_id("tc-fail")
            .agent_display_name("General Agent")
            .error("OOM")
            .id("evt-6")
            .timestamp("2026-03-10T10:01:30.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    let tc = &turns[0].tool_calls[0];
    assert!(tc.is_subagent);
    assert!(tc.is_complete);
    assert_eq!(tc.success, Some(false));
    assert_eq!(tc.error.as_deref(), Some("OOM"));
    assert!(tc.duration_ms.unwrap() > 80_000);
}
#[test]
fn subagent_failed_records_error() {
    let events = vec![
        user_msg("Do work")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2025-01-01T00:00:00Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("ev-2")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
        tool_start("task")
            .tool_call_id("sub-1")
            .id("ev-3")
            .timestamp("2025-01-01T00:00:02Z")
            .build_event(),
        subagent_start("task")
            .tool_call_id("sub-1")
            .id("ev-4")
            .timestamp("2025-01-01T00:00:03Z")
            .build_event(),
        subagent_failed("task")
            .tool_call_id("sub-1")
            .error("timeout")
            .id("ev-5")
            .timestamp("2025-01-01T00:00:04Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-6")
            .timestamp("2025-01-01T00:00:05Z")
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    let tc = &turns[0].tool_calls[0];
    assert!(tc.is_subagent);
    assert_eq!(
        tc.success,
        Some(false),
        "failed subagent should be marked unsuccessful"
    );
    assert_eq!(tc.error.as_deref(), Some("timeout"));
}
#[test]
fn repro_enrich_subagent_bug() {
    // Scenario: ToolExecComplete arrives BEFORE SubagentStarted, with NO SubagentCompleted.
    // enrich_subagent() correctly resets is_complete=false when SubagentStarted arrives.
    // However, the finalization sweep then infers completion from completed_at (set by
    // ToolExecComplete) — this is correct behavior for truncated/interrupted sessions.
    let events = vec![
        user_msg("Launch")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T10:00:00.000Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("evt-2")
            .timestamp("2026-03-10T10:00:00.100Z")
            .parent("evt-1")
            .build_event(),
        tool_start("task")
            .tool_call_id("tc-bug")
            .id("evt-3")
            .timestamp("2026-03-10T10:00:01.000Z")
            .parent("evt-2")
            .build_event(),
        // Tool completes before we learn it's a subagent
        tool_complete("tc-bug")
            .interaction_id("int-1")
            .success(true)
            .id("evt-4")
            .timestamp("2026-03-10T10:00:01.100Z")
            .parent("evt-3")
            .build_event(),
        // Then we learn it's a subagent (but SubagentCompleted never arrives)
        subagent_start("task")
            .tool_call_id("tc-bug")
            .agent_display_name("Task Agent")
            .id("evt-5")
            .timestamp("2026-03-10T10:00:01.200Z")
            .parent("evt-4")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    let tc = &turns[0].tool_calls[0];

    assert!(tc.is_subagent, "Should be recognized as a subagent");
    // enrich_subagent() clears the early completed_at from ToolExecComplete because it
    // predates SubagentStarted and doesn't reflect the subagent's actual end time.
    // Without SubagentCompleted, the subagent should remain incomplete.
    assert!(
        !tc.is_complete,
        "Should NOT be marked complete — ToolExecComplete timestamp predates SubagentStarted \
         and no SubagentCompleted was received"
    );
    assert!(
        tc.completed_at.is_none(),
        "completed_at should be cleared since the early timestamp doesn't reflect subagent end"
    );
}
#[test]
fn subagent_completion_normal_order() {
    // Normal order: Start → SubStarted → SubCompleted → ToolExecComplete → TurnEnd
    // This is THE bug scenario — ToolExecComplete must NOT reverse SubagentCompleted.
    let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
    let events = vec![
        user_msg,
        turn_start,
        tool_start,
        sub_started,
        sub_completed_event("2026-03-18T00:00:05.000Z", "evt-5"),
        tool_complete_event("2026-03-18T00:00:05.100Z", "evt-6", Some(true)),
        turn_end_event("2026-03-18T00:00:05.200Z", "evt-7"),
    ];

    let tc = run_subagent_scenario(events);
    assert!(tc.is_subagent, "Should be marked as subagent");
    assert!(
        tc.is_complete,
        "Subagent should be complete (SubagentCompleted arrived)"
    );
    assert_eq!(tc.success, Some(true), "Should be successful");
    assert!(
        tc.completed_at.is_some(),
        "Should have completed_at timestamp"
    );
    assert!(tc.duration_ms.is_some(), "Should have duration");
}
#[test]
fn subagent_completion_reverse_order() {
    // Reverse order: Start → SubStarted → ToolExecComplete → SubCompleted → TurnEnd
    let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
    let events = vec![
        user_msg,
        turn_start,
        tool_start,
        sub_started,
        tool_complete_event("2026-03-18T00:00:05.000Z", "evt-5", Some(true)),
        sub_completed_event("2026-03-18T00:00:05.100Z", "evt-6"),
        turn_end_event("2026-03-18T00:00:05.200Z", "evt-7"),
    ];

    let tc = run_subagent_scenario(events);
    assert!(tc.is_subagent);
    assert!(
        tc.is_complete,
        "Subagent should be complete (SubagentCompleted arrived)"
    );
    assert_eq!(tc.success, Some(true));
}
#[test]
fn subagent_completion_tool_exec_between_sub_events() {
    // Mid order: Start → SubStarted → ToolExecComplete (no SubCompleted yet) → SubCompleted
    // ToolExecComplete should NOT mark subagent complete; SubCompleted does.
    let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
    let events = vec![
        user_msg,
        turn_start,
        tool_start,
        sub_started,
        tool_complete_event("2026-03-18T00:00:04.000Z", "evt-5", Some(true)),
        sub_completed_event("2026-03-18T00:00:05.000Z", "evt-6"),
        turn_end_event("2026-03-18T00:00:05.200Z", "evt-7"),
    ];

    let tc = run_subagent_scenario(events);
    assert!(tc.is_complete, "Should be complete after SubagentCompleted");
    assert_eq!(tc.success, Some(true));
}
#[test]
fn subagent_failed_with_late_tool_exec_complete() {
    // SubagentFailed sets success=false, then ToolExecComplete arrives with success=true.
    // The failure state must be preserved (SubagentFailed has authority).
    let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
    let events = vec![
        user_msg,
        turn_start,
        tool_start,
        sub_started,
        sub_failed_event("2026-03-18T00:00:05.000Z", "evt-5", "Agent crashed"),
        tool_complete_event("2026-03-18T00:00:05.100Z", "evt-6", Some(true)),
        turn_end_event("2026-03-18T00:00:05.200Z", "evt-7"),
    ];

    let tc = run_subagent_scenario(events);
    assert!(tc.is_subagent);
    assert!(
        tc.is_complete,
        "Should be complete (SubagentFailed arrived)"
    );
    assert_eq!(
        tc.success,
        Some(false),
        "Failure must be preserved despite ToolExecComplete success=true"
    );
    assert_eq!(
        tc.error.as_deref(),
        Some("Agent crashed"),
        "Error message must be preserved"
    );
}
#[test]
fn subagent_missing_lifecycle_events_stays_incomplete() {
    // Truncated trace: SubagentStarted + ToolExecComplete, but NO SubagentCompleted.
    // Since ToolExecComplete no longer sets completed_at/duration_ms for subagents,
    // the finalization sweep has no completed_at to work with, so the subagent
    // correctly remains incomplete (showing as "in-progress" in the UI).
    let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
    let events = vec![
        user_msg,
        turn_start,
        tool_start,
        sub_started,
        // No SubagentCompleted event!
        tool_complete_event("2026-03-18T00:00:05.000Z", "evt-5", Some(true)),
        turn_end_event("2026-03-18T00:00:05.200Z", "evt-6"),
    ];

    let tc = run_subagent_scenario(events);
    assert!(tc.is_subagent);
    assert!(
        !tc.is_complete,
        "Subagent should remain incomplete when only ToolExecComplete arrived (no SubagentCompleted)"
    );
    assert!(
        tc.completed_at.is_none(),
        "completed_at should be None — ToolExecComplete must not set it for subagents"
    );
}
#[test]
fn subagent_tool_exec_before_subagent_started_then_completed() {
    // Out-of-order: ToolExecComplete before SubagentStarted, then SubagentCompleted.
    // enrich_subagent() resets is_complete; SubagentCompleted then sets it.
    let (user_msg, turn_start, tool_start, _sub_started) = base_subagent_events();
    let sub_started_late = subagent_start("explore")
        .tool_call_id("tc-sub")
        .agent_display_name("Explore Agent")
        .agent_description("Explores the codebase")
        .id("evt-5")
        .timestamp("2026-03-18T00:00:02.000Z")
        .parent("evt-3")
        .build_event();
    let events = vec![
        user_msg,
        turn_start,
        tool_start,
        // ToolExecComplete arrives BEFORE SubagentStarted
        tool_complete_event("2026-03-18T00:00:01.500Z", "evt-4", Some(true)),
        sub_started_late,
        sub_completed_event("2026-03-18T00:00:05.000Z", "evt-6"),
        turn_end_event("2026-03-18T00:00:05.200Z", "evt-7"),
    ];

    let tc = run_subagent_scenario(events);
    assert!(tc.is_subagent);
    assert!(
        tc.is_complete,
        "SubagentCompleted should finalize even after out-of-order events"
    );
    assert_eq!(tc.success, Some(true));
}
#[test]
fn subagent_no_tool_exec_complete_only_lifecycle() {
    // Edge case: SubagentStarted + SubagentCompleted but NO ToolExecComplete.
    // Should still be marked complete.
    let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
    let events = vec![
        user_msg,
        turn_start,
        tool_start,
        sub_started,
        sub_completed_event("2026-03-18T00:00:05.000Z", "evt-5"),
        turn_end_event("2026-03-18T00:00:05.200Z", "evt-6"),
    ];

    let tc = run_subagent_scenario(events);
    assert!(tc.is_subagent);
    assert!(
        tc.is_complete,
        "SubagentCompleted alone should mark complete"
    );
    assert_eq!(tc.success, Some(true));
}
#[test]
fn subagent_tool_exec_before_subagent_started_no_completion_stays_incomplete() {
    // Regression test: ToolExecComplete arrives before SubagentStarted, and there
    // is NO SubagentCompleted event. Without the fix, finalize_subagent_completion()
    // would see the completed_at from ToolExecComplete and prematurely mark the
    // subagent as complete with a very short (incorrect) duration.
    let (user_msg, turn_start, tool_start, _sub_started) = base_subagent_events();
    let sub_started_late = subagent_start("explore")
        .tool_call_id("tc-sub")
        .agent_display_name("Explore Agent")
        .agent_description("Explores the codebase")
        .id("evt-5")
        .timestamp("2026-03-18T00:00:02.000Z")
        .parent("evt-3")
        .build_event();
    let events = vec![
        user_msg,
        turn_start,
        tool_start,
        // ToolExecComplete arrives BEFORE SubagentStarted
        tool_complete_event("2026-03-18T00:00:01.500Z", "evt-4", Some(true)),
        sub_started_late,
        // No SubagentCompleted — subagent may still be running
        turn_end_event("2026-03-18T00:00:02.200Z", "evt-6"),
    ];

    let tc = run_subagent_scenario(events);
    assert!(tc.is_subagent);
    assert!(
        !tc.is_complete,
        "Subagent should NOT be marked complete when only ToolExecComplete arrived \
         before SubagentStarted and no SubagentCompleted was received"
    );
    assert!(
        tc.completed_at.is_none(),
        "completed_at should be cleared by enrich_subagent() since ToolExecComplete \
         timestamp predates SubagentStarted and doesn't reflect real subagent end"
    );
}
#[test]
fn subagent_tool_exec_before_subagent_started_then_tool_exec_after() {
    // ToolExecComplete fires twice-ish scenario: first early (before SubagentStarted),
    // then the actual ToolExecComplete fires after the subagent work is done.
    // The second ToolExecComplete should set completed_at correctly.
    let (user_msg, turn_start, tool_start, _sub_started) = base_subagent_events();
    let sub_started_late = subagent_start("explore")
        .tool_call_id("tc-sub")
        .agent_display_name("Explore Agent")
        .agent_description("Explores the codebase")
        .id("evt-5")
        .timestamp("2026-03-18T00:00:02.000Z")
        .parent("evt-3")
        .build_event();
    let events = vec![
        user_msg,
        turn_start,
        tool_start,
        // Early ToolExecComplete (before SubagentStarted)
        tool_complete_event("2026-03-18T00:00:01.500Z", "evt-4", Some(true)),
        sub_started_late,
        // SubagentCompleted arrives with correct timestamp
        sub_completed_event("2026-03-18T00:00:10.000Z", "evt-6"),
        // Late ToolExecComplete with even later timestamp
        tool_complete_event("2026-03-18T00:00:10.100Z", "evt-7", Some(true)),
        turn_end_event("2026-03-18T00:00:10.200Z", "evt-8"),
    ];

    let tc = run_subagent_scenario(events);
    assert!(tc.is_subagent);
    assert!(tc.is_complete);
    assert_eq!(tc.success, Some(true));
    // Duration should be ~9.1s (T=10.1 - T=1.0), not ~0.5s (T=1.5 - T=1.0)
    let dur = tc.duration_ms.expect("Should have duration");
    assert!(
        dur > 8000,
        "Duration should reflect the full subagent run (>8s), not the early ToolExecComplete. Got: {}ms",
        dur
    );
}
#[test]
fn subagent_started_then_tool_exec_complete_no_sub_completed_stays_incomplete() {
    // THE critical regression scenario: normal event ordering where SubagentStarted
    // arrives first, then ToolExecComplete fires, but SubagentCompleted never arrives
    // (session still running or truncated).
    //
    // Previously, ToolExecComplete would set completed_at/duration_ms even for subagents,
    // and finalize_subagent_completion() would then mark it complete with a very short
    // duration (the ToolExecStart->ToolExecComplete gap, not actual subagent runtime).
    //
    // With the fix, ToolExecComplete no longer sets completed_at/duration_ms for
    // subagents, so the subagent correctly remains in-progress.
    let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
    let events = vec![
        user_msg,
        turn_start,
        tool_start,                                                           // T=1.0s
        sub_started,                                                          // T=1.05s
        tool_complete_event("2026-03-18T00:00:01.100Z", "evt-5", Some(true)), // T=1.1s
        // No SubagentCompleted -- subagent is still running
        turn_end_event("2026-03-18T00:00:01.200Z", "evt-6"),
    ];

    let tc = run_subagent_scenario(events);
    assert!(tc.is_subagent, "Should be marked as subagent");
    assert!(
        !tc.is_complete,
        "Subagent should NOT be marked complete when SubagentCompleted never arrived. \
         ToolExecComplete should not finalize subagents."
    );
    assert!(
        tc.completed_at.is_none(),
        "completed_at should be None -- ToolExecComplete must not set it for subagents"
    );
    assert!(
        tc.duration_ms.is_none(),
        "duration_ms should be None -- subagent is still running"
    );
}
#[test]
fn subagent_completed_before_subagent_started_preserves_terminal_state() {
    // Out-of-order edge case: SubagentCompleted arrives before SubagentStarted.
    // enrich_subagent() must NOT wipe the terminal state already set by
    // handle_subagent_terminal().
    let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
    let events = vec![
        user_msg,
        turn_start,
        tool_start, // T=1.0s
        // SubagentCompleted arrives BEFORE SubagentStarted
        sub_completed_event("2026-03-18T00:00:05.000Z", "evt-4"), // T=5.0s
        sub_started,                                              // T=1.05s
        turn_end_event("2026-03-18T00:00:05.200Z", "evt-6"),
    ];

    let tc = run_subagent_scenario(events);
    assert!(tc.is_subagent, "Should be marked as subagent");
    assert!(
        tc.is_complete,
        "SubagentCompleted terminal state must be preserved even when SubagentStarted arrives later"
    );
    assert_eq!(tc.success, Some(true));
    assert!(
        tc.completed_at.is_some(),
        "completed_at from SubagentCompleted must be preserved"
    );
    assert!(
        tc.duration_ms.is_some(),
        "duration_ms from SubagentCompleted must be preserved"
    );
}
