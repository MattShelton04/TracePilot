//! Turn lifecycle behaviors that share session-event reconstruction paths.

use super::super::*;

#[test]
fn marks_incomplete_session_without_turn_end() {
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
        asst_msg("Partial")
            .message_id("msg-1")
            .interaction_id("int-1")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-2")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert!(!turns[0].is_complete);
    assert!(turns[0].end_timestamp.is_none());
}
#[test]
fn realistic_agentic_session_with_many_tool_rounds() {
    // Simulates a realistic agentic session: user asks a question, assistant
    // makes 5 rounds of tool calls (each preceded by an empty-content
    // assistant.message), then gives a final response.
    let mut events = vec![
        user_msg("Refactor the auth module")
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
    ];

    let tool_names = ["grep", "view", "edit", "view", "powershell"];
    let mut evt_counter = 3;
    let base_ts = 52; // seconds offset

    for (round, tool_name) in tool_names.iter().enumerate() {
        // Empty assistant.message before each tool batch
        events.push(
            asst_msg_empty()
                .message_id(format!("msg-{round}"))
                .content("")
                .interaction_id("int-1")
                .tool_requests(vec![
                    json!({"id": format!("tc-{round}"), "name": tool_name}),
                ])
                .id(format!("evt-{evt_counter}"))
                .timestamp(format!("2026-03-10T07:14:{}.000Z", base_ts + round * 2))
                .parent("evt-2")
                .build_event(),
        );
        evt_counter += 1;

        events.push(
            tool_start(*tool_name)
                .tool_call_id(format!("tc-{round}"))
                .arguments(json!({"arg": "value"}))
                .id(format!("evt-{evt_counter}"))
                .timestamp(format!("2026-03-10T07:14:{}.100Z", base_ts + round * 2))
                .parent(format!("evt-{}", evt_counter - 1))
                .build_event(),
        );
        evt_counter += 1;

        events.push(
            tool_complete(format!("tc-{round}"))
                .model("claude-opus-4.6")
                .interaction_id("int-1")
                .success(true)
                .id(format!("evt-{evt_counter}"))
                .timestamp(format!("2026-03-10T07:14:{}.900Z", base_ts + round * 2))
                .parent(format!("evt-{}", evt_counter - 1))
                .build_event(),
        );
        evt_counter += 1;
    }

    // Final assistant.message with real content
    events.push(
        asst_msg("I've refactored the auth module. Here's a summary of changes.")
            .message_id("msg-final")
            .interaction_id("int-1")
            .output_tokens(150)
            .id(format!("evt-{evt_counter}"))
            .timestamp("2026-03-10T07:15:02.000Z")
            .parent("evt-2")
            .build_event(),
    );
    evt_counter += 1;

    events.push(
        turn_end()
            .turn_id("turn-1")
            .id(format!("evt-{evt_counter}"))
            .timestamp("2026-03-10T07:15:03.000Z")
            .parent("evt-2")
            .build_event(),
    );

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);

    let turn = &turns[0];
    // Only the final real message should survive, not the 5 empty ones
    assert_eq!(
        turn.assistant_messages.len(),
        1,
        "Expected 1 message but got {}: {:?}",
        turn.assistant_messages.len(),
        turn.assistant_messages
    );
    assert_eq!(
        turn.assistant_messages[0].content,
        "I've refactored the auth module. Here's a summary of changes."
    );
    // All 5 tool calls should be preserved
    assert_eq!(turn.tool_calls.len(), 5);
    assert!(turn.is_complete);
}
#[test]
fn computes_turn_stats() {
    let events = vec![
        user_msg("First")
            .interaction_id("int-1")
            .id("evt-1")
            .timestamp("2026-03-10T07:14:51.000Z")
            .build_event(),
        asst_msg("One")
            .message_id("msg-1")
            .interaction_id("int-1")
            .id("evt-2")
            .timestamp("2026-03-10T07:14:52.000Z")
            .parent("evt-1")
            .build_event(),
        tool_start("read_file")
            .tool_call_id("tc-1")
            .id("evt-3")
            .timestamp("2026-03-10T07:14:52.100Z")
            .parent("evt-2")
            .build_event(),
        tool_complete("tc-1")
            .model("claude-sonnet-4.5")
            .interaction_id("int-1")
            .success(true)
            .id("evt-4")
            .timestamp("2026-03-10T07:14:52.400Z")
            .parent("evt-3")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("evt-5")
            .timestamp("2026-03-10T07:14:53.000Z")
            .parent("evt-1")
            .build_event(),
        user_msg("Second")
            .interaction_id("int-2")
            .id("evt-6")
            .timestamp("2026-03-10T07:14:54.000Z")
            .build_event(),
        asst_msg("Two")
            .message_id("msg-2")
            .interaction_id("int-2")
            .id("evt-7")
            .timestamp("2026-03-10T07:14:55.000Z")
            .parent("evt-6")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    let stats = turn_stats(&turns);

    assert_eq!(stats.total_turns, 2);
    assert_eq!(stats.complete_turns, 1);
    assert_eq!(stats.incomplete_turns, 1);
    assert_eq!(stats.total_tool_calls, 1);
    assert_eq!(stats.total_messages, 2);
    assert_eq!(stats.models_used.len(), 1);
    assert!(stats.models_used.contains(&"claude-sonnet-4.5".to_string()));
}
#[test]
fn abort_event_finalizes_current_turn() {
    let events = vec![
        user_msg("Do something")
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
        make_event(
            SessionEventType::Abort,
            TypedEventData::Abort(AbortData {
                reason: Some("User cancelled".to_string()),
            }),
            "ev-3",
            "2025-01-01T00:00:02Z",
            None,
        ),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1, "abort should finalize the current turn");
    assert!(
        !turns[0].is_complete,
        "aborted turn should be marked incomplete"
    );
}
