//! Context compaction event mapping tests.

use super::super::*;

#[test]
fn compaction_start_embedded_in_turn() {
    let events = make_turn_events(vec![
        compaction_start()
            .id("evt-comp-start")
            .timestamp("2026-03-10T07:00:30.000Z")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    assert_eq!(turns[0].session_events.len(), 1);
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.compaction_start");
    assert_eq!(se.severity, SessionEventSeverity::Info);
    assert_eq!(se.summary, "Context compaction started");
}
#[test]
fn compaction_complete_success() {
    let events = make_turn_events(vec![
        compaction_complete()
            .success(true)
            .pre_compaction_tokens(50000)
            .pre_compaction_messages_length(120)
            .id("evt-comp")
            .timestamp("2026-03-10T07:00:30.000Z")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.compaction_complete");
    assert_eq!(se.severity, SessionEventSeverity::Info);
    assert_eq!(se.summary, "Compaction complete (50000 tokens)");
}
#[test]
fn compaction_complete_failure() {
    let events = make_turn_events(vec![
        compaction_complete()
            .success(false)
            .error("Out of memory")
            .pre_compaction_tokens(50000)
            .id("evt-comp")
            .timestamp("2026-03-10T07:00:30.000Z")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    let se = &turns[0].session_events[0];
    assert_eq!(se.severity, SessionEventSeverity::Warning);
    assert_eq!(se.summary, "Compaction failed: Out of memory");
}
#[test]
fn compaction_complete_passes_checkpoint_number() {
    let events = make_turn_events(vec![
        compaction_complete()
            .success(true)
            .pre_compaction_tokens(60000)
            .checkpoint_number(5)
            .id("evt-comp-cp")
            .timestamp("2026-03-10T07:00:30.000Z")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.compaction_complete");
    assert_eq!(se.checkpoint_number, Some(5));
    assert_eq!(se.summary, "Compaction complete (60000 tokens)");
}
#[test]
fn compaction_complete_no_checkpoint_number() {
    let events = make_turn_events(vec![
        compaction_complete()
            .success(true)
            .pre_compaction_tokens(40000)
            .id("evt-comp-nocp")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    let se = &turns[0].session_events[0];
    assert_eq!(se.checkpoint_number, None);
}
#[test]
fn compaction_error_with_success_none() {
    // When success is None but error is set, treat as failure
    let events = make_turn_events(vec![
        compaction_complete()
            .error("OOM")
            .pre_compaction_tokens(50000)
            .id("evt-comp")
            .timestamp("2026-03-10T07:00:30.000Z")
            .build_event(),
    ]);

    let turns = reconstruct_turns(&events);
    let se = &turns[0].session_events[0];
    assert_eq!(se.severity, SessionEventSeverity::Warning);
    assert_eq!(se.summary, "Compaction failed: OOM");
}
