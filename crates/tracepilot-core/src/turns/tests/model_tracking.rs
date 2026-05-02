//! Model tracking and inference tests.
//!
//! Tests for model propagation, inference from subagents, and session model changes.
//!
//! ## Tests Included
//! - Subagent model inference from child tool calls
//! - Model overriding and propagation
//! - Session model changes and persistence
//! - Turn model inheritance

use super::*;

#[test]
fn infers_subagent_model_from_child_tool_calls() {
    let events = vec![
        user_msg("Run agent")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        // Subagent with children that have a model
        subagent_start("explore")
            .tool_call_id("sub-1")
            .agent_display_name("Explore Agent")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        // Child tool call under sub-1 with a known model
        tool_start("grep")
            .tool_call_id("tc-child-1")
            .parent_tool_call_id("sub-1")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.500Z")
            .parent("evt-2")
            .build_event(),
        tool_complete("tc-child-1")
            .parent_tool_call_id("sub-1")
            .model("claude-haiku-4.5")
            .success(true)
            .id("evt-4")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-3")
            .build_event(),
        subagent_complete("explore")
            .tool_call_id("sub-1")
            .agent_display_name("Explore Agent")
            .id("evt-5")
            .timestamp("2026-03-10T07:14:54.000Z")
            .parent("evt-2")
            .build_event(),
        // Subagent without any children (model stays None)
        subagent_start("task")
            .tool_call_id("sub-2")
            .agent_display_name("Task Agent")
            .id("evt-6")
            .timestamp("2026-03-10T07:14:55.000Z")
            .parent("evt-1")
            .build_event(),
        subagent_complete("task")
            .tool_call_id("sub-2")
            .agent_display_name("Task Agent")
            .id("evt-7")
            .timestamp("2026-03-10T07:14:56.000Z")
            .parent("evt-6")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);

    // sub-1 should have model inferred from its child tool call
    let sub1 = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.tool_call_id.as_deref() == Some("sub-1"))
        .expect("sub-1 not found");
    assert!(sub1.is_subagent);
    assert_eq!(sub1.model.as_deref(), Some("claude-haiku-4.5"));

    // sub-2 has no children, so model stays None
    let sub2 = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.tool_call_id.as_deref() == Some("sub-2"))
        .expect("sub-2 not found");
    assert!(sub2.is_subagent);
    assert_eq!(sub2.model, None);
}
#[test]
fn subagent_model_overrides_wrong_parent_model() {
    let events = vec![
        user_msg("Review code")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-04-01T10:00:00.000Z")
            .build_event(),
        // 1. ToolExecStart for the subagent tool call (arguments contain the real model)
        tool_start("task")
            .tool_call_id("sub-1")
            .arguments(json!({
                "agent_type": "code-review",
                "model": "gemini-3-pro-preview",
                "prompt": "Review the diff"
            }))
            .id("evt-2")
            .timestamp("2026-04-01T10:00:01.000Z")
            .parent("evt-1")
            .build_event(),
        // 2. ToolExecComplete for the subagent — model is WRONG (parent's model)
        tool_complete("sub-1")
            .model("claude-opus-4.6")
            .interaction_id("int-1")
            .success(true)
            .tool_telemetry(json!({
                "properties": {
                    "model": "gemini-3-pro-preview"
                }
            }))
            .id("evt-3")
            .timestamp("2026-04-01T10:00:02.000Z")
            .parent("evt-2")
            .build_event(),
        // 3. SubagentStarted enriches the tool call
        subagent_start("code-review")
            .tool_call_id("sub-1")
            .agent_display_name("Code Review Agent")
            .id("evt-4")
            .timestamp("2026-04-01T10:00:03.000Z")
            .parent("evt-2")
            .build_event(),
        // 4. Child ToolExecStart under the subagent
        tool_start("grep")
            .tool_call_id("tc-child-1")
            .parent_tool_call_id("sub-1")
            .id("evt-5")
            .timestamp("2026-04-01T10:00:04.000Z")
            .parent("evt-4")
            .build_event(),
        // 5. Child ToolExecComplete with the CORRECT subagent model
        tool_complete("tc-child-1")
            .parent_tool_call_id("sub-1")
            .model("gemini-3-pro-preview")
            .success(true)
            .id("evt-6")
            .timestamp("2026-04-01T10:00:05.000Z")
            .parent("evt-5")
            .build_event(),
        subagent_complete("code-review")
            .tool_call_id("sub-1")
            .agent_display_name("Code Review Agent")
            .id("evt-7")
            .timestamp("2026-04-01T10:00:06.000Z")
            .parent("evt-4")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);

    let sub1 = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.tool_call_id.as_deref() == Some("sub-1"))
        .expect("sub-1 not found");
    assert!(sub1.is_subagent);
    // Must be the child's model, NOT the parent's "claude-opus-4.6"
    assert_eq!(
        sub1.model.as_deref(),
        Some("gemini-3-pro-preview"),
        "subagent model should be overridden by child model, not the parent's model"
    );
}
#[test]
fn nested_subagent_model_propagation() {
    let events = vec![
        user_msg("Deep task")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-05-01T12:00:00.000Z")
            .build_event(),
        // Outer subagent: ToolExecStart
        tool_start("task")
            .tool_call_id("outer-sub")
            .arguments(json!({"agent_type": "general-purpose"}))
            .id("evt-2")
            .timestamp("2026-05-01T12:00:01.000Z")
            .parent("evt-1")
            .build_event(),
        // Outer subagent: ToolExecComplete with wrong parent model
        tool_complete("outer-sub")
            .model("claude-opus-4.6")
            .interaction_id("int-1")
            .success(true)
            .id("evt-3")
            .timestamp("2026-05-01T12:00:02.000Z")
            .parent("evt-2")
            .build_event(),
        subagent_start("general-purpose")
            .tool_call_id("outer-sub")
            .agent_display_name("General Purpose Agent")
            .id("evt-4")
            .timestamp("2026-05-01T12:00:03.000Z")
            .parent("evt-2")
            .build_event(),
        // Inner subagent (child of outer): ToolExecStart
        tool_start("task")
            .tool_call_id("inner-sub")
            .arguments(json!({"agent_type": "explore"}))
            .parent_tool_call_id("outer-sub")
            .id("evt-5")
            .timestamp("2026-05-01T12:00:04.000Z")
            .parent("evt-4")
            .build_event(),
        // Inner subagent: ToolExecComplete with outer's model (wrong for inner)
        tool_complete("inner-sub")
            .parent_tool_call_id("outer-sub")
            .model("claude-sonnet-4.5")
            .success(true)
            .id("evt-6")
            .timestamp("2026-05-01T12:00:05.000Z")
            .parent("evt-5")
            .build_event(),
        subagent_start("explore")
            .tool_call_id("inner-sub")
            .agent_display_name("Explore Agent")
            .id("evt-7")
            .timestamp("2026-05-01T12:00:06.000Z")
            .parent("evt-5")
            .build_event(),
        // Leaf tool call under inner subagent
        tool_start("view")
            .tool_call_id("leaf-tc")
            .parent_tool_call_id("inner-sub")
            .id("evt-8")
            .timestamp("2026-05-01T12:00:07.000Z")
            .parent("evt-7")
            .build_event(),
        tool_complete("leaf-tc")
            .parent_tool_call_id("inner-sub")
            .model("claude-haiku-4.5")
            .success(true)
            .id("evt-9")
            .timestamp("2026-05-01T12:00:08.000Z")
            .parent("evt-8")
            .build_event(),
        // Complete inner, then outer
        subagent_complete("explore")
            .tool_call_id("inner-sub")
            .agent_display_name("Explore Agent")
            .id("evt-10")
            .timestamp("2026-05-01T12:00:09.000Z")
            .parent("evt-7")
            .build_event(),
        subagent_complete("general-purpose")
            .tool_call_id("outer-sub")
            .agent_display_name("General Purpose Agent")
            .id("evt-11")
            .timestamp("2026-05-01T12:00:10.000Z")
            .parent("evt-4")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);

    // Inner subagent should get its model from the leaf tool call
    let inner = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.tool_call_id.as_deref() == Some("inner-sub"))
        .expect("inner-sub not found");
    assert!(inner.is_subagent);
    assert_eq!(
        inner.model.as_deref(),
        Some("claude-haiku-4.5"),
        "inner subagent model should come from its leaf child"
    );

    // Outer subagent should get its model from the inner subagent (after inner was resolved)
    let outer = turns[0]
        .tool_calls
        .iter()
        .find(|tc| tc.tool_call_id.as_deref() == Some("outer-sub"))
        .expect("outer-sub not found");
    assert!(outer.is_subagent);
    assert_eq!(
        outer.model.as_deref(),
        Some("claude-haiku-4.5"),
        "outer subagent model should propagate from inner subagent's resolved model"
    );
}
#[test]
fn session_model_change_sets_turn_model() {
    let events = vec![
        user_msg("Hello")
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
        model_change()
            .new_model("claude-sonnet-4")
            .id("ev-3")
            .timestamp("2025-01-01T00:00:02Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-4")
            .timestamp("2025-01-01T00:00:03Z")
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].model.as_deref(),
        Some("claude-sonnet-4"),
        "model change event should set the turn's model"
    );
}
#[test]
fn session_start_seeds_model() {
    let events = vec![
        make_event(
            SessionEventType::SessionStart,
            TypedEventData::SessionStart(SessionStartData {
                selected_model: Some("gpt-4.1".to_string()),
                session_id: None,
                version: None,
                producer: None,
                copilot_version: None,
                start_time: None,
                reasoning_effort: None,
                context: None,
                already_in_use: None,
                remote_steerable: None,
            }),
            "ev-start",
            "2025-01-01T00:00:00Z",
            None,
        ),
        user_msg("Hello")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].model.as_deref(),
        Some("gpt-4.1"),
        "SessionStart should seed turn model"
    );
}
#[test]
fn session_resume_seeds_model() {
    let events = vec![
        make_event(
            SessionEventType::SessionResume,
            TypedEventData::SessionResume(SessionResumeData {
                selected_model: Some("claude-3-haiku".to_string()),
                resume_time: None,
                copilot_version: None,
                event_count: None,
                reasoning_effort: None,
                context: None,
                already_in_use: None,
                remote_steerable: None,
            }),
            "ev-resume",
            "2025-01-01T00:00:00Z",
            None,
        ),
        user_msg("Hello again")
            .interaction_id("int-2")
            .id("ev-2")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].model.as_deref(),
        Some("claude-3-haiku"),
        "SessionResume should seed turn model"
    );
}
#[test]
fn ensure_current_turn_inherits_session_model() {
    // Test that if a turn is created via ensure_current_turn (e.g. from AssistantTurnStart)
    // instead of UserMessage, it still inherits the session model.
    let events = vec![
        make_event(
            SessionEventType::SessionStart,
            TypedEventData::SessionStart(SessionStartData {
                selected_model: Some("claude-3-opus".to_string()),
                session_id: None,
                version: None,
                producer: None,
                copilot_version: None,
                start_time: None,
                reasoning_effort: None,
                context: None,
                already_in_use: None,
                remote_steerable: None,
            }),
            "ev-start",
            "2025-01-01T00:00:00Z",
            None,
        ),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].model.as_deref(),
        Some("claude-3-opus"),
        "Synthetic turn from ensure_current_turn should inherit session model"
    );
}
#[test]
fn session_model_change_does_not_overwrite_existing_model() {
    let events = vec![
        user_msg("Hello")
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
        tool_start("read_file")
            .tool_call_id("tc-1")
            .id("ev-2b")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
        tool_complete("tc-1")
            .model("gpt-4o")
            .success(true)
            .id("ev-3")
            .timestamp("2025-01-01T00:00:02Z")
            .build_event(),
        model_change()
            .previous_model("gpt-4o")
            .new_model("claude-sonnet-4")
            .id("ev-4")
            .timestamp("2025-01-01T00:00:03Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-5")
            .timestamp("2025-01-01T00:00:04Z")
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].model.as_deref(),
        Some("gpt-4o"),
        "model change should not overwrite model already set by tool completion"
    );
}
#[test]
fn session_model_change_persists_across_turns() {
    // Model change between turns should be inherited by the next turn
    let events = vec![
        model_change()
            .new_model("claude-sonnet-4")
            .id("ev-0")
            .timestamp("2025-01-01T00:00:00Z")
            .build_event(),
        user_msg("Hello")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("ev-2")
            .timestamp("2025-01-01T00:00:02Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-3")
            .timestamp("2025-01-01T00:00:03Z")
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].model.as_deref(),
        Some("claude-sonnet-4"),
        "turn should inherit session_model from prior model change"
    );
}
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
