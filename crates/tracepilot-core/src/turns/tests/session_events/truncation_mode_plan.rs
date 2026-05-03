//! Truncation, plan, and mode-change session event tests.

use super::super::*;

#[test]
fn session_truncation_embedded() {
    let events = make_turn_events(vec![make_event(
        SessionEventType::SessionTruncation,
        TypedEventData::SessionTruncation(SessionTruncationData {
            token_limit: Some(200000),
            pre_truncation_tokens_in_messages: Some(250000),
            pre_truncation_messages_length: Some(300),
            post_truncation_tokens_in_messages: Some(180000),
            post_truncation_messages_length: Some(200),
            tokens_removed_during_truncation: Some(70000),
            messages_removed_during_truncation: Some(100),
            performed_by: Some("system".to_string()),
        }),
        "evt-trunc",
        "2026-03-10T07:00:30.000Z",
        None,
    )]);

    let turns = reconstruct_turns(&events);
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.truncation");
    assert_eq!(se.severity, SessionEventSeverity::Warning);
    assert_eq!(se.summary, "Truncated 70000 tokens, 100 messages");
}
#[test]
fn plan_changed_embedded() {
    let events = make_turn_events(vec![make_event(
        SessionEventType::SessionPlanChanged,
        TypedEventData::PlanChanged(PlanChangedData {
            operation: Some("replace".to_string()),
        }),
        "evt-plan",
        "2026-03-10T07:00:30.000Z",
        None,
    )]);

    let turns = reconstruct_turns(&events);
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.plan_changed");
    assert_eq!(se.severity, SessionEventSeverity::Info);
    assert_eq!(se.summary, "Agent plan updated (replace)");
}
#[test]
fn mode_changed_embedded() {
    let events = make_turn_events(vec![make_event(
        SessionEventType::SessionModeChanged,
        TypedEventData::SessionModeChanged(SessionModeChangedData {
            previous_mode: Some("normal".to_string()),
            new_mode: Some("plan".to_string()),
        }),
        "evt-mode",
        "2026-03-10T07:00:30.000Z",
        None,
    )]);

    let turns = reconstruct_turns(&events);
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.mode_changed");
    assert_eq!(se.severity, SessionEventSeverity::Info);
    assert_eq!(se.summary, "Mode: normal → plan");
}
#[test]
fn truncation_summary_tokens_only() {
    let events = make_turn_events(vec![make_event(
        SessionEventType::SessionTruncation,
        TypedEventData::SessionTruncation(SessionTruncationData {
            token_limit: None,
            pre_truncation_tokens_in_messages: None,
            pre_truncation_messages_length: None,
            post_truncation_tokens_in_messages: None,
            post_truncation_messages_length: None,
            tokens_removed_during_truncation: Some(5000),
            messages_removed_during_truncation: None,
            performed_by: None,
        }),
        "evt-trunc",
        "2026-03-10T07:00:30.000Z",
        None,
    )]);

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].session_events[0].summary, "Truncated 5000 tokens");
}
#[test]
fn truncation_summary_default_fallback() {
    let events = make_turn_events(vec![make_event(
        SessionEventType::SessionTruncation,
        TypedEventData::SessionTruncation(SessionTruncationData {
            token_limit: None,
            pre_truncation_tokens_in_messages: None,
            pre_truncation_messages_length: None,
            post_truncation_tokens_in_messages: None,
            post_truncation_messages_length: None,
            tokens_removed_during_truncation: None,
            messages_removed_during_truncation: None,
            performed_by: None,
        }),
        "evt-trunc",
        "2026-03-10T07:00:30.000Z",
        None,
    )]);

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].session_events[0].summary, "Context truncated");
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
