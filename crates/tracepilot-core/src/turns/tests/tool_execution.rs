//! Tool execution tests.
//!
//! Tests for tool call lifecycle, completion tracking, and result handling.
//!
//! ## Tests Included
//! - Orphaned tool call handling
//! - Tool execution completion
//! - Deduplication of tool starts
//! - Intention summary extraction
//! - Polymorphic result handling

use super::*;

#[test]
fn leaves_orphaned_tool_call_incomplete() {
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
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-1".to_string()),
                tool_name: Some("read_file".to_string()),
                arguments: None,
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-2",
            "2026-03-10T07:14:52.000Z",
            Some("evt-1"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].tool_calls.len(), 1);
    assert!(!turns[0].tool_calls[0].is_complete);
    assert!(turns[0].tool_calls[0].completed_at.is_none());
}
#[test]
fn tool_exec_complete_finds_entry_in_finalized_turn() {
    // ToolExecutionComplete may also arrive after turn boundary
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Do something".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "evt-1",
            "2026-03-10T10:00:00.000Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("turn-1".to_string()),
                interaction_id: Some("int-1".to_string()),
            }),
            "evt-2",
            "2026-03-10T10:00:00.100Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-slow".to_string()),
                tool_name: Some("powershell".to_string()),
                arguments: Some(json!({ "command": "sleep 300" })),
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-3",
            "2026-03-10T10:00:01.000Z",
            Some("evt-2"),
        ),
        // Turn ends before tool completes
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "evt-4",
            "2026-03-10T10:00:02.000Z",
            Some("evt-2"),
        ),
        // ToolExecComplete arrives after turn is finalized
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-slow".to_string()),
                parent_tool_call_id: None,
                model: Some("claude-opus-4.6".to_string()),
                interaction_id: Some("int-1".to_string()),
                success: Some(true),
                result: Some(json!("done")),
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "evt-5",
            "2026-03-10T10:05:01.000Z",
            None,
        ),
    ];

    let turns = reconstruct_turns(&events);
    let tc = &turns[0].tool_calls[0];
    assert_eq!(tc.tool_call_id.as_deref(), Some("tc-slow"));
    assert!(tc.is_complete);
    assert_eq!(tc.success, Some(true));
    // Duration should be ~5 minutes
    assert!(tc.duration_ms.unwrap() > 290_000, "Duration should be >290s, got {}ms", tc.duration_ms.unwrap());
}
#[test]
fn duplicate_tool_execution_start_is_deduplicated() {
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Do work".to_string()),
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
        // First ToolExecutionStart
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-dup".to_string()),
                tool_name: Some("read_file".to_string()),
                arguments: None,
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-3",
            "2025-01-01T00:00:02Z",
            None,
        ),
        // Duplicate ToolExecutionStart with same ID
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-dup".to_string()),
                tool_name: Some("read_file".to_string()),
                arguments: None,
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "ev-3-dup",
            "2025-01-01T00:00:02Z",
            None,
        ),
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-dup".to_string()),
                parent_tool_call_id: None,
                model: None,
                interaction_id: None,
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
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
        turns[0].tool_calls.len(),
        1,
        "duplicate ToolExecutionStart should be deduplicated"
    );
}
#[test]
fn extracts_intention_summary_for_tool_calls() {
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Fix the bug".to_string()),
                transformed_content: Some("[[datetime]] Fix the bug [[reminders]]".to_string()),
                attachments: Some(vec![json!({"type": "file", "path": "src/main.rs"})]),
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "evt-1",
            "2026-03-10T07:14:51.000Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-1".to_string()),
                content: Some("".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: Some(vec![json!({
                    "toolCallId": "tc-1",
                    "name": "view",
                    "intentionSummary": "view the file at src/main.rs",
                    "arguments": {"path": "src/main.rs"}
                })]),
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-2",
            "2026-03-10T07:14:52.000Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-1".to_string()),
                tool_name: Some("view".to_string()),
                arguments: Some(json!({"path": "src/main.rs"})),
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-3",
            "2026-03-10T07:14:52.100Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-1".to_string()),
                parent_tool_call_id: None,
                model: Some("claude-opus-4.6".to_string()),
                interaction_id: Some("int-1".to_string()),
                success: Some(true),
                result: Some(json!({"content": "fn main() { println!(\"hello\"); }", "detailedContent": "1. fn main() {\n2.     println!(\"hello\");\n3. }"})),
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "evt-4",
            "2026-03-10T07:14:52.500Z",
            Some("evt-3"),
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "evt-5",
            "2026-03-10T07:14:53.000Z",
            Some("evt-1"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    let turn = &turns[0];

    // Transformed user message and attachments preserved
    assert_eq!(
        turn.transformed_user_message.as_deref(),
        Some("[[datetime]] Fix the bug [[reminders]]")
    );
    assert!(turn.attachments.is_some());
    assert_eq!(turn.attachments.as_ref().unwrap().len(), 1);

    // Tool call has intention summary
    assert_eq!(turn.tool_calls.len(), 1);
    let tc = &turn.tool_calls[0];
    assert_eq!(
        tc.intention_summary.as_deref(),
        Some("view the file at src/main.rs")
    );

    // Tool call has result preview (from object with content field)
    assert!(tc.result_content.is_some());
    assert!(tc.result_content.as_ref().unwrap().contains("fn main()"));
}
#[test]
fn handles_polymorphic_result_string() {
    // result can be a plain string (not an object)
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Do something".to_string()),
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
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-1".to_string()),
                tool_name: Some("read_file".to_string()),
                arguments: None,
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-2",
            "2026-03-10T07:14:52.000Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-1".to_string()),
                parent_tool_call_id: None,
                model: None,
                interaction_id: None,
                success: Some(true),
                result: Some(json!("file contents here")),
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "evt-3",
            "2026-03-10T07:14:52.500Z",
            Some("evt-2"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    let tc = &turns[0].tool_calls[0];
    assert_eq!(tc.result_content.as_deref(), Some("file contents here"));
}
