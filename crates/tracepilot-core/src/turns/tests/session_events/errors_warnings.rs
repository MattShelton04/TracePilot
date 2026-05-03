//! Session error and warning event mapping tests.

use super::super::*;

#[test]
fn session_error_embedded_in_turn() {
    let events = make_turn_events(vec![
        session_error("Rate limit exceeded")
            .error_type("rate_limit")
            .status_code(429)
            .id("evt-err")
            .timestamp("2026-03-10T07:00:30.000Z")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].session_events.len(), 1);
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.error");
    assert_eq!(se.severity, SessionEventSeverity::Error);
    assert_eq!(se.summary, "Rate limit exceeded");
    assert!(se.timestamp.is_some());
}
#[test]
fn session_error_fallback_to_error_type() {
    let events = make_turn_events(vec![
        session_error_empty()
            .error_type("connection_timeout")
            .id("evt-err")
            .timestamp("2026-03-10T07:00:30.000Z")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].session_events[0].summary, "connection_timeout");
}
#[test]
fn session_error_fallback_to_status_code() {
    let events = make_turn_events(vec![
        session_error_empty()
            .status_code(500)
            .id("evt-err")
            .timestamp("2026-03-10T07:00:30.000Z")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].session_events[0].summary, "HTTP 500");
}
#[test]
fn session_error_fallback_to_default() {
    let events = make_turn_events(vec![
        session_error_empty()
            .id("evt-err")
            .timestamp("2026-03-10T07:00:30.000Z")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].session_events[0].summary, "Session error");
}
#[test]
fn session_warning_embedded_in_turn() {
    let events = make_turn_events(vec![
        session_warning("Approaching token limit")
            .warning_type("token_budget")
            .id("evt-warn")
            .timestamp("2026-03-10T07:00:30.000Z")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].session_events.len(), 1);
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.warning");
    assert_eq!(se.severity, SessionEventSeverity::Warning);
    assert_eq!(se.summary, "Approaching token limit");
}
