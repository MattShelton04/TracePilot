//! Turn model aggregation and subagent isolation tests.

use super::super::*;

#[test]
fn subagent_child_tool_does_not_set_turn_model() {
    // Scenario: main agent (claude) spawns a subagent (gemini) which runs
    // child tool calls. The child tool's ToolExecutionComplete carries the
    // subagent's model. turn.model should NOT be set to the subagent's model.
    let events = vec![
        user_msg("Hello")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2026-01-01T00:00:00Z")
            .build_event(),
        // Main agent tool call that spawns the subagent
        tool_start("task")
            .tool_call_id("tc-subagent")
            .arguments(json!({ "prompt": "explore code", "model": "gemini-3-pro-preview" }))
            .id("ev-2")
            .timestamp("2026-01-01T00:00:01Z")
            .build_event(),
        subagent_start("explore")
            .tool_call_id("tc-subagent")
            .agent_display_name("Explore Agent")
            .id("ev-3")
            .timestamp("2026-01-01T00:00:02Z")
            .build_event(),
        // Subagent's child tool call (grep under the subagent)
        tool_start("grep")
            .tool_call_id("tc-grep-1")
            .arguments(json!({ "pattern": "foo" }))
            .parent_tool_call_id("tc-subagent")
            .id("ev-4")
            .timestamp("2026-01-01T00:00:03Z")
            .build_event(),
        // Child tool completes WITH a model (the subagent's model)
        tool_complete("tc-grep-1")
            .parent_tool_call_id("tc-subagent")
            .model("gemini-3-pro-preview")
            .success(true)
            .result(json!("match found"))
            .id("ev-5")
            .timestamp("2026-01-01T00:00:04Z")
            .build_event(),
        subagent_complete("explore")
            .tool_call_id("tc-subagent")
            .agent_display_name("Explore Agent")
            .id("ev-6")
            .timestamp("2026-01-01T00:00:05Z")
            .build_event(),
        // Main agent tool call completes (sets real model)
        tool_complete("tc-subagent")
            .model("claude-sonnet-4")
            .success(true)
            .id("ev-7")
            .timestamp("2026-01-01T00:00:06Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-8")
            .timestamp("2026-01-01T00:00:07Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    // turn.model should NOT be gemini (the subagent's model)
    assert_ne!(
        turns[0].model.as_deref(),
        Some("gemini-3-pro-preview"),
        "turn.model must not be set from a subagent's child tool call"
    );
}
#[test]
fn correct_turn_models_fixes_polluted_model_from_subagent_child() {
    // Scenario: SubagentStarted arrives AFTER its child tool call completes,
    // so the inline guard couldn't catch it. The post-processing step should
    // still correct the turn model.
    let events = vec![
        user_msg("Hello")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2026-01-01T00:00:00Z")
            .build_event(),
        // ToolExecStart for the subagent wrapper (before SubagentStarted)
        tool_start("task")
            .tool_call_id("tc-subagent")
            .id("ev-2")
            .timestamp("2026-01-01T00:00:01Z")
            .build_event(),
        // Subagent's child tool starts
        tool_start("grep")
            .tool_call_id("tc-child")
            .parent_tool_call_id("tc-subagent")
            .id("ev-3")
            .timestamp("2026-01-01T00:00:02Z")
            .build_event(),
        // Child tool completes — at this point, parent isn't yet marked as subagent!
        tool_complete("tc-child")
            .parent_tool_call_id("tc-subagent")
            .model("gemini-3-pro-preview")
            .success(true)
            .id("ev-4")
            .timestamp("2026-01-01T00:00:03Z")
            .build_event(),
        // NOW SubagentStarted arrives — marks tc-subagent as subagent
        subagent_start("explore")
            .tool_call_id("tc-subagent")
            .agent_display_name("Explore Agent")
            .id("ev-5")
            .timestamp("2026-01-01T00:00:04Z")
            .build_event(),
        subagent_complete("explore")
            .tool_call_id("tc-subagent")
            .agent_display_name("Explore Agent")
            .id("ev-6")
            .timestamp("2026-01-01T00:00:05Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-7")
            .timestamp("2026-01-01T00:00:06Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    // Even though the inline guard couldn't catch it (parent wasn't subagent yet),
    // correct_turn_models() should have cleared the polluted model.
    assert_ne!(
        turns[0].model.as_deref(),
        Some("gemini-3-pro-preview"),
        "post-processing should correct turn.model polluted by out-of-order subagent events"
    );
}
#[test]
fn correct_turn_models_preserves_main_agent_model() {
    // Scenario: main agent (claude) does its own tool calls AND has subagents.
    // turn.model should be the main agent's model, not a subagent's.
    let events = vec![
        user_msg("Hello")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2026-01-01T00:00:00Z")
            .build_event(),
        // Main agent's own tool call
        tool_start("read_file")
            .tool_call_id("tc-main")
            .id("ev-2")
            .timestamp("2026-01-01T00:00:01Z")
            .build_event(),
        tool_complete("tc-main")
            .model("claude-sonnet-4")
            .success(true)
            .id("ev-3")
            .timestamp("2026-01-01T00:00:02Z")
            .build_event(),
        // Subagent tool call
        tool_start("task")
            .tool_call_id("tc-sub")
            .id("ev-4")
            .timestamp("2026-01-01T00:00:03Z")
            .build_event(),
        subagent_start("explore")
            .tool_call_id("tc-sub")
            .agent_display_name("Explore Agent")
            .id("ev-5")
            .timestamp("2026-01-01T00:00:04Z")
            .build_event(),
        // Subagent child tool
        tool_start("grep")
            .tool_call_id("tc-sub-child")
            .parent_tool_call_id("tc-sub")
            .id("ev-6")
            .timestamp("2026-01-01T00:00:05Z")
            .build_event(),
        tool_complete("tc-sub-child")
            .parent_tool_call_id("tc-sub")
            .model("gemini-3-pro-preview")
            .success(true)
            .id("ev-7")
            .timestamp("2026-01-01T00:00:06Z")
            .build_event(),
        subagent_complete("explore")
            .tool_call_id("tc-sub")
            .agent_display_name("Explore Agent")
            .id("ev-8")
            .timestamp("2026-01-01T00:00:07Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-9")
            .timestamp("2026-01-01T00:00:08Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].model.as_deref(),
        Some("claude-sonnet-4"),
        "turn.model should be the main agent's model, not the subagent's"
    );
}
#[test]
fn cross_turn_subagent_child_does_not_pollute_next_turn_model() {
    // Scenario: Turn 1 spawns a subagent. Turn 2 starts, and the subagent's
    // child tool calls land in Turn 2. Turn 2's model should not be the subagent's.
    let events = vec![
        // --- Turn 1: main agent spawns subagent ---
        model_change()
            .new_model("claude-sonnet-4")
            .id("ev-0")
            .timestamp("2026-01-01T00:00:00Z")
            .build_event(),
        user_msg("Turn 1")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2026-01-01T00:00:01Z")
            .build_event(),
        tool_start("task")
            .tool_call_id("tc-subagent")
            .id("ev-2")
            .timestamp("2026-01-01T00:00:02Z")
            .build_event(),
        subagent_start("explore")
            .tool_call_id("tc-subagent")
            .agent_display_name("Explore Agent")
            .id("ev-3")
            .timestamp("2026-01-01T00:00:03Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-4")
            .timestamp("2026-01-01T00:00:04Z")
            .build_event(),
        // --- Turn 2: new user message, but subagent child events arrive here ---
        user_msg("Turn 2")
            .interaction_id("int-2")
            .id("ev-5")
            .timestamp("2026-01-01T00:00:05Z")
            .build_event(),
        // Subagent's child tool call lands in Turn 2
        tool_start("grep")
            .tool_call_id("tc-child")
            .parent_tool_call_id("tc-subagent")
            .id("ev-6")
            .timestamp("2026-01-01T00:00:06Z")
            .build_event(),
        tool_complete("tc-child")
            .parent_tool_call_id("tc-subagent")
            .model("gemini-3-pro-preview")
            .success(true)
            .id("ev-7")
            .timestamp("2026-01-01T00:00:07Z")
            .build_event(),
        turn_end()
            .turn_id("turn-2")
            .id("ev-8")
            .timestamp("2026-01-01T00:00:08Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 2);

    // Turn 1 should have claude model (from SessionModelChange)
    assert_eq!(
        turns[0].model.as_deref(),
        Some("claude-sonnet-4"),
        "Turn 1 model should be main agent's model"
    );

    // Turn 2 should inherit session model (claude), not the subagent's model (gemini)
    assert_eq!(
        turns[1].model.as_deref(),
        Some("claude-sonnet-4"),
        "Turn 2 model should not be polluted by cross-turn subagent child tool calls"
    );
}

/// Regression test for the background-subagent model attribution bug.
///
/// Background subagents land their child tool calls in a later synthetic turn (Turn B/C)
/// after the main agent's turn ends (Turn A). Previously, `infer_subagent_models` only
/// scanned per-turn child tool calls, so it found zero children in Turn A and fell back
/// to overwriting the correct actual model (from `SubagentCompleted`) with the requested
/// args model.
///
/// After the fix, `infer_subagent_models` scans all turns for children, finds the correct
/// model, and either propagates it (if it differs from what's already set) or leaves the
/// terminal model in place (if they match — most common case).
#[test]
fn background_subagent_cross_turn_actual_model_preserved() {
    let events = vec![
        // Turn A: main agent turn — spawns a background subagent with opus, turn ends
        user_msg("Do a big task")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-06-01T10:00:00.000Z")
            .build_event(),
        tool_start("task")
            .tool_call_id("sub-bg-1")
            .arguments(json!({
                "agent_type": "general-purpose",
                "model": "claude-opus-4.7",
                "prompt": "Analyze the codebase"
            }))
            .id("evt-2")
            .timestamp("2026-06-01T10:00:01.000Z")
            .build_event(),
        subagent_start("general-purpose")
            .tool_call_id("sub-bg-1")
            .agent_display_name("General Purpose Agent")
            .id("evt-3")
            .timestamp("2026-06-01T10:00:02.000Z")
            .build_event(),
        // Main agent turn ends — background subagent is still running
        turn_end()
            .turn_id("turn-1")
            .id("evt-4")
            .timestamp("2026-06-01T10:00:03.000Z")
            .build_event(),
        // Turn B (synthetic): subagent's child tool calls land here, after main turn ends
        tool_start("grep")
            .tool_call_id("child-tc-1")
            .parent_tool_call_id("sub-bg-1")
            .id("evt-5")
            .timestamp("2026-06-01T10:00:04.000Z")
            .build_event(),
        tool_complete("child-tc-1")
            .parent_tool_call_id("sub-bg-1")
            // The actual model the subagent ran on (was downgraded from opus to sonnet)
            .model("claude-sonnet-4.6")
            .success(true)
            .id("evt-6")
            .timestamp("2026-06-01T10:00:05.000Z")
            .build_event(),
        turn_end()
            .turn_id("turn-bg-child")
            .id("evt-7")
            .timestamp("2026-06-01T10:00:06.000Z")
            .build_event(),
        // Turn C (synthetic): SubagentCompleted with the authoritative actual model
        subagent_complete("general-purpose")
            .tool_call_id("sub-bg-1")
            .agent_display_name("General Purpose Agent")
            .model("claude-sonnet-4.6")
            .id("evt-8")
            .timestamp("2026-06-01T10:00:07.000Z")
            .build_event(),
        turn_end()
            .turn_id("turn-bg-complete")
            .id("evt-9")
            .timestamp("2026-06-01T10:00:08.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);

    // The subagent tool call is in Turn A (index 0)
    let sub = turns
        .iter()
        .flat_map(|t| t.tool_calls.iter())
        .find(|tc| tc.tool_call_id.as_deref() == Some("sub-bg-1"))
        .expect("sub-bg-1 not found");

    assert!(sub.is_subagent);

    // The ACTUAL model (claude-sonnet-4.6) must not be overwritten by the REQUESTED
    // args model (claude-opus-4.7). This was the bug: infer_subagent_models would
    // find no children in Turn A and fall back to args_model, overwriting the correct value.
    assert_eq!(
        sub.model.as_deref(),
        Some("claude-sonnet-4.6"),
        "actual model from SubagentCompleted must not be overwritten by requested args model"
    );

    // requested_model must be populated and reflect what was in the tool call arguments
    assert_eq!(
        sub.requested_model.as_deref(),
        Some("claude-opus-4.7"),
        "requested_model must preserve the original model from tool call arguments"
    );
}
