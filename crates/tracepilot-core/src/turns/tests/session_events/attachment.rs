//! Session event buffering and turn attachment tests.

use super::super::*;

#[test]
fn multiple_session_events_in_single_turn() {
    let events = make_turn_events(vec![
        compaction_start()
            .id("evt-cs")
            .timestamp("2026-03-10T07:00:10.000Z")
            .build_event(),
        compaction_complete()
            .success(true)
            .pre_compaction_tokens(40000)
            .id("evt-cc")
            .timestamp("2026-03-10T07:00:20.000Z")
            .build_event(),
        session_error("API timeout")
            .id("evt-err")
            .timestamp("2026-03-10T07:00:30.000Z")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].session_events.len(), 3);
    assert_eq!(
        turns[0].session_events[0].event_type,
        "session.compaction_start"
    );
    assert_eq!(
        turns[0].session_events[1].event_type,
        "session.compaction_complete"
    );
    assert_eq!(turns[0].session_events[2].event_type, "session.error");
}
#[test]
fn session_events_between_turns_attach_to_next_turn() {
    // Events that arrive between turns should be buffered and flushed into the next turn
    let events = vec![
        // Turn 1
        user_msg("First")
            .id("evt-u1")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        turn_end()
            .id("evt-te1")
            .timestamp("2026-03-10T07:01:00.000Z")
            .build_event(),
        // Session events between turns (no current turn)
        session_error("Connection lost")
            .id("evt-err")
            .timestamp("2026-03-10T07:01:30.000Z")
            .build_event(),
        session_warning("Reconnecting")
            .id("evt-warn")
            .timestamp("2026-03-10T07:01:45.000Z")
            .build_event(),
        // Turn 2 — buffered events should be flushed here
        user_msg("Second")
            .id("evt-u2")
            .timestamp("2026-03-10T07:02:00.000Z")
            .build_event(),
        turn_end()
            .id("evt-te2")
            .timestamp("2026-03-10T07:03:00.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 2);
    // Turn 1 should have no session events
    assert_eq!(turns[0].session_events.len(), 0);
    // Turn 2 should have the 2 buffered events
    assert_eq!(turns[1].session_events.len(), 2);
    assert_eq!(turns[1].session_events[0].summary, "Connection lost");
    assert_eq!(turns[1].session_events[1].summary, "Reconnecting");
}
#[test]
fn session_events_before_any_turn_attach_to_first() {
    // Session events that arrive before any UserMessage should attach to the first turn
    let events = vec![
        make_event(
            SessionEventType::SessionModeChanged,
            TypedEventData::SessionModeChanged(SessionModeChangedData {
                previous_mode: None,
                new_mode: Some("plan".to_string()),
            }),
            "evt-mode",
            "2026-03-10T06:59:00.000Z",
            None,
        ),
        user_msg("Go")
            .id("evt-u1")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        turn_end()
            .id("evt-te1")
            .timestamp("2026-03-10T07:01:00.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].session_events.len(), 1);
    assert_eq!(
        turns[0].session_events[0].event_type,
        "session.mode_changed"
    );
    assert_eq!(turns[0].session_events[0].summary, "Mode changed to plan");
}
#[test]
fn trailing_session_events_attach_to_last_turn() {
    // Session events that arrive after the last TurnEnd should attach to the last turn
    let events = vec![
        user_msg("Hello")
            .id("evt-u1")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        turn_end()
            .id("evt-te1")
            .timestamp("2026-03-10T07:01:00.000Z")
            .build_event(),
        session_error("Session crashed")
            .id("evt-err")
            .timestamp("2026-03-10T07:02:00.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].session_events.len(), 1);
    assert_eq!(turns[0].session_events[0].summary, "Session crashed");
}
#[test]
fn session_events_flush_via_ensure_current_turn() {
    // Session events buffered before a synthetic turn (created by AssistantReasoning,
    // not UserMessage) should still be flushed into that turn.
    let events = vec![
        make_event(
            SessionEventType::SessionModeChanged,
            TypedEventData::SessionModeChanged(SessionModeChangedData {
                previous_mode: None,
                new_mode: Some("plan".to_string()),
            }),
            "evt-mode",
            "2026-03-10T06:59:00.000Z",
            None,
        ),
        make_event(
            SessionEventType::AssistantReasoning,
            TypedEventData::AssistantReasoning(AssistantReasoningData {
                reasoning_id: Some("r1".to_string()),
                content: Some("Thinking...".to_string()),
            }),
            "evt-reason",
            "2026-03-10T07:00:00.000Z",
            None,
        ),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    // The mode_changed event should be flushed into the synthetic turn
    assert_eq!(turns[0].session_events.len(), 1);
    assert_eq!(
        turns[0].session_events[0].event_type,
        "session.mode_changed"
    );
}
#[test]
fn orphaned_session_events_create_synthetic_turn() {
    // A session with only session events (no UserMessage or other turn-creating events)
    // should produce a synthetic turn to hold them.
    let events = vec![
        session_error("Authentication failed")
            .error_type("auth_failed")
            .status_code(401)
            .id("evt-err")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert!(turns[0].user_message.is_none());
    assert_eq!(turns[0].session_events.len(), 1);
    assert_eq!(turns[0].session_events[0].summary, "Authentication failed");
}
