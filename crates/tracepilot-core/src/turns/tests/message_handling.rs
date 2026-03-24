//! Message handling tests.

use super::*;

#[test]
fn collects_multiple_assistant_messages_per_turn() {
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
                content: Some("Part one".to_string()),
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
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-2".to_string()),
                content: Some("Part two".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-4",
            "2026-03-10T07:14:52.500Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "evt-5",
            "2026-03-10T07:14:53.000Z",
            Some("evt-2"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].assistant_messages.len(), 2);
    assert_eq!(
        msg_contents(&turns[0].assistant_messages),
        vec!["Part one", "Part two"]
    );
}
#[test]
fn filters_empty_string_assistant_messages() {
    // In real sessions, assistant.message events before tool-call batches
    // often carry content: "" (empty string, not null). These should be filtered out.
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Fix the bug".to_string()),
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
        // First assistant.message with empty content (tool-call-only response)
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-1".to_string()),
                content: Some("".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: Some(vec![json!({"id": "tc-1", "name": "grep"})]),
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
                tool_name: Some("grep".to_string()),
                arguments: Some(json!({ "pattern": "TODO" })),
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
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
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "evt-5",
            "2026-03-10T07:14:53.000Z",
            Some("evt-4"),
        ),
        // Second assistant.message with empty content (another tool-call batch)
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-2".to_string()),
                content: Some("".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: Some(vec![json!({"id": "tc-2", "name": "view"})]),
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-6",
            "2026-03-10T07:14:53.100Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-2".to_string()),
                tool_name: Some("view".to_string()),
                arguments: Some(json!({ "path": "src/main.rs" })),
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-7",
            "2026-03-10T07:14:53.200Z",
            Some("evt-6"),
        ),
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-2".to_string()),
                parent_tool_call_id: None,
                model: Some("claude-opus-4.6".to_string()),
                interaction_id: Some("int-1".to_string()),
                success: Some(true),
                result: None,
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            "evt-8",
            "2026-03-10T07:14:54.000Z",
            Some("evt-7"),
        ),
        // Final assistant.message with real content
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-3".to_string()),
                content: Some("I fixed the bug by updating the handler.".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: Some(42),
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-9",
            "2026-03-10T07:14:54.100Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "evt-10",
            "2026-03-10T07:14:55.000Z",
            Some("evt-2"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);

    let turn = &turns[0];
    // Should only contain the real message, not the empty strings
    assert_eq!(turn.assistant_messages.len(), 1);
    assert_eq!(
        turn.assistant_messages[0].content,
        "I fixed the bug by updating the handler."
    );
    // Tool calls should still be preserved
    assert_eq!(turn.tool_calls.len(), 2);
}
#[test]
fn filters_whitespace_only_assistant_messages() {
    // Edge case: content is whitespace-only (e.g., "\n", "  ", "\t")
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
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-1".to_string()),
                content: Some("   ".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
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
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-2".to_string()),
                content: Some("\n".to_string()),
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
            "2026-03-10T07:14:52.100Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-3".to_string()),
                content: Some("Real response".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-4",
            "2026-03-10T07:14:52.200Z",
            Some("evt-1"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].assistant_messages.len(), 1);
    assert_eq!(turns[0].assistant_messages[0].content, "Real response");
}
#[test]
fn none_content_still_filtered() {
    // content: null (None) should still be filtered (pre-existing behavior)
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
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-1".to_string()),
                content: None,
                interaction_id: Some("int-1".to_string()),
                tool_requests: Some(vec![json!({"id": "tc-1"})]),
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
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-2".to_string()),
                content: Some("Done!".to_string()),
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
            "2026-03-10T07:14:53.000Z",
            Some("evt-1"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].assistant_messages.len(), 1);
    assert_eq!(turns[0].assistant_messages[0].content, "Done!");
}
#[test]
fn turn_stats_excludes_empty_messages() {
    // Verify that turn_stats reflects the filtered message count
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
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-1".to_string()),
                content: Some("".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: Some(vec![json!({"id": "tc-1"})]),
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
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-2".to_string()),
                content: Some("".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: Some(vec![json!({"id": "tc-2"})]),
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-3",
            "2026-03-10T07:14:53.000Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-3".to_string()),
                content: Some("Final answer".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-4",
            "2026-03-10T07:14:54.000Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "evt-5",
            "2026-03-10T07:14:55.000Z",
            Some("evt-1"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    let stats = turn_stats(&turns);
    // Only 1 real message, not 3
    assert_eq!(stats.total_messages, 1);
}
#[test]
fn collects_reasoning_texts_from_assistant_messages() {
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Explain X".to_string()),
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
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-1".to_string()),
                content: Some("".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: Some(100),
                parent_tool_call_id: None,
                reasoning_text: Some("Let me think about this...".to_string()),
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-2",
            "2026-03-10T07:14:52.000Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-2".to_string()),
                content: Some("Here is the explanation.".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: Some(50),
                parent_tool_call_id: None,
                reasoning_text: Some("Now I should summarize.".to_string()),
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-3",
            "2026-03-10T07:14:53.000Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "evt-4",
            "2026-03-10T07:14:54.000Z",
            Some("evt-1"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    let turn = &turns[0];
    // Both reasoning texts collected
    assert_eq!(turn.reasoning_texts.len(), 2);
    assert_eq!(turn.reasoning_texts[0].content, "Let me think about this...");
    assert_eq!(turn.reasoning_texts[1].content, "Now I should summarize.");
    // Output tokens accumulated
    assert_eq!(turn.output_tokens, Some(150));
    // Only non-empty message kept
    assert_eq!(turn.assistant_messages.len(), 1);
    assert_eq!(turn.assistant_messages[0].content, "Here is the explanation.");
}
#[test]
fn truncates_large_result_content() {
    let long_result = "x".repeat(2000);
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Go".to_string()),
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
                tool_name: Some("view".to_string()),
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
                result: Some(json!(long_result)),
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
    let content = tc.result_content.as_ref().unwrap();
    // Should be truncated to ~1024 bytes + truncation marker
    assert!(
        content.len() < 1100,
        "Content should be truncated, got {} bytes",
        content.len()
    );
    assert!(content.contains("…[truncated]"));
}
#[test]
fn skips_empty_reasoning_text() {
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
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-1".to_string()),
                content: Some("Hi!".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: Some("".to_string()),
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-2",
            "2026-03-10T07:14:52.000Z",
            Some("evt-1"),
        ),
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-2".to_string()),
                content: Some("More info".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: Some("   ".to_string()),
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-3",
            "2026-03-10T07:14:53.000Z",
            Some("evt-1"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    // Empty and whitespace-only reasoning should be skipped
    assert!(turns[0].reasoning_texts.is_empty());
}
#[test]
fn falls_back_to_detailed_content_when_content_empty() {
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Go".to_string()),
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
                tool_name: Some("view".to_string()),
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
                is_user_requested: None,
                result: Some(json!({"content": "", "detailedContent": "1. fn main() {}\n2. }"})),
                error: None,
                tool_telemetry: None,
            }),
            "evt-3",
            "2026-03-10T07:14:52.500Z",
            Some("evt-2"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    let tc = &turns[0].tool_calls[0];
    // Should fall back to detailedContent when content is empty
    assert_eq!(tc.result_content.as_deref(), Some("1. fn main() {}\n2. }"));
}
#[test]
fn attributed_messages_preserve_parent_tool_call_id() {
    // Setup: main agent message + subagent message in same turn
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Do a thing".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: None,
                source: None,
                agent_mode: None,
            }),
            "e1", "2026-01-01T00:00:00Z", None,
        ),
        // Main agent message (no parent)
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: None,
                content: Some("I'll handle this.".to_string()),
                interaction_id: None,
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "e2", "2026-01-01T00:00:01Z", None,
        ),
        // Subagent tool start
        make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-sub-1".to_string()),
                tool_name: Some("task".to_string()),
                arguments: Some(json!({"prompt": "explore"})),
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "e3", "2026-01-01T00:00:02Z", None,
        ),
        // Subagent started
        make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("tc-sub-1".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                agent_description: Some("Explores the codebase".to_string()),
            }),
            "e4", "2026-01-01T00:00:02Z", None,
        ),
        // Subagent's message (has parent_tool_call_id)
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: None,
                content: Some("Found the relevant files.".to_string()),
                interaction_id: None,
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: Some("tc-sub-1".to_string()),
                reasoning_text: Some("Let me search for this...".to_string()),
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "e5", "2026-01-01T00:00:03Z", None,
        ),
        // Subagent completed
        make_event(
            SessionEventType::SubagentCompleted,
            TypedEventData::SubagentCompleted(SubagentCompletedData {
                tool_call_id: Some("tc-sub-1".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
            }),
            "e6", "2026-01-01T00:00:04Z", None,
        ),
        // Main agent final message
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: None,
                content: Some("All done!".to_string()),
                interaction_id: None,
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "e7", "2026-01-01T00:00:05Z", None,
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "e8", "2026-01-01T00:00:06Z", None,
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    let turn = &turns[0];

    // 3 messages total: 2 from main agent, 1 from subagent
    assert_eq!(turn.assistant_messages.len(), 3);

    // First message: main agent (no parent)
    assert_eq!(turn.assistant_messages[0].content, "I'll handle this.");
    assert!(turn.assistant_messages[0].parent_tool_call_id.is_none());
    assert!(turn.assistant_messages[0].agent_display_name.is_none());

    // Second message: subagent
    assert_eq!(turn.assistant_messages[1].content, "Found the relevant files.");
    assert_eq!(
        turn.assistant_messages[1].parent_tool_call_id.as_deref(),
        Some("tc-sub-1")
    );
    assert_eq!(
        turn.assistant_messages[1].agent_display_name.as_deref(),
        Some("Explore Agent")
    );

    // Third message: main agent (no parent)
    assert_eq!(turn.assistant_messages[2].content, "All done!");
    assert!(turn.assistant_messages[2].parent_tool_call_id.is_none());

    // Reasoning: 1 block from subagent
    assert_eq!(turn.reasoning_texts.len(), 1);
    assert_eq!(turn.reasoning_texts[0].content, "Let me search for this...");
    assert_eq!(
        turn.reasoning_texts[0].parent_tool_call_id.as_deref(),
        Some("tc-sub-1")
    );
    assert_eq!(
        turn.reasoning_texts[0].agent_display_name.as_deref(),
        Some("Explore Agent")
    );
}
#[test]
fn messages_without_subagents_have_none_parent() {
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Hello".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: None,
                source: None,
                agent_mode: None,
            }),
            "e1", "2026-01-01T00:00:00Z", None,
        ),
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: None,
                content: Some("World".to_string()),
                interaction_id: None,
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: Some("thinking...".to_string()),
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "e2", "2026-01-01T00:00:01Z", None,
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData { turn_id: None }),
            "e3", "2026-01-01T00:00:02Z", None,
        ),
    ];

    let turns = reconstruct_turns(&events);
    let turn = &turns[0];

    assert_eq!(turn.assistant_messages.len(), 1);
    assert!(turn.assistant_messages[0].parent_tool_call_id.is_none());
    assert!(turn.assistant_messages[0].agent_display_name.is_none());

    assert_eq!(turn.reasoning_texts.len(), 1);
    assert!(turn.reasoning_texts[0].parent_tool_call_id.is_none());
    assert!(turn.reasoning_texts[0].agent_display_name.is_none());
}

// =========================================================================
// Subagent completion detection — regression tests for the ordering bug
// where ToolExecComplete arriving after SubagentCompleted would reverse
// the completion state (is_complete = !is_subagent → false).
// =========================================================================
#[test]
fn assistant_reasoning_appends_to_turn() {
    let events = vec![
        make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Think about this".to_string()),
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
            SessionEventType::AssistantReasoning,
            TypedEventData::AssistantReasoning(AssistantReasoningData {
                reasoning_id: Some("reason-1".to_string()),
                content: Some("Let me think step by step...".to_string()),
            }),
            "evt-3",
            "2026-03-10T07:14:51.200Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::AssistantReasoning,
            TypedEventData::AssistantReasoning(AssistantReasoningData {
                reasoning_id: Some("reason-2".to_string()),
                content: Some("The answer is 42".to_string()),
            }),
            "evt-4",
            "2026-03-10T07:14:51.300Z",
            Some("evt-2"),
        ),
        // Empty reasoning should be skipped
        make_event(
            SessionEventType::AssistantReasoning,
            TypedEventData::AssistantReasoning(AssistantReasoningData {
                reasoning_id: Some("reason-3".to_string()),
                content: Some("   ".to_string()),
            }),
            "evt-5",
            "2026-03-10T07:14:51.400Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-1".to_string()),
                content: Some("The answer is 42.".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            "evt-6",
            "2026-03-10T07:14:52.000Z",
            Some("evt-2"),
        ),
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            "evt-7",
            "2026-03-10T07:14:53.000Z",
            Some("evt-2"),
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    let turn = &turns[0];

    // Two non-empty reasoning blocks should be collected
    assert_eq!(turn.reasoning_texts.len(), 2);
    assert_eq!(turn.reasoning_texts[0].content, "Let me think step by step...");
    assert_eq!(turn.reasoning_texts[1].content, "The answer is 42");

    // AssistantReasoning has no parent_tool_call_id
    assert!(turn.reasoning_texts[0].parent_tool_call_id.is_none());

    // The assistant message should still be there
    assert_eq!(msg_contents(&turn.assistant_messages), vec!["The answer is 42."]);
}
#[test]
fn assistant_reasoning_without_prior_turn_creates_turn() {
    // Reasoning event arrives before any UserMessage — should auto-create a turn
    let events = vec![
        make_event(
            SessionEventType::AssistantReasoning,
            TypedEventData::AssistantReasoning(AssistantReasoningData {
                reasoning_id: Some("reason-1".to_string()),
                content: Some("Thinking...".to_string()),
            }),
            "evt-1",
            "2026-03-10T07:14:51.000Z",
            None,
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].reasoning_texts.len(), 1);
    assert_eq!(turns[0].reasoning_texts[0].content, "Thinking...");
}

// ── Session event embedding tests ─────────────────────────────────

/// Helper: wrap a full turn around session events for testing.
fn make_turn_events(
    session_events: Vec<TypedEvent>,
) -> Vec<TypedEvent> {
    let mut events = vec![make_event(
        SessionEventType::UserMessage,
        TypedEventData::UserMessage(UserMessageData {
            content: Some("Hello".to_string()),
            transformed_content: None,
            interaction_id: Some("int-1".to_string()),
            attachments: None,
            source: None,
            agent_mode: None,
        }),
        "evt-user",
        "2026-03-10T07:00:00.000Z",
        None,
    )];
    events.extend(session_events);
    events.push(make_event(
        SessionEventType::AssistantTurnEnd,
        TypedEventData::TurnEnd(TurnEndData { turn_id: None }),
        "evt-end",
        "2026-03-10T07:01:00.000Z",
        None,
    ));
    events
}
#[test]
fn truncation_summary_messages_only() {
    let events = make_turn_events(vec![make_event(
        SessionEventType::SessionTruncation,
        TypedEventData::SessionTruncation(SessionTruncationData {
            token_limit: None,
            pre_truncation_tokens_in_messages: None,
            pre_truncation_messages_length: None,
            post_truncation_tokens_in_messages: None,
            post_truncation_messages_length: None,
            tokens_removed_during_truncation: None,
            messages_removed_during_truncation: Some(25),
            performed_by: None,
        }),
        "evt-trunc",
        "2026-03-10T07:00:30.000Z",
        None,
    )]);

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].session_events[0].summary, "Truncated 25 messages");
}
