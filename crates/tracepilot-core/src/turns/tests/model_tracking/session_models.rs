//! Session model source and inheritance tests.

use super::super::*;

#[test]
fn session_model_change_sets_turn_model() {
    let events = vec![
        user_msg("Hello")
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
        model_change()
            .new_model("claude-sonnet-4")
            .id("ev-3")
            .timestamp("2025-01-01T00:00:02Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-4")
            .timestamp("2025-01-01T00:00:03Z")
            .build_event(),
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
                remote_steerable: None,
            }),
            "ev-start",
            "2025-01-01T00:00:00Z",
            None,
        ),
        user_msg("Hello")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
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
                copilot_version: None,
                event_count: None,
                reasoning_effort: None,
                context: None,
                already_in_use: None,
                remote_steerable: None,
            }),
            "ev-resume",
            "2025-01-01T00:00:00Z",
            None,
        ),
        user_msg("Hello again")
            .interaction_id("int-2")
            .id("ev-2")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
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
                remote_steerable: None,
            }),
            "ev-start",
            "2025-01-01T00:00:00Z",
            None,
        ),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
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
        user_msg("Hello")
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
        tool_start("read_file")
            .tool_call_id("tc-1")
            .id("ev-2b")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
        tool_complete("tc-1")
            .model("gpt-4o")
            .success(true)
            .id("ev-3")
            .timestamp("2025-01-01T00:00:02Z")
            .build_event(),
        model_change()
            .previous_model("gpt-4o")
            .new_model("claude-sonnet-4")
            .id("ev-4")
            .timestamp("2025-01-01T00:00:03Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-5")
            .timestamp("2025-01-01T00:00:04Z")
            .build_event(),
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
        model_change()
            .new_model("claude-sonnet-4")
            .id("ev-0")
            .timestamp("2025-01-01T00:00:00Z")
            .build_event(),
        user_msg("Hello")
            .interaction_id("int-1")
            .id("ev-1")
            .timestamp("2025-01-01T00:00:01Z")
            .build_event(),
        turn_start()
            .turn_id("turn-1")
            .interaction_id("int-1")
            .id("ev-2")
            .timestamp("2025-01-01T00:00:02Z")
            .build_event(),
        turn_end()
            .turn_id("turn-1")
            .id("ev-3")
            .timestamp("2025-01-01T00:00:03Z")
            .build_event(),
    ];
    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(
        turns[0].model.as_deref(),
        Some("claude-sonnet-4"),
        "turn should inherit session_model from prior model change"
    );
}
