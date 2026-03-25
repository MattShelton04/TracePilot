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
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Run agent".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "evt-1",
            "2026-03-10T07:14:51.000Z",
            None,
        ),
        // Subagent with children that have a model
        make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("sub-1".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                agent_description: None,
            }),
            "evt-2",
            "2026-03-10T07:14:52.000Z",
            Some("evt-1"),
        ),
        // Child tool call under sub-1 with a known model
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-child-1".to_string()),
                tool_name: Some("grep".to_string()),
                arguments: None,
                parent_tool_call_id: Some("sub-1".to_string()),
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-3",
            "2026-03-10T07:14:52.500Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-child-1".to_string()),
                parent_tool_call_id: Some("sub-1".to_string()),
                model: Some("claude-haiku-4.5".to_string()),
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "evt-4",
            "2026-03-10T07:14:53.000Z",
            Some("evt-3"),
        ),
        make_event(
            SessionEventType::SubagentCompleted,
            TypedEventData::SubagentCompleted(SubagentCompletedData {
                tool_call_id: Some("sub-1".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
            }),
            "evt-5",
            "2026-03-10T07:14:54.000Z",
            Some("evt-2"),
        ),
        // Subagent without any children (model stays None)
        make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("sub-2".to_string()),
                agent_name: Some("task".to_string()),
                agent_display_name: Some("Task Agent".to_string()),
                agent_description: None,
            }),
            "evt-6",
            "2026-03-10T07:14:55.000Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::SubagentCompleted,
            TypedEventData::SubagentCompleted(SubagentCompletedData {
                tool_call_id: Some("sub-2".to_string()),
                agent_name: Some("task".to_string()),
                agent_display_name: Some("Task Agent".to_string()),
            }),
            "evt-7",
            "2026-03-10T07:14:56.000Z",
            Some("evt-6"),
        ),
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
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Review code".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "evt-1",
            "2026-04-01T10:00:00.000Z",
            None,
        ),
        // 1. ToolExecStart for the subagent tool call (arguments contain the real model)
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("sub-1".to_string()),
                tool_name: Some("task".to_string()),
                arguments: Some(json!({
                    "agent_type": "code-review",
                    "model": "gemini-3-pro-preview",
                    "prompt": "Review the diff"
                })),
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-2",
            "2026-04-01T10:00:01.000Z",
            Some("evt-1"),
        ),
        // 2. ToolExecComplete for the subagent — model is WRONG (parent's model)
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("sub-1".to_string()),
                parent_tool_call_id: None,
                model: Some("claude-opus-4.6".to_string()),
                interaction_id: Some("int-1".to_string()),
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: Some(json!({
                    "properties": {
                        "model": "gemini-3-pro-preview"
                    }
                })),
                is_user_requested: None,
            }),
            "evt-3",
            "2026-04-01T10:00:02.000Z",
            Some("evt-2"),
        ),
        // 3. SubagentStarted enriches the tool call
        make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("sub-1".to_string()),
                agent_name: Some("code-review".to_string()),
                agent_display_name: Some("Code Review Agent".to_string()),
                agent_description: None,
            }),
            "evt-4",
            "2026-04-01T10:00:03.000Z",
            Some("evt-2"),
        ),
        // 4. Child ToolExecStart under the subagent
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-child-1".to_string()),
                tool_name: Some("grep".to_string()),
                arguments: None,
                parent_tool_call_id: Some("sub-1".to_string()),
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-5",
            "2026-04-01T10:00:04.000Z",
            Some("evt-4"),
        ),
        // 5. Child ToolExecComplete with the CORRECT subagent model
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-child-1".to_string()),
                parent_tool_call_id: Some("sub-1".to_string()),
                model: Some("gemini-3-pro-preview".to_string()),
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "evt-6",
            "2026-04-01T10:00:05.000Z",
            Some("evt-5"),
        ),
        make_event(
            SessionEventType::SubagentCompleted,
            TypedEventData::SubagentCompleted(SubagentCompletedData {
                tool_call_id: Some("sub-1".to_string()),
                agent_name: Some("code-review".to_string()),
                agent_display_name: Some("Code Review Agent".to_string()),
            }),
            "evt-7",
            "2026-04-01T10:00:06.000Z",
            Some("evt-4"),
        ),
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
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Deep task".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "evt-1",
            "2026-05-01T12:00:00.000Z",
            None,
        ),
        // Outer subagent: ToolExecStart
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("outer-sub".to_string()),
                tool_name: Some("task".to_string()),
                arguments: Some(json!({"agent_type": "general-purpose"})),
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-2",
            "2026-05-01T12:00:01.000Z",
            Some("evt-1"),
        ),
        // Outer subagent: ToolExecComplete with wrong parent model
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("outer-sub".to_string()),
                parent_tool_call_id: None,
                model: Some("claude-opus-4.6".to_string()),
                interaction_id: Some("int-1".to_string()),
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "evt-3",
            "2026-05-01T12:00:02.000Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("outer-sub".to_string()),
                agent_name: Some("general-purpose".to_string()),
                agent_display_name: Some("General Purpose Agent".to_string()),
                agent_description: None,
            }),
            "evt-4",
            "2026-05-01T12:00:03.000Z",
            Some("evt-2"),
        ),
        // Inner subagent (child of outer): ToolExecStart
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("inner-sub".to_string()),
                tool_name: Some("task".to_string()),
                arguments: Some(json!({"agent_type": "explore"})),
                parent_tool_call_id: Some("outer-sub".to_string()),
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-5",
            "2026-05-01T12:00:04.000Z",
            Some("evt-4"),
        ),
        // Inner subagent: ToolExecComplete with outer's model (wrong for inner)
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("inner-sub".to_string()),
                parent_tool_call_id: Some("outer-sub".to_string()),
                model: Some("claude-sonnet-4.5".to_string()),
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "evt-6",
            "2026-05-01T12:00:05.000Z",
            Some("evt-5"),
        ),
        make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("inner-sub".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                agent_description: None,
            }),
            "evt-7",
            "2026-05-01T12:00:06.000Z",
            Some("evt-5"),
        ),
        // Leaf tool call under inner subagent
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("leaf-tc".to_string()),
                tool_name: Some("view".to_string()),
                arguments: None,
                parent_tool_call_id: Some("inner-sub".to_string()),
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-8",
            "2026-05-01T12:00:07.000Z",
            Some("evt-7"),
        ),
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("leaf-tc".to_string()),
                parent_tool_call_id: Some("inner-sub".to_string()),
                model: Some("claude-haiku-4.5".to_string()),
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "evt-9",
            "2026-05-01T12:00:08.000Z",
            Some("evt-8"),
        ),
        // Complete inner, then outer
        make_event(
            SessionEventType::SubagentCompleted,
            TypedEventData::SubagentCompleted(SubagentCompletedData {
                tool_call_id: Some("inner-sub".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
            }),
            "evt-10",
            "2026-05-01T12:00:09.000Z",
            Some("evt-7"),
        ),
        make_event(
            SessionEventType::SubagentCompleted,
            TypedEventData::SubagentCompleted(SubagentCompletedData {
                tool_call_id: Some("outer-sub".to_string()),
                agent_name: Some("general-purpose".to_string()),
                agent_display_name: Some("General Purpose Agent".to_string()),
            }),
            "evt-11",
            "2026-05-01T12:00:10.000Z",
            Some("evt-4"),
        ),
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
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Hello".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "ev-1",
            "2025-01-01T00:00:00Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("turn-1".to_string()),
                interaction_id: Some("int-1".to_string()),
            }),
            "ev-2",
            "2025-01-01T00:00:01Z",
            None,
        ),
        make_event(
            SessionEventType::SessionModelChange,
            TypedEventData::ModelChange(ModelChangeData {
                previous_model: None,
                new_model: Some("claude-sonnet-4".to_string()),
                previous_reasoning_effort: None,
                reasoning_effort: None,
            }),
            "ev-3",
            "2025-01-01T00:00:02Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "ev-4",
            "2025-01-01T00:00:03Z",
            None,
        ),
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
            }),
            "ev-start",
            "2025-01-01T00:00:00Z",
            None,
        ),
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Hello".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "ev-1",
            "2025-01-01T00:00:01Z",
            None,
        ),
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
                event_count: None,
                reasoning_effort: None,
                context: None,
                already_in_use: None,
            }),
            "ev-resume",
            "2025-01-01T00:00:00Z",
            None,
        ),
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Hello again".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-2".to_string()),
                source: None,
                agent_mode: None,
            }),
            "ev-2",
            "2025-01-01T00:00:01Z",
            None,
        ),
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
            }),
            "ev-start",
            "2025-01-01T00:00:00Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("turn-1".to_string()),
                interaction_id: Some("int-1".to_string()),
            }),
            "ev-1",
            "2025-01-01T00:00:01Z",
            None,
        ),
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
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Hello".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "ev-1",
            "2025-01-01T00:00:00Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("turn-1".to_string()),
                interaction_id: Some("int-1".to_string()),
            }),
            "ev-2",
            "2025-01-01T00:00:01Z",
            None,
        ),
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-1".to_string()),
                tool_name: Some("read_file".to_string()),
                arguments: None,
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-2b",
            "2025-01-01T00:00:01Z",
            None,
        ),
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-1".to_string()),
                parent_tool_call_id: None,
                model: Some("gpt-4o".to_string()),
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "ev-3",
            "2025-01-01T00:00:02Z",
            None,
        ),
        make_event(
            SessionEventType::SessionModelChange,
            TypedEventData::ModelChange(ModelChangeData {
                previous_model: Some("gpt-4o".to_string()),
                new_model: Some("claude-sonnet-4".to_string()),
                previous_reasoning_effort: None,
                reasoning_effort: None,
            }),
            "ev-4",
            "2025-01-01T00:00:03Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "ev-5",
            "2025-01-01T00:00:04Z",
            None,
        ),
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
        make_event(
            SessionEventType::SessionModelChange,
            TypedEventData::ModelChange(ModelChangeData {
                previous_model: None,
                new_model: Some("claude-sonnet-4".to_string()),
                previous_reasoning_effort: None,
                reasoning_effort: None,
            }),
            "ev-0",
            "2025-01-01T00:00:00Z",
            None,
        ),
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Hello".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "ev-1",
            "2025-01-01T00:00:01Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("turn-1".to_string()),
                interaction_id: Some("int-1".to_string()),
            }),
            "ev-2",
            "2025-01-01T00:00:02Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "ev-3",
            "2025-01-01T00:00:03Z",
            None,
        ),
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
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Hello".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "ev-1",
            "2026-01-01T00:00:00Z",
            None,
        ),
        // Main agent tool call that spawns the subagent
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-subagent".to_string()),
                tool_name: Some("task".to_string()),
                arguments: Some(json!({ "prompt": "explore code", "model": "gemini-3-pro-preview" })),
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-2",
            "2026-01-01T00:00:01Z",
            None,
        ),
        make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("tc-subagent".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                agent_description: None,
            }),
            "ev-3",
            "2026-01-01T00:00:02Z",
            None,
        ),
        // Subagent's child tool call (grep under the subagent)
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-grep-1".to_string()),
                tool_name: Some("grep".to_string()),
                arguments: Some(json!({ "pattern": "foo" })),
                parent_tool_call_id: Some("tc-subagent".to_string()),
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-4",
            "2026-01-01T00:00:03Z",
            None,
        ),
        // Child tool completes WITH a model (the subagent's model)
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-grep-1".to_string()),
                parent_tool_call_id: Some("tc-subagent".to_string()),
                model: Some("gemini-3-pro-preview".to_string()),
                interaction_id: None,
                success: Some(true),
                result: Some(json!("match found")),
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "ev-5",
            "2026-01-01T00:00:04Z",
            None,
        ),
        make_event(
            SessionEventType::SubagentCompleted,
            TypedEventData::SubagentCompleted(SubagentCompletedData {
                tool_call_id: Some("tc-subagent".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
            }),
            "ev-6",
            "2026-01-01T00:00:05Z",
            None,
        ),
        // Main agent tool call completes (sets real model)
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-subagent".to_string()),
                parent_tool_call_id: None,
                model: Some("claude-sonnet-4".to_string()),
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "ev-7",
            "2026-01-01T00:00:06Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "ev-8",
            "2026-01-01T00:00:07Z",
            None,
        ),
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
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Hello".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "ev-1",
            "2026-01-01T00:00:00Z",
            None,
        ),
        // ToolExecStart for the subagent wrapper (before SubagentStarted)
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-subagent".to_string()),
                tool_name: Some("task".to_string()),
                arguments: None,
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-2",
            "2026-01-01T00:00:01Z",
            None,
        ),
        // Subagent's child tool starts
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-child".to_string()),
                tool_name: Some("grep".to_string()),
                arguments: None,
                parent_tool_call_id: Some("tc-subagent".to_string()),
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-3",
            "2026-01-01T00:00:02Z",
            None,
        ),
        // Child tool completes — at this point, parent isn't yet marked as subagent!
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-child".to_string()),
                parent_tool_call_id: Some("tc-subagent".to_string()),
                model: Some("gemini-3-pro-preview".to_string()),
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "ev-4",
            "2026-01-01T00:00:03Z",
            None,
        ),
        // NOW SubagentStarted arrives — marks tc-subagent as subagent
        make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("tc-subagent".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                agent_description: None,
            }),
            "ev-5",
            "2026-01-01T00:00:04Z",
            None,
        ),
        make_event(
            SessionEventType::SubagentCompleted,
            TypedEventData::SubagentCompleted(SubagentCompletedData {
                tool_call_id: Some("tc-subagent".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
            }),
            "ev-6",
            "2026-01-01T00:00:05Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "ev-7",
            "2026-01-01T00:00:06Z",
            None,
        ),
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
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Hello".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "ev-1",
            "2026-01-01T00:00:00Z",
            None,
        ),
        // Main agent's own tool call
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-main".to_string()),
                tool_name: Some("read_file".to_string()),
                arguments: None,
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-2",
            "2026-01-01T00:00:01Z",
            None,
        ),
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-main".to_string()),
                parent_tool_call_id: None,
                model: Some("claude-sonnet-4".to_string()),
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "ev-3",
            "2026-01-01T00:00:02Z",
            None,
        ),
        // Subagent tool call
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-sub".to_string()),
                tool_name: Some("task".to_string()),
                arguments: None,
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-4",
            "2026-01-01T00:00:03Z",
            None,
        ),
        make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("tc-sub".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                agent_description: None,
            }),
            "ev-5",
            "2026-01-01T00:00:04Z",
            None,
        ),
        // Subagent child tool
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-sub-child".to_string()),
                tool_name: Some("grep".to_string()),
                arguments: None,
                parent_tool_call_id: Some("tc-sub".to_string()),
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-6",
            "2026-01-01T00:00:05Z",
            None,
        ),
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-sub-child".to_string()),
                parent_tool_call_id: Some("tc-sub".to_string()),
                model: Some("gemini-3-pro-preview".to_string()),
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "ev-7",
            "2026-01-01T00:00:06Z",
            None,
        ),
        make_event(
            SessionEventType::SubagentCompleted,
            TypedEventData::SubagentCompleted(SubagentCompletedData {
                tool_call_id: Some("tc-sub".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
            }),
            "ev-8",
            "2026-01-01T00:00:07Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "ev-9",
            "2026-01-01T00:00:08Z",
            None,
        ),
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
        make_event(
            SessionEventType::SessionModelChange,
            TypedEventData::ModelChange(ModelChangeData {
                previous_model: None,
                new_model: Some("claude-sonnet-4".to_string()),
                previous_reasoning_effort: None,
                reasoning_effort: None,
            }),
            "ev-0",
            "2026-01-01T00:00:00Z",
            None,
        ),
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Turn 1".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "ev-1",
            "2026-01-01T00:00:01Z",
            None,
        ),
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-subagent".to_string()),
                tool_name: Some("task".to_string()),
                arguments: None,
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-2",
            "2026-01-01T00:00:02Z",
            None,
        ),
        make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("tc-subagent".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                agent_description: None,
            }),
            "ev-3",
            "2026-01-01T00:00:03Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "ev-4",
            "2026-01-01T00:00:04Z",
            None,
        ),
        // --- Turn 2: new user message, but subagent child events arrive here ---
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Turn 2".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-2".to_string()),
                source: None,
                agent_mode: None,
            }),
            "ev-5",
            "2026-01-01T00:00:05Z",
            None,
        ),
        // Subagent's child tool call lands in Turn 2
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-child".to_string()),
                tool_name: Some("grep".to_string()),
                arguments: None,
                parent_tool_call_id: Some("tc-subagent".to_string()),
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-6",
            "2026-01-01T00:00:06Z",
            None,
        ),
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-child".to_string()),
                parent_tool_call_id: Some("tc-subagent".to_string()),
                model: Some("gemini-3-pro-preview".to_string()),
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "ev-7",
            "2026-01-01T00:00:07Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-2".to_string()),
            }),
            "ev-8",
            "2026-01-01T00:00:08Z",
            None,
        ),
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
