//! Session event serialization compatibility tests.

use super::super::*;

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
            checkpoint_number: None,
            request_id: None,
            tool_call_id: None,
            prompt_kind: None,
            result_kind: None,
            resolved_by_hook: None,
            skill_invocation_id: None,
            skill_name: None,
            skill_path: None,
            skill_description: None,
            skill_content_length: None,
            skill_context_length: None,
            skill_context_folded: None,
        }],
        system_messages: Vec::new(),
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
