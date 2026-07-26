use super::*;

#[test]
fn estimates_initial_system_prompt_before_observed_telemetry() {
    let events = vec![
        event(
            SessionEventType::SystemMessage,
            TypedEventData::SystemMessage(SystemMessageData {
                content: Some("1234567890abcdef".into()),
                role: Some("system".into()),
                name: None,
                metadata: None,
            }),
        ),
        user_message("abcd", "interaction-1"),
        event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("1".into()),
                interaction_id: Some("interaction-1".into()),
            }),
        ),
        assistant_message("efgh"),
        // A later root prompt replaces the System layer for the next request;
        // it is neither discarded nor added to Conversation.
        event(
            SessionEventType::SystemMessage,
            TypedEventData::SystemMessage(SystemMessageData {
                content: Some("1234567890abcdefghijklmnopqrstuv".into()),
                role: Some("system".into()),
                name: None,
                metadata: None,
            }),
        ),
        user_message("ijkl", "interaction-2"),
        event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("2".into()),
                interaction_id: Some("interaction-2".into()),
            }),
        ),
        assistant_message("mnop"),
    ];

    let timeline = build_context_timeline(&events);
    assert_eq!(timeline.points.len(), 2);
    assert_eq!(timeline.points[0].system_tokens, 4);
    assert_eq!(timeline.points[1].system_tokens, 8);
    assert_eq!(timeline.points[0].tool_definition_tokens, 0);
    assert_eq!(timeline.points[0].conversation_tokens, 2);
    assert_eq!(timeline.points[1].conversation_tokens, 4);
    assert_eq!(timeline.points[0].total_tokens, 6);
    assert_eq!(timeline.points[1].total_tokens, 12);
    assert_eq!(timeline.points[0].source, ContextPointSource::Estimated);
}

#[test]
fn observed_system_anchor_calibrates_following_prompt_snapshots() {
    let system_message = || {
        event(
            SessionEventType::SystemMessage,
            TypedEventData::SystemMessage(SystemMessageData {
                content: Some("1234567890abcdef".into()),
                role: Some("system".into()),
                name: None,
                metadata: None,
            }),
        )
    };
    let events = vec![
        system_message(),
        user_message("abcd", "interaction-1"),
        event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("1".into()),
                interaction_id: Some("interaction-1".into()),
            }),
        ),
        assistant_message("efgh"),
        event(
            SessionEventType::SessionShutdown,
            TypedEventData::SessionShutdown(ShutdownData {
                shutdown_type: None,
                error_reason: None,
                total_premium_requests: None,
                total_api_duration_ms: None,
                session_start_time: None,
                events_file_size_bytes: None,
                current_model: None,
                current_tokens: Some(12),
                system_tokens: Some(10),
                conversation_tokens: Some(2),
                tool_definitions_tokens: Some(0),
                total_nano_aiu: None,
                source_metrics_scope: None,
                token_details: None,
                code_changes: None,
                model_metrics: None,
                session_segments: None,
            }),
        ),
        system_message(),
        user_message("ijkl", "interaction-2"),
        event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("2".into()),
                interaction_id: Some("interaction-2".into()),
            }),
        ),
        assistant_message("mnop"),
    ];

    let timeline = build_context_timeline(&events);
    assert_eq!(timeline.points.len(), 2);
    assert_eq!(timeline.points[0].source, ContextPointSource::Observed);
    assert_eq!(timeline.points[0].system_tokens, 10);
    assert_eq!(timeline.points[1].source, ContextPointSource::Estimated);
    assert_eq!(timeline.points[1].system_tokens, 10);
}
