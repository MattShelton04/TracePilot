//! Session event handling tests.
//!
//! Tests for session-level events: errors, warnings, compaction, truncation, mode changes, etc.
//!
//! ## Tests Included
//! - Session error handling with fallbacks
//! - Session warnings
//! - Compaction events (start, complete, failure)
//! - Session truncation
//! - Plan and mode changes
//! - Event attachment to turns
//! - Serialization and deserialization

use super::*;

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

    let turns = reconstruct_turns(events.clone());
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

    let turns = reconstruct_turns(events.clone());
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
fn session_error_embedded_in_turn() {
    let events = make_turn_events(vec![session_error("Rate limit exceeded")
        .error_type("rate_limit")
        .status_code(429)
        .id("evt-err")
        .timestamp("2026-03-10T07:00:30.000Z")
        .build_event()]);

    let turns = reconstruct_turns(events.clone());
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
    let events = make_turn_events(vec![session_error_empty()
        .error_type("connection_timeout")
        .id("evt-err")
        .timestamp("2026-03-10T07:00:30.000Z")
        .build_event()]);

    let turns = reconstruct_turns(events.clone());
    assert_eq!(turns[0].session_events[0].summary, "connection_timeout");
}
#[test]
fn session_error_fallback_to_status_code() {
    let events = make_turn_events(vec![session_error_empty()
        .status_code(500)
        .id("evt-err")
        .timestamp("2026-03-10T07:00:30.000Z")
        .build_event()]);

    let turns = reconstruct_turns(events.clone());
    assert_eq!(turns[0].session_events[0].summary, "HTTP 500");
}
#[test]
fn session_error_fallback_to_default() {
    let events = make_turn_events(vec![session_error_empty()
        .id("evt-err")
        .timestamp("2026-03-10T07:00:30.000Z")
        .build_event()]);

    let turns = reconstruct_turns(events.clone());
    assert_eq!(turns[0].session_events[0].summary, "Session error");
}
#[test]
fn session_warning_embedded_in_turn() {
    let events = make_turn_events(vec![session_warning("Approaching token limit")
        .warning_type("token_budget")
        .id("evt-warn")
        .timestamp("2026-03-10T07:00:30.000Z")
        .build_event()]);

    let turns = reconstruct_turns(events.clone());
    assert_eq!(turns[0].session_events.len(), 1);
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.warning");
    assert_eq!(se.severity, SessionEventSeverity::Warning);
    assert_eq!(se.summary, "Approaching token limit");
}
#[test]
fn compaction_start_embedded_in_turn() {
    let events = make_turn_events(vec![compaction_start()
        .id("evt-comp-start")
        .timestamp("2026-03-10T07:00:30.000Z")
        .build_event()]);

    let turns = reconstruct_turns(events.clone());
    assert_eq!(turns[0].session_events.len(), 1);
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.compaction_start");
    assert_eq!(se.severity, SessionEventSeverity::Info);
    assert_eq!(se.summary, "Context compaction started");
}
#[test]
fn compaction_complete_success() {
    let events = make_turn_events(vec![compaction_complete()
        .success(true)
        .pre_compaction_tokens(50000)
        .pre_compaction_messages_length(120)
        .id("evt-comp")
        .timestamp("2026-03-10T07:00:30.000Z")
        .build_event()]);

    let turns = reconstruct_turns(events.clone());
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.compaction_complete");
    assert_eq!(se.severity, SessionEventSeverity::Info);
    assert_eq!(se.summary, "Compaction complete (50000 tokens)");
}
#[test]
fn compaction_complete_failure() {
    let events = make_turn_events(vec![compaction_complete()
        .success(false)
        .error("Out of memory")
        .pre_compaction_tokens(50000)
        .id("evt-comp")
        .timestamp("2026-03-10T07:00:30.000Z")
        .build_event()]);

    let turns = reconstruct_turns(events.clone());
    let se = &turns[0].session_events[0];
    assert_eq!(se.severity, SessionEventSeverity::Warning);
    assert_eq!(se.summary, "Compaction failed: Out of memory");
}
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

    let turns = reconstruct_turns(events.clone());
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

    let turns = reconstruct_turns(events.clone());
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

    let turns = reconstruct_turns(events.clone());
    let se = &turns[0].session_events[0];
    assert_eq!(se.event_type, "session.mode_changed");
    assert_eq!(se.severity, SessionEventSeverity::Info);
    assert_eq!(se.summary, "Mode: normal → plan");
}
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

    let turns = reconstruct_turns(events.clone());
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

    let turns = reconstruct_turns(events.clone());
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

    let turns = reconstruct_turns(events.clone());
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

    let turns = reconstruct_turns(events.clone());
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].session_events.len(), 1);
    assert_eq!(turns[0].session_events[0].summary, "Session crashed");
}
#[test]
fn session_events_backward_compat_deserialization() {
    // Ensure ConversationTurn can be deserialized without session_events field (backward compat)
    let json = serde_json::json!({
        "turnIndex": 0,
        "turnId": null,
        "interactionId": null,
        "userMessage": "Hi",
        "assistantMessages": [],
        "model": null,
        "timestamp": null,
        "endTimestamp": null,
        "toolCalls": [],
        "durationMs": null,
        "isComplete": true,
        "reasoningTexts": [],
        "outputTokens": null,
        "transformedUserMessage": null,
        "attachments": null
    });

    let turn: ConversationTurn = serde_json::from_value(json).unwrap();
    assert!(turn.session_events.is_empty());
}
#[test]
fn session_events_serialization_round_trip() {
    let turn = ConversationTurn {
        turn_index: 0,
        event_index: None,
        turn_id: None,
        interaction_id: None,
        user_message: Some("Hi".to_string()),
        assistant_messages: Vec::new(),
        model: None,
        timestamp: None,
        end_timestamp: None,
        tool_calls: Vec::new(),
        duration_ms: None,
        is_complete: true,
        reasoning_texts: Vec::new(),
        output_tokens: None,
        transformed_user_message: None,
        attachments: None,
        session_events: vec![TurnSessionEvent {
            event_type: "session.error".to_string(),
            timestamp: None,
            severity: SessionEventSeverity::Error,
            summary: "Test error".to_string(),
        }],
    };

    let json = serde_json::to_value(&turn).unwrap();
    assert_eq!(json["sessionEvents"][0]["eventType"], "session.error");
    assert_eq!(json["sessionEvents"][0]["severity"], "error");
    assert_eq!(json["sessionEvents"][0]["summary"], "Test error");

    // Round-trip
    let deserialized: ConversationTurn = serde_json::from_value(json).unwrap();
    assert_eq!(deserialized.session_events.len(), 1);
    assert_eq!(
        deserialized.session_events[0].severity,
        SessionEventSeverity::Error
    );
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

    let turns = reconstruct_turns(events.clone());
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

    let turns = reconstruct_turns(events.clone());
    assert_eq!(turns[0].session_events[0].summary, "Context truncated");
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

    let turns = reconstruct_turns(events.clone());
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
    let events = vec![session_error("Authentication failed")
        .error_type("auth_failed")
        .status_code(401)
        .id("evt-err")
        .timestamp("2026-03-10T07:00:00.000Z")
        .build_event()];

    let turns = reconstruct_turns(events.clone());
    assert_eq!(turns.len(), 1);
    assert!(turns[0].user_message.is_none());
    assert_eq!(turns[0].session_events.len(), 1);
    assert_eq!(turns[0].session_events[0].summary, "Authentication failed");
}
#[test]
fn compaction_error_with_success_none() {
    // When success is None but error is set, treat as failure
    let events = make_turn_events(vec![compaction_complete()
        .error("OOM")
        .pre_compaction_tokens(50000)
        .id("evt-comp")
        .timestamp("2026-03-10T07:00:30.000Z")
        .build_event()]);

    let turns = reconstruct_turns(events.clone());
    let se = &turns[0].session_events[0];
    assert_eq!(se.severity, SessionEventSeverity::Warning);
    assert_eq!(se.summary, "Compaction failed: OOM");
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

    let turns = reconstruct_turns(events.clone());
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
    let turns = reconstruct_turns(events.clone());
    assert_eq!(turns.len(), 1, "abort should finalize the current turn");
    assert!(
        !turns[0].is_complete,
        "aborted turn should be marked incomplete"
    );
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

    let turns = reconstruct_turns(events.clone());
    assert_eq!(turns[0].session_events[0].summary, "Truncated 25 messages");
}
