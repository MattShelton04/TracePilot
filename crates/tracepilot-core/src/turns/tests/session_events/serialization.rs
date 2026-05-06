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
            skill_invocation: None,
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

#[test]
fn skill_invocation_session_event_serialization_round_trip() {
    let event = TurnSessionEvent {
        event_type: "skill.invoked".to_string(),
        timestamp: None,
        severity: SessionEventSeverity::Info,
        summary: "Skill invoked: trace-skill".to_string(),
        checkpoint_number: None,
        request_id: None,
        tool_call_id: None,
        prompt_kind: None,
        result_kind: None,
        resolved_by_hook: None,
        skill_invocation: Some(SkillInvocationEvent {
            id: Some("evt-skill".to_string()),
            name: Some("trace-skill".to_string()),
            path: Some("C:\\skills\\trace-skill\\SKILL.md".to_string()),
            description: Some("Helpful skill".to_string()),
            content_length: Some(42),
            context_length: Some(84),
            context_folded: true,
        }),
    };

    let json = serde_json::to_value(&event).unwrap();
    assert_eq!(json["eventType"], "skill.invoked");
    assert_eq!(json["skillInvocation"]["name"], "trace-skill");
    assert_eq!(json["skillInvocation"]["contentLength"], 42);
    assert_eq!(json["skillInvocation"]["contextLength"], 84);
    assert_eq!(json["skillInvocation"]["contextFolded"], true);

    let deserialized: TurnSessionEvent = serde_json::from_value(json).unwrap();
    let skill = deserialized.skill_invocation.unwrap();
    assert_eq!(skill.name.as_deref(), Some("trace-skill"));
    assert_eq!(skill.content_length, Some(42));
    assert_eq!(skill.context_length, Some(84));
    assert!(skill.context_folded);
}
