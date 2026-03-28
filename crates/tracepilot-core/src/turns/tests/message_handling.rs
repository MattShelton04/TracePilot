//! Message handling tests.

use super::*;

#[test]
fn collects_multiple_assistant_messages_per_turn() {
    let events = vec![
        user_msg("Hello")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:51.100Z")
            .parent("evt-1")
            .build_event(),
        asst_msg("Part one")
            .message_id("msg-1")
            .interaction_id("int-1")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-2")
            .build_event(),
        asst_msg("Part two")
            .message_id("msg-2")
            .interaction_id("int-1")
            .id("evt-4")
            .timestamp("2026-03-10T07:14:52.500Z")
            .parent("evt-2")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("evt-5")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-2")
            .build_event(),
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
        user_msg("Fix the bug")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:51.100Z")
            .parent("evt-1")
            .build_event(),
        // First assistant.message with empty content (tool-call-only response)
        asst_msg("")
            .message_id("msg-1")
            .interaction_id("int-1")
            .tool_requests(vec![json!({"id": "tc-1", "name": "grep"})])
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-2")
            .build_event(),
        tool_start("grep")
            .tool_call_id("tc-1")
            .arguments(json!({ "pattern": "TODO" }))
            .id("evt-4")
            .timestamp("2026-03-10T07:14:52.100Z")
            .parent("evt-3")
            .build_event(),
        tool_complete("tc-1")
            .model("claude-opus-4.6")
            .interaction_id("int-1")
            .success(true)
            .id("evt-5")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-4")
            .build_event(),
        // Second assistant.message with empty content (another tool-call batch)
        asst_msg("")
            .message_id("msg-2")
            .interaction_id("int-1")
            .tool_requests(vec![json!({"id": "tc-2", "name": "view"})])
            .id("evt-6")
            .timestamp("2026-03-10T07:14:53.100Z")
            .parent("evt-2")
            .build_event(),
        tool_start("view")
            .tool_call_id("tc-2")
            .arguments(json!({ "path": "src/main.rs" }))
            .id("evt-7")
            .timestamp("2026-03-10T07:14:53.200Z")
            .parent("evt-6")
            .build_event(),
        tool_complete("tc-2")
            .model("claude-opus-4.6")
            .interaction_id("int-1")
            .success(true)
            .id("evt-8")
            .timestamp("2026-03-10T07:14:54.000Z")
            .parent("evt-7")
            .build_event(),
        // Final assistant.message with real content
        asst_msg("I fixed the bug by updating the handler.")
            .message_id("msg-3")
            .interaction_id("int-1")
            .output_tokens(42)
            .id("evt-9")
            .timestamp("2026-03-10T07:14:54.100Z")
            .parent("evt-2")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("evt-10")
            .timestamp("2026-03-10T07:14:55.000Z")
            .parent("evt-2")
            .build_event(),
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
        user_msg("Hello")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        asst_msg("   ")
            .message_id("msg-1")
            .interaction_id("int-1")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        asst_msg("\n")
            .message_id("msg-2")
            .interaction_id("int-1")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.100Z")
            .parent("evt-1")
            .build_event(),
        asst_msg("Real response")
            .message_id("msg-3")
            .interaction_id("int-1")
            .id("evt-4")
            .timestamp("2026-03-10T07:14:52.200Z")
            .parent("evt-1")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].assistant_messages.len(), 1);
    assert_eq!(turns[0].assistant_messages[0].content, "Real response");
}
#[test]
fn none_content_still_filtered() {
    // content: null (None) should still be filtered (pre-existing behavior)
    let events = vec![
        user_msg("Hello")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        asst_msg_empty()
            .message_id("msg-1")
            .interaction_id("int-1")
            .tool_requests(vec![json!({"id": "tc-1"})])
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        asst_msg("Done!")
            .message_id("msg-2")
            .interaction_id("int-1")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-1")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].assistant_messages.len(), 1);
    assert_eq!(turns[0].assistant_messages[0].content, "Done!");
}
#[test]
fn turn_stats_excludes_empty_messages() {
    // Verify that turn_stats reflects the filtered message count
    let events = vec![
        user_msg("Hello")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        asst_msg("")
            .message_id("msg-1")
            .interaction_id("int-1")
            .tool_requests(vec![json!({"id": "tc-1"})])
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        asst_msg("")
            .message_id("msg-2")
            .interaction_id("int-1")
            .tool_requests(vec![json!({"id": "tc-2"})])
            .id("evt-3")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-1")
            .build_event(),
        asst_msg("Final answer")
            .message_id("msg-3")
            .interaction_id("int-1")
            .id("evt-4")
            .timestamp("2026-03-10T07:14:54.000Z")
            .parent("evt-1")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("evt-5")
            .timestamp("2026-03-10T07:14:55.000Z")
            .parent("evt-1")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    let stats = turn_stats(&turns);
    // Only 1 real message, not 3
    assert_eq!(stats.total_messages, 1);
}
#[test]
fn collects_reasoning_texts_from_assistant_messages() {
    let events = vec![
        user_msg("Explain X")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        asst_msg("")
            .message_id("msg-1")
            .interaction_id("int-1")
            .output_tokens(100)
            .reasoning_text("Let me think about this...")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        asst_msg("Here is the explanation.")
            .message_id("msg-2")
            .interaction_id("int-1")
            .output_tokens(50)
            .reasoning_text("Now I should summarize.")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-1")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("evt-4")
            .timestamp("2026-03-10T07:14:54.000Z")
            .parent("evt-1")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    let turn = &turns[0];
    // Both reasoning texts collected
    assert_eq!(turn.reasoning_texts.len(), 2);
    assert_eq!(
        turn.reasoning_texts[0].content,
        "Let me think about this..."
    );
    assert_eq!(turn.reasoning_texts[1].content, "Now I should summarize.");
    // Output tokens accumulated
    assert_eq!(turn.output_tokens, Some(150));
    // Only non-empty message kept
    assert_eq!(turn.assistant_messages.len(), 1);
    assert_eq!(
        turn.assistant_messages[0].content,
        "Here is the explanation."
    );
}
#[test]
fn truncates_large_result_content() {
    let long_result = "x".repeat(2000);
    let events = vec![
        user_msg("Go")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        tool_start("view")
            .tool_call_id("tc-1")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        tool_complete("tc-1")
            .success(true)
            .result(json!(long_result))
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.500Z")
            .parent("evt-2")
            .build_event(),
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
        user_msg("Hello")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        asst_msg("Hi!")
            .message_id("msg-1")
            .interaction_id("int-1")
            .reasoning_text("")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        asst_msg("More info")
            .message_id("msg-2")
            .interaction_id("int-1")
            .reasoning_text("   ")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-1")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    // Empty and whitespace-only reasoning should be skipped
    assert!(turns[0].reasoning_texts.is_empty());
}
#[test]
fn falls_back_to_detailed_content_when_content_empty() {
    let events = vec![
        user_msg("Go")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        tool_start("view")
            .tool_call_id("tc-1")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        tool_complete("tc-1")
            .success(true)
            .result(json!({"content": "", "detailedContent": "1. fn main() {}\n2. }"}))
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.500Z")
            .parent("evt-2")
            .build_event(),
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
        user_msg("Do a thing")
            .id("e1")
            .timestamp("2026-01-01T00:00:00Z")
            .build_event(),
        // Main agent message (no parent)
        asst_msg("I'll handle this.")
            .id("e2")
            .timestamp("2026-01-01T00:00:01Z")
            .build_event(),
        // Subagent tool start
        tool_start("task")
            .tool_call_id("tc-sub-1")
            .arguments(json!({"prompt": "explore"}))
            .id("e3")
            .timestamp("2026-01-01T00:00:02Z")
            .build_event(),
        // Subagent started
        subagent_start("explore")
            .tool_call_id("tc-sub-1")
            .agent_display_name("Explore Agent")
            .agent_description("Explores the codebase")
            .id("e4")
            .timestamp("2026-01-01T00:00:02Z")
            .build_event(),
        // Subagent's message (has parent_tool_call_id)
        asst_msg("Found the relevant files.")
            .parent_tool_call_id("tc-sub-1")
            .reasoning_text("Let me search for this...")
            .id("e5")
            .timestamp("2026-01-01T00:00:03Z")
            .build_event(),
        // Subagent completed
        subagent_complete("explore")
            .tool_call_id("tc-sub-1")
            .agent_display_name("Explore Agent")
            .id("e6")
            .timestamp("2026-01-01T00:00:04Z")
            .build_event(),
        // Main agent final message
        asst_msg("All done!")
            .id("e7")
            .timestamp("2026-01-01T00:00:05Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("e8")
            .timestamp("2026-01-01T00:00:06Z")
            .build_event(),
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
    assert_eq!(
        turn.assistant_messages[1].content,
        "Found the relevant files."
    );
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
        user_msg("Hello")
            .id("e1")
            .timestamp("2026-01-01T00:00:00Z")
            .build_event(),
        asst_msg("World")
            .reasoning_text("thinking...")
            .id("e2")
            .timestamp("2026-01-01T00:00:01Z")
            .build_event(),
        turn_end()
            .id("e3")
            .timestamp("2026-01-01T00:00:02Z")
            .build_event(),
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
        user_msg("Think about this")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:51.100Z")
            .parent("evt-1")
            .build_event(),
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
        asst_msg("The answer is 42.")
            .message_id("msg-1")
            .interaction_id("int-1")
            .id("evt-6")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-2")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("evt-7")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-2")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    let turn = &turns[0];

    // Two non-empty reasoning blocks should be collected
    assert_eq!(turn.reasoning_texts.len(), 2);
    assert_eq!(
        turn.reasoning_texts[0].content,
        "Let me think step by step..."
    );
    assert_eq!(turn.reasoning_texts[1].content, "The answer is 42");

    // AssistantReasoning has no parent_tool_call_id
    assert!(turn.reasoning_texts[0].parent_tool_call_id.is_none());

    // The assistant message should still be there
    assert_eq!(
        msg_contents(&turn.assistant_messages),
        vec!["The answer is 42."]
    );
}
#[test]
fn assistant_reasoning_without_prior_turn_creates_turn() {
    // Reasoning event arrives before any UserMessage — should auto-create a turn
    let events = vec![make_event(
        SessionEventType::AssistantReasoning,
        TypedEventData::AssistantReasoning(AssistantReasoningData {
            reasoning_id: Some("reason-1".to_string()),
            content: Some("Thinking...".to_string()),
        }),
        "evt-1",
        "2026-03-10T07:14:51.000Z",
        None,
    )];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].reasoning_texts.len(), 1);
    assert_eq!(turns[0].reasoning_texts[0].content, "Thinking...");
}
