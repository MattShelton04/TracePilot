//! Basic turn reconstruction tests.
//!
//! Tests the core logic for reconstructing conversation turns from flat event streams.
//! Validates the happy path scenarios without edge cases.
//!
//! ## Tests Included
//! - `reconstructs_simple_single_turn`: Single user message → assistant response → turn end
//! - `reconstructs_multiple_turns`: Multiple sequential turns with clean boundaries

use super::*;

#[test]
fn reconstructs_simple_single_turn() {
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
            "evt-1",
            "2026-03-10T07:14:51.000Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("turn-1".to_string()),
                interaction_id: Some("int-1".to_string()),
            }),
            "evt-2",
            "2026-03-10T07:14:51.100Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-1".to_string()),
                content: Some("Hi there!".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-3",
            "2026-03-10T07:14:52.000Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-1".to_string()),
                tool_name: Some("read_file".to_string()),
                arguments: Some(json!({ "path": "src/lib.rs" })),
                parent_tool_call_id: None,
                mcp_server_name: Some("filesystem".to_string()),
                mcp_tool_name: Some("read".to_string()),
            }),
            "evt-4",
            "2026-03-10T07:14:52.100Z",
            Some("evt-3"),
        ),
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-1".to_string()),
                parent_tool_call_id: None,
                model: Some("claude-opus-4.6".to_string()),
                interaction_id: Some("int-1".to_string()),
                success: Some(true),
                result: Some(json!("ok")),
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "evt-5",
            "2026-03-10T07:14:52.500Z",
            Some("evt-4"),
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "evt-6",
            "2026-03-10T07:14:53.000Z",
            Some("evt-2"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);

    let turn = &turns[0];
    assert_eq!(turn.turn_index, 0);
    assert_eq!(turn.turn_id.as_deref(), Some("turn-1"));
    assert_eq!(turn.interaction_id.as_deref(), Some("int-1"));
    assert_eq!(turn.user_message.as_deref(), Some("Hello"));
    assert_eq!(msg_contents(&turn.assistant_messages), vec!["Hi there!"]);
    assert_eq!(turn.model.as_deref(), Some("claude-opus-4.6"));
    assert_eq!(turn.duration_ms, Some(2_000));
    assert!(turn.is_complete);
    assert_eq!(turn.tool_calls.len(), 1);

    let tool_call = &turn.tool_calls[0];
    assert_eq!(tool_call.tool_call_id.as_deref(), Some("tc-1"));
    assert_eq!(tool_call.tool_name, "read_file");
    assert_eq!(tool_call.arguments, Some(json!({ "path": "src/lib.rs" })));
    assert_eq!(tool_call.success, Some(true));
    assert_eq!(tool_call.duration_ms, Some(400));
    assert_eq!(tool_call.mcp_server_name.as_deref(), Some("filesystem"));
    assert_eq!(tool_call.mcp_tool_name.as_deref(), Some("read"));
    assert!(tool_call.is_complete);
}

#[test]
fn reconstructs_multiple_turns() {
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("First".to_string()),
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
        make_event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("turn-1".to_string()),
                interaction_id: Some("int-1".to_string()),
            }),
            "evt-2",
            "2026-03-10T07:14:51.100Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-1".to_string()),
                content: Some("Response one".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-3",
            "2026-03-10T07:14:52.000Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "evt-4",
            "2026-03-10T07:14:53.000Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Second".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-2".to_string()),
                source: None,
                agent_mode: None,
            }),
            "evt-5",
            "2026-03-10T07:14:54.000Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("turn-2".to_string()),
                interaction_id: Some("int-2".to_string()),
            }),
            "evt-6",
            "2026-03-10T07:14:54.100Z",
            Some("evt-5"),
        ),
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-2".to_string()),
                content: Some("Response two".to_string()),
                interaction_id: Some("int-2".to_string()),
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-7",
            "2026-03-10T07:14:55.000Z",
            Some("evt-6"),
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-2".to_string()),
            }),
            "evt-8",
            "2026-03-10T07:14:56.000Z",
            Some("evt-6"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].turn_index, 0);
    assert_eq!(turns[1].turn_index, 1);
    assert_eq!(turns[0].user_message.as_deref(), Some("First"));
    assert_eq!(turns[1].user_message.as_deref(), Some("Second"));
    assert!(turns.iter().all(|turn| turn.is_complete));
}
