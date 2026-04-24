//! Cross-module tests for search content extraction.
//!
//! These tests validate turn numbering, session error assignment, and
//! cross-module behavior of `extract_search_content`.

use super::SearchContentRow;
use super::content_extraction::extract_search_content;
use tracepilot_core::ids::SessionId;
use tracepilot_core::utils::truncate_utf8;

fn sid() -> SessionId {
    SessionId::from_validated("s1")
}

// ── truncate_utf8 tests ─────────────────────────────────────

#[test]
fn test_truncate_utf8_short() {
    assert_eq!(truncate_utf8("hello", 10), "hello");
}

#[test]
fn test_truncate_utf8_exact() {
    assert_eq!(truncate_utf8("hello", 5), "hello");
}

#[test]
fn test_truncate_utf8_cuts() {
    assert_eq!(truncate_utf8("hello world", 5), "hello");
}

#[test]
fn test_truncate_utf8_unicode() {
    // Multi-byte chars should not be split mid-character
    let text = "héllo wörld";
    let result = truncate_utf8(text, 6);
    assert!(result.len() <= 6);
    assert!(result.is_char_boundary(result.len()));
}

// ── Turn numbering tests ────────────────────────────────────
// These verify that extract_search_content assigns turn_number values
// matching the ConversationTurn.turn_index from reconstruct_turns.

use tracepilot_core::models::event_types::{
    AbortData, AssistantMessageData, AssistantReasoningData, SessionErrorData, SessionEventType,
    ToolExecCompleteData, ToolExecStartData, TurnEndData, TurnStartData, UserMessageData,
};
use tracepilot_core::parsing::events::{RawEvent, TypedEvent, TypedEventData};

/// Helper: build a TypedEvent from its components.
fn evt(event_type: SessionEventType, typed_data: TypedEventData) -> TypedEvent {
    TypedEvent {
        raw: RawEvent {
            event_type: String::new(),
            data: serde_json::Value::Null,
            id: None,
            timestamp: None,
            parent_id: None,
        },
        event_type,
        typed_data,
    }
}

fn user_message(content: &str) -> TypedEvent {
    evt(
        SessionEventType::UserMessage,
        TypedEventData::UserMessage(UserMessageData {
            content: Some(content.to_string()),
            transformed_content: None,
            attachments: None,
            interaction_id: None,
            source: None,
            agent_mode: None,
        }),
    )
}

fn assistant_turn_start() -> TypedEvent {
    evt(
        SessionEventType::AssistantTurnStart,
        TypedEventData::TurnStart(TurnStartData {
            turn_id: None,
            interaction_id: None,
        }),
    )
}

fn assistant_turn_end() -> TypedEvent {
    evt(
        SessionEventType::AssistantTurnEnd,
        TypedEventData::TurnEnd(TurnEndData { turn_id: None }),
    )
}

fn assistant_message(content: &str) -> TypedEvent {
    evt(
        SessionEventType::AssistantMessage,
        TypedEventData::AssistantMessage(AssistantMessageData {
            message_id: None,
            content: Some(content.to_string()),
            interaction_id: None,
            tool_requests: None,
            output_tokens: None,
            parent_tool_call_id: None,
            reasoning_text: None,
            reasoning_opaque: None,
            encrypted_content: None,
            phase: None,
            request_id: None,
        }),
    )
}

fn tool_exec_start(name: &str, call_id: &str) -> TypedEvent {
    evt(
        SessionEventType::ToolExecutionStart,
        TypedEventData::ToolExecutionStart(ToolExecStartData {
            tool_name: Some(name.to_string()),
            tool_call_id: Some(call_id.to_string()),
            arguments: Some(serde_json::json!({"path": "test.rs"})),
            parent_tool_call_id: None,
            mcp_server_name: None,
            mcp_tool_name: None,
        }),
    )
}

fn reasoning(content: &str) -> TypedEvent {
    evt(
        SessionEventType::AssistantReasoning,
        TypedEventData::AssistantReasoning(AssistantReasoningData {
            reasoning_id: None,
            content: Some(content.to_string()),
        }),
    )
}

fn abort() -> TypedEvent {
    evt(
        SessionEventType::Abort,
        TypedEventData::Abort(AbortData { reason: None }),
    )
}

fn tool_exec_complete(call_id: &str, result_text: &str) -> TypedEvent {
    evt(
        SessionEventType::ToolExecutionComplete,
        TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
            tool_call_id: Some(call_id.to_string()),
            parent_tool_call_id: None,
            model: None,
            interaction_id: None,
            success: Some(true),
            result: Some(serde_json::json!(result_text)),
            error: None,
            tool_telemetry: None,
            is_user_requested: None,
        }),
    )
}

fn session_error(msg: &str) -> TypedEvent {
    evt(
        SessionEventType::SessionError,
        TypedEventData::SessionError(SessionErrorData {
            error_type: Some("TestError".to_string()),
            message: Some(msg.to_string()),
            stack: None,
            status_code: None,
            provider_call_id: None,
            url: None,
        }),
    )
}

/// Collect (turn_number, content_type) pairs from extracted rows.
fn turn_map(rows: &[SearchContentRow]) -> Vec<(Option<i64>, &str)> {
    rows.iter()
        .map(|r| (r.turn_number, r.content_type))
        .collect()
}

#[test]
fn turn_numbers_single_user_message_turn() {
    // UserMessage → TurnStart → AssistantMsg → TurnEnd = 1 turn (turn 0)
    let events = vec![
        user_message("Hello"),
        assistant_turn_start(),
        assistant_message("Hi there!"),
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    assert!(!rows.is_empty());
    for row in &rows {
        assert_eq!(
            row.turn_number,
            Some(0),
            "all rows in single turn should be turn 0"
        );
    }
}

#[test]
fn turn_numbers_multiple_assistant_cycles() {
    // UserMessage → TurnStart → AssistantMsg → ToolExec → TurnEnd
    //             → TurnStart → AssistantMsg → TurnEnd
    // = 3 turns: turn 0 (user+first cycle), turn 1 (second cycle), turn 2 (third cycle won't exist here)
    // Actually: turn 0 starts at UserMessage, TurnEnd closes it,
    // next TurnStart opens turn 1.
    let events = vec![
        user_message("Do a task"),                 // turn 0 opens
        assistant_turn_start(),                    // noop (turn 0 already open)
        assistant_message("Let me look..."),       // turn 0
        tool_exec_start("view", "tc-1"),           // turn 0
        assistant_turn_end(),                      // turn 0 closes
        assistant_turn_start(),                    // turn 1 opens (ensure_turn)
        assistant_message("Found it, editing..."), // turn 1
        tool_exec_start("edit", "tc-2"),           // turn 1
        assistant_turn_end(),                      // turn 1 closes
        assistant_turn_start(),                    // turn 2 opens
        assistant_message("All done!"),            // turn 2
        assistant_turn_end(),                      // turn 2 closes
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    // First cycle: user_message + assistant_message + tool_call = turn 0
    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "assistant_message"));
    assert_eq!(map[2], (Some(0), "tool_call"));

    // Second cycle: assistant_message + tool_call = turn 1
    assert_eq!(map[3], (Some(1), "assistant_message"));
    assert_eq!(map[4], (Some(1), "tool_call"));

    // Third cycle: assistant_message = turn 2
    assert_eq!(map[5], (Some(2), "assistant_message"));
}

#[test]
fn turn_numbers_synthetic_turn_before_user_message() {
    // TurnStart before any UserMessage creates turn 0 (synthetic),
    // then UserMessage opens turn 1.
    let events = vec![
        assistant_turn_start(),           // turn 0 (synthetic)
        assistant_message("Resuming..."), // turn 0
        assistant_turn_end(),             // turn 0 closes
        user_message("Now do this"),      // turn 1 opens
        assistant_turn_start(),           // noop
        assistant_message("OK!"),         // turn 1
        assistant_turn_end(),             // turn 1 closes
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "assistant_message")); // synthetic turn 0
    assert_eq!(map[1], (Some(1), "user_message")); // user turn 1
    assert_eq!(map[2], (Some(1), "assistant_message")); // same turn 1
}

#[test]
fn turn_numbers_abort_closes_turn() {
    // Abort should close the current turn, next events open a new one.
    let events = vec![
        user_message("Start"),           // turn 0
        assistant_turn_start(),          // noop
        assistant_message("Working..."), // turn 0
        abort(),                         // closes turn 0
        assistant_turn_start(),          // turn 1 opens
        assistant_message("Recovered"),  // turn 1
        assistant_turn_end(),            // turn 1 closes
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "assistant_message")); // before abort
    assert_eq!(map[2], (Some(1), "assistant_message")); // after abort, new turn
}

#[test]
fn turn_numbers_user_message_after_turn_end() {
    // TurnEnd → UserMessage: user message opens a new turn
    let events = vec![
        user_message("First"), // turn 0
        assistant_turn_start(),
        assistant_message("Response 1"), // turn 0
        assistant_turn_end(),            // closes turn 0
        user_message("Second"),          // turn 1
        assistant_turn_start(),
        assistant_message("Response 2"), // turn 1
        assistant_turn_end(),            // closes turn 1
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "assistant_message"));
    assert_eq!(map[2], (Some(1), "user_message"));
    assert_eq!(map[3], (Some(1), "assistant_message"));
}

#[test]
fn turn_numbers_many_cycles_produces_high_turn_numbers() {
    // Simulate a session with 1 user message but many assistant cycles.
    // This is the core scenario the fix addresses.
    let mut events = vec![user_message("Do a complex task")];
    let num_cycles = 50;
    for i in 0..num_cycles {
        events.push(assistant_turn_start());
        events.push(assistant_message(&format!("Cycle {i}")));
        events.push(tool_exec_start("view", &format!("tc-{i}")));
        events.push(assistant_turn_end());
    }

    let rows = extract_search_content(&sid(), &events);

    // User message is turn 0
    assert_eq!(rows[0].turn_number, Some(0));
    assert_eq!(rows[0].content_type, "user_message");

    // First cycle's assistant_message + tool_call = turn 0 (same as user msg)
    assert_eq!(rows[1].turn_number, Some(0));
    assert_eq!(rows[2].turn_number, Some(0));

    // Second cycle = turn 1
    assert_eq!(rows[3].turn_number, Some(1));
    assert_eq!(rows[4].turn_number, Some(1));

    // Last cycle = turn 49
    let last_idx = rows.len() - 1;
    assert_eq!(rows[last_idx].turn_number, Some(49));

    // Verify we have high turn numbers (the whole point of the fix)
    let max_turn = rows.iter().filter_map(|r| r.turn_number).max().unwrap();
    assert_eq!(
        max_turn, 49,
        "50 cycles should produce turn numbers up to 49"
    );
}

#[test]
fn turn_numbers_reasoning_opens_turn() {
    // Reasoning event should also open a turn if none is open.
    let events = vec![
        user_message("Think about this"),
        assistant_turn_start(),
        reasoning("Let me consider..."),
        assistant_message("Here's my analysis"),
        assistant_turn_end(),
        reasoning("More thinking after turn end"), // opens turn 1
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "reasoning"));
    assert_eq!(map[2], (Some(0), "assistant_message"));
    assert_eq!(map[3], (Some(1), "reasoning")); // new turn after TurnEnd
}

#[test]
fn turn_numbers_match_reconstructor() {
    // Cross-validate: extract_search_content turn_number should match
    // reconstruct_turns turn_index for the same event sequence.
    use tracepilot_core::turns::reconstruct_turns;

    let events = vec![
        user_message("First"),
        assistant_turn_start(),
        assistant_message("Response 1"),
        tool_exec_start("view", "tc-1"),
        assistant_turn_end(),
        assistant_turn_start(),
        assistant_message("Follow-up 1"),
        assistant_turn_end(),
        user_message("Second"),
        assistant_turn_start(),
        assistant_message("Response 2"),
        assistant_turn_end(),
    ];

    let turns = reconstruct_turns(&events);
    let rows = extract_search_content(&sid(), &events);

    // The reconstructor should produce 3 turns: [0, 1, 2]
    assert_eq!(turns.len(), 3);
    assert_eq!(turns[0].turn_index, 0);
    assert_eq!(turns[1].turn_index, 1);
    assert_eq!(turns[2].turn_index, 2);

    // FTS rows should have matching turn numbers
    // Turn 0: user_message + assistant_message + tool_call
    assert_eq!(rows[0].turn_number, Some(0)); // user_message "First"
    assert_eq!(rows[1].turn_number, Some(0)); // assistant_message "Response 1"
    assert_eq!(rows[2].turn_number, Some(0)); // tool_call "view"

    // Turn 1: assistant_message (after TurnEnd→TurnStart)
    assert_eq!(rows[3].turn_number, Some(1)); // assistant_message "Follow-up 1"

    // Turn 2: user_message + assistant_message
    assert_eq!(rows[4].turn_number, Some(2)); // user_message "Second"
    assert_eq!(rows[5].turn_number, Some(2)); // assistant_message "Response 2"
}

#[test]
fn turn_numbers_consecutive_user_messages() {
    // Two user messages in a row: each opens a new turn.
    let events = vec![
        user_message("First"),
        user_message("Second"),
        assistant_turn_start(),
        assistant_message("Response"),
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(1), "user_message"));
    assert_eq!(map[2], (Some(1), "assistant_message"));
}

#[test]
fn turn_numbers_tool_complete_uses_start_turn() {
    // ToolExecutionComplete should use the turn from its matching
    // ToolExecutionStart, not the ambient current_turn.
    let events = vec![
        user_message("Do it"),                       // turn 0
        assistant_turn_start(),                      // noop
        tool_exec_start("view", "tc-1"),             // turn 0
        assistant_turn_end(),                        // closes turn 0
        assistant_turn_start(),                      // turn 1 opens
        tool_exec_complete("tc-1", "file contents"), // should be turn 0
        assistant_message("Done"),                   // turn 1
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "tool_call"));
    // tool_result for tc-1 should be turn 0 (where the start was)
    assert_eq!(map[2], (Some(0), "tool_result"));
    assert_eq!(map[3], (Some(1), "assistant_message"));
}

#[test]
fn session_error_between_turns_assigned_to_next_turn() {
    // Session errors between turns should be buffered and assigned to
    // the next turn that opens (mirroring reconstructor's pending_session_events).
    let events = vec![
        user_message("Start"), // turn 0
        assistant_turn_start(),
        assistant_message("Working..."),  // turn 0
        assistant_turn_end(),             // closes turn 0
        session_error("rate limit hit"),  // between turns → pending
        assistant_turn_start(),           // turn 1 opens → flush pending
        assistant_message("Retrying..."), // turn 1
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "assistant_message"));
    // The session error between turns should be flushed to turn 1
    assert_eq!(map[2], (Some(1), "error"));
    assert_eq!(map[3], (Some(1), "assistant_message"));
}

#[test]
fn session_error_within_turn_assigned_to_current_turn() {
    // Session errors within an active turn should use that turn.
    let events = vec![
        user_message("Start"),
        assistant_turn_start(),
        session_error("transient error"), // within turn 0
        assistant_message("Continuing..."),
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    assert_eq!(map[0], (Some(0), "user_message"));
    assert_eq!(map[1], (Some(0), "error"));
    assert_eq!(map[2], (Some(0), "assistant_message"));
}

#[test]
fn session_error_before_any_turn_gets_none() {
    // Session errors before any turn has opened should have turn_number: None
    // until a turn opens.
    let events = vec![
        session_error("early error"), // no turn yet → pending
        user_message("Start"),        // turn 0 → flushes pending
        assistant_turn_start(),
        assistant_message("OK"),
        assistant_turn_end(),
    ];
    let rows = extract_search_content(&sid(), &events);
    let map = turn_map(&rows);

    // The early error should be flushed to turn 0 (when user message opens it)
    assert_eq!(map[0], (Some(0), "error"));
    assert_eq!(map[1], (Some(0), "user_message"));
    assert_eq!(map[2], (Some(0), "assistant_message"));
}

#[test]
fn trailing_session_error_after_last_turn_gets_none() {
    // Session errors after the last turn has closed, with no more turns,
    // should get turn_number: None.
    let events = vec![
        user_message("Start"),
        assistant_turn_start(),
        assistant_message("Done"),
        assistant_turn_end(),
        session_error("final error"), // after last turn, no more turns
    ];
    let rows = extract_search_content(&sid(), &events);

    // user_message + assistant_message = turn 0
    assert_eq!(rows[0].turn_number, Some(0));
    assert_eq!(rows[1].turn_number, Some(0));
    // trailing error has no turn to attach to
    assert_eq!(rows[2].turn_number, None);
    assert_eq!(rows[2].content_type, "error");
}
