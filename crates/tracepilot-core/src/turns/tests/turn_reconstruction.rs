//! Basic turn reconstruction tests.
//!
//! Tests the core logic for reconstructing conversation turns from flat event streams.
//! Validates the happy path scenarios without edge cases.
//!
//! ## Tests Included
//! - `reconstructs_simple_single_turn`: Single user message → assistant response → turn end
//! - `reconstructs_multiple_turns`: Multiple sequential turns with clean boundaries

use super::*;
use serde_json::json;

#[test]
fn reconstructs_simple_single_turn() {
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
        asst_msg("Hi there!")
            .message_id("msg-1")
            .interaction_id("int-1")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-2")
            .build_event(),
        tool_start("read_file")
            .tool_call_id("tc-1")
            .arguments(json!({ "path": "src/lib.rs" }))
            .mcp_server("filesystem")
            .mcp_tool("read")
            .id("evt-4")
            .timestamp("2026-03-10T07:14:52.100Z")
            .parent("evt-3")
            .build_event(),
        tool_complete("tc-1")
            .model("claude-opus-4.6")
            .interaction_id("int-1")
            .success(true)
            .result(json!("ok"))
            .id("evt-5")
            .timestamp("2026-03-10T07:14:52.500Z")
            .parent("evt-4")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("evt-6")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-2")
            .build_event(),
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
        user_msg("First")
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
        asst_msg("Response one")
            .message_id("msg-1")
            .interaction_id("int-1")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-2")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("evt-4")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-2")
            .build_event(),
        user_msg("Second")
            .interaction_id("int-2")
            .id("evt-5")
            .timestamp("2026-03-10T07:14:54.000Z")
            .build_event(),
        turn_start()
            .turn_id("turn-2")
            .interaction_id("int-2")
            .id("evt-6")
            .timestamp("2026-03-10T07:14:54.100Z")
            .parent("evt-5")
            .build_event(),
        asst_msg("Response two")
            .message_id("msg-2")
            .interaction_id("int-2")
            .id("evt-7")
            .timestamp("2026-03-10T07:14:55.000Z")
            .parent("evt-6")
            .build_event(),
        turn_end()
            .turn_id("turn-2")
            .id("evt-8")
            .timestamp("2026-03-10T07:14:56.000Z")
            .parent("evt-6")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0].turn_index, 0);
    assert_eq!(turns[1].turn_index, 1);
    assert_eq!(turns[0].user_message.as_deref(), Some("First"));
    assert_eq!(turns[1].user_message.as_deref(), Some("Second"));
    assert!(turns.iter().all(|turn| turn.is_complete));
}
