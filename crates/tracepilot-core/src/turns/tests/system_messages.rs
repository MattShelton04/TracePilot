//! Tests for system.message event handling in the turn reconstructor.
//!
//! system.message events carry the AI's injected system message (role="system"
//! or role="developer" in the OpenAI API sense — always the CLI system prompt
//! in practice). They appear in newer auto-mode sessions: once per turn and
//! also re-emitted after each context compaction event.

use super::*;

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Build a minimal system.message event with the given content.
fn sys_msg(content: &str) -> TypedEvent {
    system_message(content)
        .id("evt-sys")
        .timestamp("2026-03-10T07:00:00.000Z")
        .build_event()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn system_message_before_first_turn_is_flushed_into_it() {
    let events = vec![
        sys_msg("You are a helpful assistant."),
        user_msg("Hello")
            .id("evt-user")
            .timestamp("2026-03-10T07:00:01.000Z")
            .build_event(),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:02.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].system_messages,
        vec!["You are a helpful assistant."]
    );
}

#[test]
fn system_message_during_turn_attaches_directly() {
    let events = vec![
        user_msg("Hello")
            .id("evt-user")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        sys_msg("You are a coding assistant."),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:02.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].system_messages,
        vec!["You are a coding assistant."]
    );
}

#[test]
fn system_message_with_empty_content_is_ignored() {
    let events = vec![
        system_message_empty()
            .id("evt-sys-empty")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        user_msg("Hello")
            .id("evt-user")
            .timestamp("2026-03-10T07:00:01.000Z")
            .build_event(),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:02.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert!(
        turns[0].system_messages.is_empty(),
        "Empty content should be ignored"
    );
}

#[test]
fn system_message_with_whitespace_only_content_is_ignored() {
    let events = vec![
        system_message("   \n  ")
            .id("evt-sys-ws")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        user_msg("Hello")
            .id("evt-user")
            .timestamp("2026-03-10T07:00:01.000Z")
            .build_event(),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:02.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert!(
        turns[0].system_messages.is_empty(),
        "Whitespace-only content should be ignored"
    );
}

#[test]
fn multiple_system_messages_before_first_turn_all_flushed() {
    let events = vec![
        system_message("First prompt.")
            .id("evt-sys-1")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        system_message("Second prompt.")
            .id("evt-sys-2")
            .timestamp("2026-03-10T07:00:00.100Z")
            .build_event(),
        user_msg("Hello")
            .id("evt-user")
            .timestamp("2026-03-10T07:00:01.000Z")
            .build_event(),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:02.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].system_messages,
        vec!["First prompt.", "Second prompt."]
    );
}

#[test]
fn system_message_flushes_to_correct_turn_in_multiturn_session() {
    // system.message appears before turn 2 (between turns)
    let events = vec![
        user_msg("First question")
            .id("evt-user-1")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        turn_end()
            .id("evt-end-1")
            .timestamp("2026-03-10T07:00:01.000Z")
            .build_event(),
        system_message("Re-injected prompt after compaction.")
            .id("evt-sys")
            .timestamp("2026-03-10T07:00:02.000Z")
            .build_event(),
        user_msg("Second question")
            .id("evt-user-2")
            .timestamp("2026-03-10T07:00:03.000Z")
            .build_event(),
        turn_end()
            .id("evt-end-2")
            .timestamp("2026-03-10T07:00:04.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 2);
    assert!(
        turns[0].system_messages.is_empty(),
        "Turn 0 should have no system messages"
    );
    assert_eq!(
        turns[1].system_messages,
        vec!["Re-injected prompt after compaction."]
    );
}

#[test]
fn session_without_system_message_has_empty_field() {
    let events = vec![
        user_msg("Hello")
            .id("evt-user")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:01.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert!(
        turns[0].system_messages.is_empty(),
        "Turns without system.message events should have empty system_messages"
    );
}

#[test]
fn system_message_not_serialized_when_absent() {
    // Ensure skip_serializing_if="Vec::is_empty" works — field absent from JSON
    // when no system messages exist (preserves wire compatibility with older parsers).
    let events = vec![
        user_msg("Hi")
            .id("evt-user")
            .timestamp("2026-03-10T07:00:00.000Z")
            .build_event(),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:01.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    let json = serde_json::to_value(&turns[0]).unwrap();
    assert!(
        json.get("systemMessages").is_none(),
        "systemMessages should not appear in JSON when empty"
    );
}

#[test]
fn system_message_serializes_when_present() {
    let events = vec![
        sys_msg("You are a helpful assistant."),
        user_msg("Hi")
            .id("evt-user")
            .timestamp("2026-03-10T07:00:01.000Z")
            .build_event(),
        turn_end()
            .id("evt-end")
            .timestamp("2026-03-10T07:00:02.000Z")
            .build_event(),
    ];

    let turns = reconstruct_turns(&events);
    let json = serde_json::to_value(&turns[0]).unwrap();
    assert_eq!(
        json["systemMessages"][0], "You are a helpful assistant.",
        "systemMessages should appear in JSON when present"
    );
}
