    use super::*;
    use crate::models::conversation::{AttributedMessage, SessionEventSeverity};
    use crate::models::event_types::{
        AbortData, AssistantMessageData, AssistantReasoningData, CompactionCompleteData,
        CompactionStartData, ModelChangeData, PlanChangedData, SessionErrorData,
        SessionModeChangedData, SessionResumeData, SessionStartData, SessionTruncationData,
        SessionWarningData, SubagentCompletedData, SubagentFailedData, SubagentStartedData,
        ToolExecCompleteData, ToolExecStartData, TurnEndData, TurnStartData, UserMessageData,
    };
    use crate::parsing::events::{RawEvent, TypedEvent};
    use serde_json::{Value, json};

    /// Helper: extract message content strings for easy assertion.
    fn msg_contents(messages: &[AttributedMessage]) -> Vec<&str> {
        messages.iter().map(|m| m.content.as_str()).collect()
    }

    fn make_event(
        event_type: SessionEventType,
        data: TypedEventData,
        id: &str,
        ts: &str,
        parent: Option<&str>,
    ) -> TypedEvent {
        let raw_data = typed_data_to_value(&data);
        TypedEvent {
            raw: RawEvent {
                event_type: event_type.to_string(),
                data: raw_data,
                id: Some(id.to_string()),
                timestamp: Some(
                    chrono::DateTime::parse_from_rfc3339(ts)
                        .unwrap()
                        .with_timezone(&Utc),
                ),
                parent_id: parent.map(str::to_string),
            },
            event_type,
            typed_data: data,
        }
    }

    fn typed_data_to_value(data: &TypedEventData) -> Value {
        match data {
            TypedEventData::SessionStart(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SessionShutdown(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::UserMessage(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::AssistantMessage(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::TurnStart(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::TurnEnd(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::ToolExecutionStart(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::ToolExecutionComplete(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SubagentStarted(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SubagentCompleted(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SubagentFailed(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::CompactionComplete(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::CompactionStart(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::ModelChange(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SessionError(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SessionResume(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SystemNotification(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SkillInvoked(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::Abort(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::PlanChanged(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SessionInfo(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::ContextChanged(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::WorkspaceFileChanged(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::ToolUserRequested(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SessionTruncation(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::AssistantReasoning(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SystemMessage(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SessionWarning(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SessionModeChanged(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SessionTaskComplete(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SubagentSelected(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SubagentDeselected(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::HookStart(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::HookEnd(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SessionHandoff(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::SessionImportLegacy(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::Other(value) => value.clone(),
        }
    }

    #[test]
    fn reconstructs_simple_single_turn() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T07:14:51.100Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("Hi there!".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.000Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-1".to_string()),
                    tool_name: Some("read_file".to_string()),
                    arguments: Some(json!({ "path": "src/lib.rs" })),
                    parent_tool_call_id: None,
                    mcp_server_name: Some("filesystem".to_string()),
                    mcp_tool_name: Some("read".to_string()),
                }),
                "evt-4",
                "2026-03-10T07:14:52.100Z",
                Some("evt-3"),
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-1".to_string()),
                    parent_tool_call_id: None,
                    model: Some("claude-opus-4.6".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    success: Some(true),
                    result: Some(json!("ok")),
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-5",
                "2026-03-10T07:14:52.500Z",
                Some("evt-4"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-6",
                "2026-03-10T07:14:53.000Z",
                Some("evt-2"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);

        let turn = &turns[0];
        assert_eq!(turn.turn_index, 0);
        assert_eq!(turn.turn_id.as_deref(), Some("turn-1"));
        assert_eq!(turn.interaction_id.as_deref(), Some("int-1"));
        assert_eq!(turn.user_message.as_deref(), Some("Hello"));
        assert_eq!(msg_contents(&turn.assistant_messages), vec!["Hi there!"]);
        assert_eq!(turn.model.as_deref(), Some("claude-opus-4.6"));
        assert_eq!(turn.duration_ms, Some(2_000));
        assert!(turn.is_complete);
        assert_eq!(turn.tool_calls.len(), 1);

        let tool_call = &turn.tool_calls[0];
        assert_eq!(tool_call.tool_call_id.as_deref(), Some("tc-1"));
        assert_eq!(tool_call.tool_name, "read_file");
        assert_eq!(tool_call.arguments, Some(json!({ "path": "src/lib.rs" })));
        assert_eq!(tool_call.success, Some(true));
        assert_eq!(tool_call.duration_ms, Some(400));
        assert_eq!(tool_call.mcp_server_name.as_deref(), Some("filesystem"));
        assert_eq!(tool_call.mcp_tool_name.as_deref(), Some("read"));
        assert!(tool_call.is_complete);
    }

    #[test]
    fn reconstructs_multiple_turns() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("First".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T07:14:51.100Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("Response one".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.000Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-4",
                "2026-03-10T07:14:53.000Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Second".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-2".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-5",
                "2026-03-10T07:14:54.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-2".to_string()),
                    interaction_id: Some("int-2".to_string()),
                }),
                "evt-6",
                "2026-03-10T07:14:54.100Z",
                Some("evt-5"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-2".to_string()),
                    content: Some("Response two".to_string()),
                    interaction_id: Some("int-2".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-7",
                "2026-03-10T07:14:55.000Z",
                Some("evt-6"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-2".to_string()),
                }),
                "evt-8",
                "2026-03-10T07:14:56.000Z",
                Some("evt-6"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].turn_index, 0);
        assert_eq!(turns[1].turn_index, 1);
        assert_eq!(turns[0].user_message.as_deref(), Some("First"));
        assert_eq!(turns[1].user_message.as_deref(), Some("Second"));
        assert!(turns.iter().all(|turn| turn.is_complete));
    }

    #[test]
    fn marks_incomplete_session_without_turn_end() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T07:14:51.100Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("Partial".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.000Z",
                Some("evt-2"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        assert!(!turns[0].is_complete);
        assert!(turns[0].end_timestamp.is_none());
    }

    #[test]
    fn collects_multiple_assistant_messages_per_turn() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T07:14:51.100Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("Part one".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.000Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-2".to_string()),
                    content: Some("Part two".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-4",
                "2026-03-10T07:14:52.500Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-5",
                "2026-03-10T07:14:53.000Z",
                Some("evt-2"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns[0].assistant_messages.len(), 2);
        assert_eq!(
            msg_contents(&turns[0].assistant_messages),
            vec!["Part one", "Part two"]
        );
    }

    #[test]
    fn leaves_orphaned_tool_call_incomplete() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-1".to_string()),
                    tool_name: Some("read_file".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].tool_calls.len(), 1);
        assert!(!turns[0].tool_calls[0].is_complete);
        assert!(turns[0].tool_calls[0].completed_at.is_none());
    }

    #[test]
    fn treats_subagent_events_as_tool_calls() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Run specialist".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("sub-1".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                    agent_description: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("sub-1".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                }),
                "evt-3",
                "2026-03-10T07:14:53.000Z",
                Some("evt-2"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].tool_calls.len(), 1);
        let tool_call = &turns[0].tool_calls[0];
        assert_eq!(tool_call.tool_call_id.as_deref(), Some("sub-1"));
        assert_eq!(tool_call.tool_name, "explore");
        assert_eq!(tool_call.success, Some(true));
        assert!(tool_call.is_complete);
    }

    #[test]
    fn computes_turn_stats() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("First".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("One".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-1".to_string()),
                    tool_name: Some("read_file".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.100Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-1".to_string()),
                    parent_tool_call_id: None,
                    model: Some("claude-sonnet-4.5".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-4",
                "2026-03-10T07:14:52.400Z",
                Some("evt-3"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-5",
                "2026-03-10T07:14:53.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Second".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-2".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-6",
                "2026-03-10T07:14:54.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-2".to_string()),
                    content: Some("Two".to_string()),
                    interaction_id: Some("int-2".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-7",
                "2026-03-10T07:14:55.000Z",
                Some("evt-6"),
            ),
        ];

        let turns = reconstruct_turns(&events);
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
    fn subagent_started_merges_into_tool_exec_start() {
        // When SubagentStarted fires with the same toolCallId as a previous ToolExecStart,
        // it should MERGE into the existing entry (not create a duplicate).
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Launch agent".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T10:00:00.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T10:00:00.100Z",
                Some("evt-1"),
            ),
            // ToolExecStart creates entry with arguments
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-agent-1".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: Some(json!({ "prompt": "Review the code", "agent_type": "code-review" })),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-3",
                "2026-03-10T10:00:01.000Z",
                Some("evt-2"),
            ),
            // SubagentStarted should merge into existing entry, not create duplicate
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("tc-agent-1".to_string()),
                    agent_name: Some("code-review".to_string()),
                    agent_display_name: Some("Code Review Agent".to_string()),
                    agent_description: Some("Reviews code for issues".to_string()),
                }),
                "evt-4",
                "2026-03-10T10:00:01.003Z",
                Some("evt-3"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-5",
                "2026-03-10T10:00:02.000Z",
                Some("evt-2"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);

        let turn = &turns[0];
        // Should be 1 entry, not 2 (merged)
        assert_eq!(turn.tool_calls.len(), 1);

        let tc = &turn.tool_calls[0];
        assert_eq!(tc.tool_call_id.as_deref(), Some("tc-agent-1"));
        // Subagent fields from SubagentStarted
        assert!(tc.is_subagent);
        assert_eq!(tc.agent_display_name.as_deref(), Some("Code Review Agent"));
        assert_eq!(tc.agent_description.as_deref(), Some("Reviews code for issues"));
        // Arguments preserved from ToolExecStart
        assert!(tc.arguments.is_some());
        let args = tc.arguments.as_ref().unwrap();
        assert_eq!(args["prompt"], "Review the code");
        assert_eq!(args["agent_type"], "code-review");
        // tool_name updated from SubagentStarted agent_name
        assert_eq!(tc.tool_name, "code-review");
    }

    #[test]
    fn subagent_completed_finds_entry_in_finalized_turn() {
        // SubagentCompleted may arrive after the turn is finalized.
        // It should still find and update the entry in the finalized turn.
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Launch agent".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T10:00:00.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T10:00:00.100Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-agent-1".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: Some(json!({ "prompt": "Explore codebase" })),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-3",
                "2026-03-10T10:00:01.000Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("tc-agent-1".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                    agent_description: None,
                }),
                "evt-4",
                "2026-03-10T10:00:01.003Z",
                Some("evt-3"),
            ),
            // Turn ends BEFORE subagent completes
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-5",
                "2026-03-10T10:00:02.000Z",
                Some("evt-2"),
            ),
            // SubagentCompleted arrives after turn is finalized (4 minutes later)
            make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("tc-agent-1".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                }),
                "evt-6",
                "2026-03-10T10:04:01.000Z",
                None,
            ),
        ];

        let turns = reconstruct_turns(&events);

        // The subagent entry in finalized turn 1 should have the completed_at from SubagentCompleted
        let tc = &turns[0].tool_calls[0];
        assert_eq!(tc.tool_call_id.as_deref(), Some("tc-agent-1"));
        assert!(tc.is_subagent);
        assert!(tc.is_complete);
        assert_eq!(tc.success, Some(true));
        // Duration should be ~4 minutes, not 5ms
        assert!(tc.duration_ms.unwrap() > 200_000, "Duration should be >200s, got {}ms", tc.duration_ms.unwrap());
    }

    #[test]
    fn tool_exec_complete_finds_entry_in_finalized_turn() {
        // ToolExecutionComplete may also arrive after turn boundary
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Do something".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T10:00:00.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T10:00:00.100Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-slow".to_string()),
                    tool_name: Some("powershell".to_string()),
                    arguments: Some(json!({ "command": "sleep 300" })),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-3",
                "2026-03-10T10:00:01.000Z",
                Some("evt-2"),
            ),
            // Turn ends before tool completes
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-4",
                "2026-03-10T10:00:02.000Z",
                Some("evt-2"),
            ),
            // ToolExecComplete arrives after turn is finalized
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-slow".to_string()),
                    parent_tool_call_id: None,
                    model: Some("claude-opus-4.6".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    success: Some(true),
                    result: Some(json!("done")),
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-5",
                "2026-03-10T10:05:01.000Z",
                None,
            ),
        ];

        let turns = reconstruct_turns(&events);
        let tc = &turns[0].tool_calls[0];
        assert_eq!(tc.tool_call_id.as_deref(), Some("tc-slow"));
        assert!(tc.is_complete);
        assert_eq!(tc.success, Some(true));
        // Duration should be ~5 minutes
        assert!(tc.duration_ms.unwrap() > 290_000, "Duration should be >290s, got {}ms", tc.duration_ms.unwrap());
    }

    #[test]
    fn subagent_failed_finds_entry_in_finalized_turn() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Launch".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T10:00:00.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T10:00:00.100Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-fail".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-3",
                "2026-03-10T10:00:01.000Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("tc-fail".to_string()),
                    agent_name: Some("general-purpose".to_string()),
                    agent_display_name: Some("General Agent".to_string()),
                    agent_description: None,
                }),
                "evt-4",
                "2026-03-10T10:00:01.003Z",
                Some("evt-3"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-5",
                "2026-03-10T10:00:02.000Z",
                Some("evt-2"),
            ),
            // SubagentFailed arrives after turn
            make_event(
                SessionEventType::SubagentFailed,
                TypedEventData::SubagentFailed(crate::models::event_types::SubagentFailedData {
                    tool_call_id: Some("tc-fail".to_string()),
                    agent_name: Some("general-purpose".to_string()),
                    agent_display_name: Some("General Agent".to_string()),
                    error: Some("OOM".to_string()),
                }),
                "evt-6",
                "2026-03-10T10:01:30.000Z",
                None,
            ),
        ];

        let turns = reconstruct_turns(&events);
        let tc = &turns[0].tool_calls[0];
        assert!(tc.is_subagent);
        assert!(tc.is_complete);
        assert_eq!(tc.success, Some(false));
        assert_eq!(tc.error.as_deref(), Some("OOM"));
        assert!(tc.duration_ms.unwrap() > 80_000);
    }

    #[test]
    fn filters_empty_string_assistant_messages() {
        // In real sessions, assistant.message events before tool-call batches
        // often carry content: "" (empty string, not null). These should be filtered out.
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Fix the bug".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T07:14:51.100Z",
                Some("evt-1"),
            ),
            // First assistant.message with empty content (tool-call-only response)
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: Some(vec![json!({"id": "tc-1", "name": "grep"})]),
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.000Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-1".to_string()),
                    tool_name: Some("grep".to_string()),
                    arguments: Some(json!({ "pattern": "TODO" })),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-4",
                "2026-03-10T07:14:52.100Z",
                Some("evt-3"),
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-1".to_string()),
                    parent_tool_call_id: None,
                    model: Some("claude-opus-4.6".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-5",
                "2026-03-10T07:14:53.000Z",
                Some("evt-4"),
            ),
            // Second assistant.message with empty content (another tool-call batch)
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-2".to_string()),
                    content: Some("".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: Some(vec![json!({"id": "tc-2", "name": "view"})]),
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-6",
                "2026-03-10T07:14:53.100Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-2".to_string()),
                    tool_name: Some("view".to_string()),
                    arguments: Some(json!({ "path": "src/main.rs" })),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-7",
                "2026-03-10T07:14:53.200Z",
                Some("evt-6"),
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-2".to_string()),
                    parent_tool_call_id: None,
                    model: Some("claude-opus-4.6".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-8",
                "2026-03-10T07:14:54.000Z",
                Some("evt-7"),
            ),
            // Final assistant.message with real content
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-3".to_string()),
                    content: Some("I fixed the bug by updating the handler.".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: Some(42),
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-9",
                "2026-03-10T07:14:54.100Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-10",
                "2026-03-10T07:14:55.000Z",
                Some("evt-2"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);

        let turn = &turns[0];
        // Should only contain the real message, not the empty strings
        assert_eq!(turn.assistant_messages.len(), 1);
        assert_eq!(
            turn.assistant_messages[0].content,
            "I fixed the bug by updating the handler."
        );
        // Tool calls should still be preserved
        assert_eq!(turn.tool_calls.len(), 2);
    }

    #[test]
    fn filters_whitespace_only_assistant_messages() {
        // Edge case: content is whitespace-only (e.g., "\n", "  ", "\t")
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("   ".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-2".to_string()),
                    content: Some("\n".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.100Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-3".to_string()),
                    content: Some("Real response".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-4",
                "2026-03-10T07:14:52.200Z",
                Some("evt-1"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns[0].assistant_messages.len(), 1);
        assert_eq!(turns[0].assistant_messages[0].content, "Real response");
    }

    #[test]
    fn none_content_still_filtered() {
        // content: null (None) should still be filtered (pre-existing behavior)
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: None,
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: Some(vec![json!({"id": "tc-1"})]),
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-2".to_string()),
                    content: Some("Done!".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-3",
                "2026-03-10T07:14:53.000Z",
                Some("evt-1"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns[0].assistant_messages.len(), 1);
        assert_eq!(turns[0].assistant_messages[0].content, "Done!");
    }

    #[test]
    fn realistic_agentic_session_with_many_tool_rounds() {
        // Simulates a realistic agentic session: user asks a question, assistant
        // makes 5 rounds of tool calls (each preceded by an empty-content
        // assistant.message), then gives a final response.
        let mut events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Refactor the auth module".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T07:14:51.100Z",
                Some("evt-1"),
            ),
        ];

        let tool_names = ["grep", "view", "edit", "view", "powershell"];
        let mut evt_counter = 3;
        let base_ts = 52; // seconds offset

        for (round, tool_name) in tool_names.iter().enumerate() {
            // Empty assistant.message before each tool batch
            events.push(make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some(format!("msg-{round}")),
                    content: Some("".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: Some(vec![json!({"id": format!("tc-{round}"), "name": tool_name})]),
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                &format!("evt-{evt_counter}"),
                &format!("2026-03-10T07:14:{}.000Z", base_ts + round * 2),
                Some("evt-2"),
            ));
            evt_counter += 1;

            events.push(make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some(format!("tc-{round}")),
                    tool_name: Some(tool_name.to_string()),
                    arguments: Some(json!({"arg": "value"})),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                &format!("evt-{evt_counter}"),
                &format!("2026-03-10T07:14:{}.100Z", base_ts + round * 2),
                Some(&format!("evt-{}", evt_counter - 1)),
            ));
            evt_counter += 1;

            events.push(make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some(format!("tc-{round}")),
                    parent_tool_call_id: None,
                    model: Some("claude-opus-4.6".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                &format!("evt-{evt_counter}"),
                &format!("2026-03-10T07:14:{}.900Z", base_ts + round * 2),
                Some(&format!("evt-{}", evt_counter - 1)),
            ));
            evt_counter += 1;
        }

        // Final assistant.message with real content
        events.push(make_event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: Some("msg-final".to_string()),
                content: Some("I've refactored the auth module. Here's a summary of changes.".to_string()),
                interaction_id: Some("int-1".to_string()),
                tool_requests: None,
                output_tokens: Some(150),
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
            &format!("evt-{evt_counter}"),
            "2026-03-10T07:15:02.000Z",
            Some("evt-2"),
        ));
        evt_counter += 1;

        events.push(make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            &format!("evt-{evt_counter}"),
            "2026-03-10T07:15:03.000Z",
            Some("evt-2"),
        ));

        let turns = reconstruct_turns(&events);
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
    fn turn_stats_excludes_empty_messages() {
        // Verify that turn_stats reflects the filtered message count
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: Some(vec![json!({"id": "tc-1"})]),
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-2".to_string()),
                    content: Some("".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: Some(vec![json!({"id": "tc-2"})]),
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-3",
                "2026-03-10T07:14:53.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-3".to_string()),
                    content: Some("Final answer".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-4",
                "2026-03-10T07:14:54.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-5",
                "2026-03-10T07:14:55.000Z",
                Some("evt-1"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        let stats = turn_stats(&turns);
        // Only 1 real message, not 3
        assert_eq!(stats.total_messages, 1);
    }

    #[test]
    fn collects_reasoning_texts_from_assistant_messages() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Explain X".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: Some(100),
                    parent_tool_call_id: None,
                    reasoning_text: Some("Let me think about this...".to_string()),
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-2".to_string()),
                    content: Some("Here is the explanation.".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: Some(50),
                    parent_tool_call_id: None,
                    reasoning_text: Some("Now I should summarize.".to_string()),
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-3",
                "2026-03-10T07:14:53.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-4",
                "2026-03-10T07:14:54.000Z",
                Some("evt-1"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        let turn = &turns[0];
        // Both reasoning texts collected
        assert_eq!(turn.reasoning_texts.len(), 2);
        assert_eq!(turn.reasoning_texts[0].content, "Let me think about this...");
        assert_eq!(turn.reasoning_texts[1].content, "Now I should summarize.");
        // Output tokens accumulated
        assert_eq!(turn.output_tokens, Some(150));
        // Only non-empty message kept
        assert_eq!(turn.assistant_messages.len(), 1);
        assert_eq!(turn.assistant_messages[0].content, "Here is the explanation.");
    }

    #[test]
    fn extracts_intention_summary_for_tool_calls() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Fix the bug".to_string()),
                    transformed_content: Some("[[datetime]] Fix the bug [[reminders]]".to_string()),
                    attachments: Some(vec![json!({"type": "file", "path": "src/main.rs"})]),
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: Some(vec![json!({
                        "toolCallId": "tc-1",
                        "name": "view",
                        "intentionSummary": "view the file at src/main.rs",
                        "arguments": {"path": "src/main.rs"}
                    })]),
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-1".to_string()),
                    tool_name: Some("view".to_string()),
                    arguments: Some(json!({"path": "src/main.rs"})),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.100Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-1".to_string()),
                    parent_tool_call_id: None,
                    model: Some("claude-opus-4.6".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    success: Some(true),
                    result: Some(json!({"content": "fn main() { println!(\"hello\"); }", "detailedContent": "1. fn main() {\n2.     println!(\"hello\");\n3. }"})),
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-4",
                "2026-03-10T07:14:52.500Z",
                Some("evt-3"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-5",
                "2026-03-10T07:14:53.000Z",
                Some("evt-1"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        let turn = &turns[0];

        // Transformed user message and attachments preserved
        assert_eq!(
            turn.transformed_user_message.as_deref(),
            Some("[[datetime]] Fix the bug [[reminders]]")
        );
        assert!(turn.attachments.is_some());
        assert_eq!(turn.attachments.as_ref().unwrap().len(), 1);

        // Tool call has intention summary
        assert_eq!(turn.tool_calls.len(), 1);
        let tc = &turn.tool_calls[0];
        assert_eq!(
            tc.intention_summary.as_deref(),
            Some("view the file at src/main.rs")
        );

        // Tool call has result preview (from object with content field)
        assert!(tc.result_content.is_some());
        assert!(tc.result_content.as_ref().unwrap().contains("fn main()"));
    }

    #[test]
    fn handles_polymorphic_result_string() {
        // result can be a plain string (not an object)
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Do something".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-1".to_string()),
                    tool_name: Some("read_file".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-1".to_string()),
                    parent_tool_call_id: None,
                    model: None,
                    interaction_id: None,
                    success: Some(true),
                    result: Some(json!("file contents here")),
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.500Z",
                Some("evt-2"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        let tc = &turns[0].tool_calls[0];
        assert_eq!(tc.result_content.as_deref(), Some("file contents here"));
    }

    #[test]
    fn truncates_large_result_content() {
        let long_result = "x".repeat(2000);
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Go".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-1".to_string()),
                    tool_name: Some("view".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-1".to_string()),
                    parent_tool_call_id: None,
                    model: None,
                    interaction_id: None,
                    success: Some(true),
                    result: Some(json!(long_result)),
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.500Z",
                Some("evt-2"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        let tc = &turns[0].tool_calls[0];
        let content = tc.result_content.as_ref().unwrap();
        // Should be truncated to ~1024 bytes + truncation marker
        assert!(
            content.len() < 1100,
            "Content should be truncated, got {} bytes",
            content.len()
        );
        assert!(content.contains("…[truncated]"));
    }

    #[test]
    fn skips_empty_reasoning_text() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("Hi!".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: Some("".to_string()),
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-2".to_string()),
                    content: Some("More info".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: Some("   ".to_string()),
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-3",
                "2026-03-10T07:14:53.000Z",
                Some("evt-1"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        // Empty and whitespace-only reasoning should be skipped
        assert!(turns[0].reasoning_texts.is_empty());
    }

    #[test]
    fn falls_back_to_detailed_content_when_content_empty() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Go".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-1".to_string()),
                    tool_name: Some("view".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-1".to_string()),
                    parent_tool_call_id: None,
                    model: None,
                    interaction_id: None,
                    success: Some(true),
                    is_user_requested: None,
                    result: Some(json!({"content": "", "detailedContent": "1. fn main() {}\n2. }"})),
                    error: None,
                    tool_telemetry: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.500Z",
                Some("evt-2"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        let tc = &turns[0].tool_calls[0];
        // Should fall back to detailedContent when content is empty
        assert_eq!(tc.result_content.as_deref(), Some("1. fn main() {}\n2. }"));
    }

    #[test]
    fn infers_subagent_model_from_child_tool_calls() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Run agent".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            // Subagent with children that have a model
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("sub-1".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                    agent_description: None,
                }),
                "evt-2",
                "2026-03-10T07:14:52.000Z",
                Some("evt-1"),
            ),
            // Child tool call under sub-1 with a known model
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-child-1".to_string()),
                    tool_name: Some("grep".to_string()),
                    arguments: None,
                    parent_tool_call_id: Some("sub-1".to_string()),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-3",
                "2026-03-10T07:14:52.500Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-child-1".to_string()),
                    parent_tool_call_id: Some("sub-1".to_string()),
                    model: Some("claude-haiku-4.5".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-4",
                "2026-03-10T07:14:53.000Z",
                Some("evt-3"),
            ),
            make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("sub-1".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                }),
                "evt-5",
                "2026-03-10T07:14:54.000Z",
                Some("evt-2"),
            ),
            // Subagent without any children (model stays None)
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("sub-2".to_string()),
                    agent_name: Some("task".to_string()),
                    agent_display_name: Some("Task Agent".to_string()),
                    agent_description: None,
                }),
                "evt-6",
                "2026-03-10T07:14:55.000Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("sub-2".to_string()),
                    agent_name: Some("task".to_string()),
                    agent_display_name: Some("Task Agent".to_string()),
                }),
                "evt-7",
                "2026-03-10T07:14:56.000Z",
                Some("evt-6"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);

        // sub-1 should have model inferred from its child tool call
        let sub1 = turns[0]
            .tool_calls
            .iter()
            .find(|tc| tc.tool_call_id.as_deref() == Some("sub-1"))
            .expect("sub-1 not found");
        assert!(sub1.is_subagent);
        assert_eq!(sub1.model.as_deref(), Some("claude-haiku-4.5"));

        // sub-2 has no children, so model stays None
        let sub2 = turns[0]
            .tool_calls
            .iter()
            .find(|tc| tc.tool_call_id.as_deref() == Some("sub-2"))
            .expect("sub-2 not found");
        assert!(sub2.is_subagent);
        assert_eq!(sub2.model, None);
    }

    /// Real-world event order: ToolExecStart → ToolExecComplete (with wrong parent model)
    /// → SubagentStarted → child ToolExecStart → child ToolExecComplete (correct model).
    /// The subagent's model must be the child's model, not the parent's.
    #[test]
    fn subagent_model_overrides_wrong_parent_model() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Review code".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-04-01T10:00:00.000Z",
                None,
            ),
            // 1. ToolExecStart for the subagent tool call (arguments contain the real model)
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("sub-1".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: Some(json!({
                        "agent_type": "code-review",
                        "model": "gemini-3-pro-preview",
                        "prompt": "Review the diff"
                    })),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-2",
                "2026-04-01T10:00:01.000Z",
                Some("evt-1"),
            ),
            // 2. ToolExecComplete for the subagent — model is WRONG (parent's model)
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("sub-1".to_string()),
                    parent_tool_call_id: None,
                    model: Some("claude-opus-4.6".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: Some(json!({
                        "properties": {
                            "model": "gemini-3-pro-preview"
                        }
                    })),
                    is_user_requested: None,
                }),
                "evt-3",
                "2026-04-01T10:00:02.000Z",
                Some("evt-2"),
            ),
            // 3. SubagentStarted enriches the tool call
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("sub-1".to_string()),
                    agent_name: Some("code-review".to_string()),
                    agent_display_name: Some("Code Review Agent".to_string()),
                    agent_description: None,
                }),
                "evt-4",
                "2026-04-01T10:00:03.000Z",
                Some("evt-2"),
            ),
            // 4. Child ToolExecStart under the subagent
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-child-1".to_string()),
                    tool_name: Some("grep".to_string()),
                    arguments: None,
                    parent_tool_call_id: Some("sub-1".to_string()),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-5",
                "2026-04-01T10:00:04.000Z",
                Some("evt-4"),
            ),
            // 5. Child ToolExecComplete with the CORRECT subagent model
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-child-1".to_string()),
                    parent_tool_call_id: Some("sub-1".to_string()),
                    model: Some("gemini-3-pro-preview".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-6",
                "2026-04-01T10:00:05.000Z",
                Some("evt-5"),
            ),
            make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("sub-1".to_string()),
                    agent_name: Some("code-review".to_string()),
                    agent_display_name: Some("Code Review Agent".to_string()),
                }),
                "evt-7",
                "2026-04-01T10:00:06.000Z",
                Some("evt-4"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);

        let sub1 = turns[0]
            .tool_calls
            .iter()
            .find(|tc| tc.tool_call_id.as_deref() == Some("sub-1"))
            .expect("sub-1 not found");
        assert!(sub1.is_subagent);
        // Must be the child's model, NOT the parent's "claude-opus-4.6"
        assert_eq!(
            sub1.model.as_deref(),
            Some("gemini-3-pro-preview"),
            "subagent model should be overridden by child model, not the parent's model"
        );
    }

    /// Nested subagents: outer subagent launches an inner subagent. The iterative
    /// propagation loop should set models bottom-up across multiple levels.
    #[test]
    fn nested_subagent_model_propagation() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Deep task".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-05-01T12:00:00.000Z",
                None,
            ),
            // Outer subagent: ToolExecStart
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("outer-sub".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: Some(json!({"agent_type": "general-purpose"})),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-2",
                "2026-05-01T12:00:01.000Z",
                Some("evt-1"),
            ),
            // Outer subagent: ToolExecComplete with wrong parent model
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("outer-sub".to_string()),
                    parent_tool_call_id: None,
                    model: Some("claude-opus-4.6".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-3",
                "2026-05-01T12:00:02.000Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("outer-sub".to_string()),
                    agent_name: Some("general-purpose".to_string()),
                    agent_display_name: Some("General Purpose Agent".to_string()),
                    agent_description: None,
                }),
                "evt-4",
                "2026-05-01T12:00:03.000Z",
                Some("evt-2"),
            ),
            // Inner subagent (child of outer): ToolExecStart
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("inner-sub".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: Some(json!({"agent_type": "explore"})),
                    parent_tool_call_id: Some("outer-sub".to_string()),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-5",
                "2026-05-01T12:00:04.000Z",
                Some("evt-4"),
            ),
            // Inner subagent: ToolExecComplete with outer's model (wrong for inner)
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("inner-sub".to_string()),
                    parent_tool_call_id: Some("outer-sub".to_string()),
                    model: Some("claude-sonnet-4.5".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-6",
                "2026-05-01T12:00:05.000Z",
                Some("evt-5"),
            ),
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("inner-sub".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                    agent_description: None,
                }),
                "evt-7",
                "2026-05-01T12:00:06.000Z",
                Some("evt-5"),
            ),
            // Leaf tool call under inner subagent
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("leaf-tc".to_string()),
                    tool_name: Some("view".to_string()),
                    arguments: None,
                    parent_tool_call_id: Some("inner-sub".to_string()),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-8",
                "2026-05-01T12:00:07.000Z",
                Some("evt-7"),
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("leaf-tc".to_string()),
                    parent_tool_call_id: Some("inner-sub".to_string()),
                    model: Some("claude-haiku-4.5".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-9",
                "2026-05-01T12:00:08.000Z",
                Some("evt-8"),
            ),
            // Complete inner, then outer
            make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("inner-sub".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                }),
                "evt-10",
                "2026-05-01T12:00:09.000Z",
                Some("evt-7"),
            ),
            make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("outer-sub".to_string()),
                    agent_name: Some("general-purpose".to_string()),
                    agent_display_name: Some("General Purpose Agent".to_string()),
                }),
                "evt-11",
                "2026-05-01T12:00:10.000Z",
                Some("evt-4"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);

        // Inner subagent should get its model from the leaf tool call
        let inner = turns[0]
            .tool_calls
            .iter()
            .find(|tc| tc.tool_call_id.as_deref() == Some("inner-sub"))
            .expect("inner-sub not found");
        assert!(inner.is_subagent);
        assert_eq!(
            inner.model.as_deref(),
            Some("claude-haiku-4.5"),
            "inner subagent model should come from its leaf child"
        );

        // Outer subagent should get its model from the inner subagent (after inner was resolved)
        let outer = turns[0]
            .tool_calls
            .iter()
            .find(|tc| tc.tool_call_id.as_deref() == Some("outer-sub"))
            .expect("outer-sub not found");
        assert!(outer.is_subagent);
        assert_eq!(
            outer.model.as_deref(),
            Some("claude-haiku-4.5"),
            "outer subagent model should propagate from inner subagent's resolved model"
        );
    }

    // === New tests for TurnReconstructor improvements ===

    #[test]
    fn abort_event_finalizes_current_turn() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Do something".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-1",
                "2025-01-01T00:00:00Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "ev-2",
                "2025-01-01T00:00:01Z",
                None,
            ),
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
        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1, "abort should finalize the current turn");
        assert!(
            !turns[0].is_complete,
            "aborted turn should be marked incomplete"
        );
    }

    #[test]
    fn session_model_change_sets_turn_model() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-1",
                "2025-01-01T00:00:00Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "ev-2",
                "2025-01-01T00:00:01Z",
                None,
            ),
            make_event(
                SessionEventType::SessionModelChange,
                TypedEventData::ModelChange(ModelChangeData {
                    previous_model: None,
                    new_model: Some("claude-sonnet-4".to_string()),
                    previous_reasoning_effort: None,
                    reasoning_effort: None,
                }),
                "ev-3",
                "2025-01-01T00:00:02Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "ev-4",
                "2025-01-01T00:00:03Z",
                None,
            ),
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
                }),
                "ev-start",
                "2025-01-01T00:00:00Z",
                None,
            ),
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-1",
                "2025-01-01T00:00:01Z",
                None,
            ),
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
                    event_count: None,
                    reasoning_effort: None,
                    context: None,
                    already_in_use: None,
                }),
                "ev-resume",
                "2025-01-01T00:00:00Z",
                None,
            ),
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello again".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-2".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-2",
                "2025-01-01T00:00:01Z",
                None,
            ),
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
                }),
                "ev-start",
                "2025-01-01T00:00:00Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "ev-1",
                "2025-01-01T00:00:01Z",
                None,
            ),
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
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-1",
                "2025-01-01T00:00:00Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "ev-2",
                "2025-01-01T00:00:01Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-1".to_string()),
                    tool_name: Some("read_file".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-2b",
                "2025-01-01T00:00:01Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-1".to_string()),
                    parent_tool_call_id: None,
                    model: Some("gpt-4o".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "ev-3",
                "2025-01-01T00:00:02Z",
                None,
            ),
            make_event(
                SessionEventType::SessionModelChange,
                TypedEventData::ModelChange(ModelChangeData {
                    previous_model: Some("gpt-4o".to_string()),
                    new_model: Some("claude-sonnet-4".to_string()),
                    previous_reasoning_effort: None,
                    reasoning_effort: None,
                }),
                "ev-4",
                "2025-01-01T00:00:03Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "ev-5",
                "2025-01-01T00:00:04Z",
                None,
            ),
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
    fn duplicate_tool_execution_start_is_deduplicated() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Do work".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-1",
                "2025-01-01T00:00:00Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "ev-2",
                "2025-01-01T00:00:01Z",
                None,
            ),
            // First ToolExecutionStart
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-dup".to_string()),
                    tool_name: Some("read_file".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-3",
                "2025-01-01T00:00:02Z",
                None,
            ),
            // Duplicate ToolExecutionStart with same ID
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-dup".to_string()),
                    tool_name: Some("read_file".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-3-dup",
                "2025-01-01T00:00:02Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-dup".to_string()),
                    parent_tool_call_id: None,
                    model: None,
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "ev-4",
                "2025-01-01T00:00:03Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "ev-5",
                "2025-01-01T00:00:04Z",
                None,
            ),
        ];
        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        assert_eq!(
            turns[0].tool_calls.len(),
            1,
            "duplicate ToolExecutionStart should be deduplicated"
        );
    }

    #[test]
    fn subagent_failed_records_error() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Do work".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-1",
                "2025-01-01T00:00:00Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "ev-2",
                "2025-01-01T00:00:01Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("sub-1".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-3",
                "2025-01-01T00:00:02Z",
                None,
            ),
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("sub-1".to_string()),
                    agent_name: Some("task".to_string()),
                    agent_display_name: None,
                    agent_description: None,
                }),
                "ev-4",
                "2025-01-01T00:00:03Z",
                None,
            ),
            make_event(
                SessionEventType::SubagentFailed,
                TypedEventData::SubagentFailed(SubagentFailedData {
                    tool_call_id: Some("sub-1".to_string()),
                    agent_name: None,
                    agent_display_name: None,
                    error: Some("timeout".to_string()),
                }),
                "ev-5",
                "2025-01-01T00:00:04Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "ev-6",
                "2025-01-01T00:00:05Z",
                None,
            ),
        ];
        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        let tc = &turns[0].tool_calls[0];
        assert!(tc.is_subagent);
        assert_eq!(tc.success, Some(false), "failed subagent should be marked unsuccessful");
        assert_eq!(tc.error.as_deref(), Some("timeout"));
    }

    #[test]
    fn repro_enrich_subagent_bug() {
        // Scenario: ToolExecComplete arrives BEFORE SubagentStarted, with NO SubagentCompleted.
        // enrich_subagent() correctly resets is_complete=false when SubagentStarted arrives.
        // However, the finalization sweep then infers completion from completed_at (set by
        // ToolExecComplete) — this is correct behavior for truncated/interrupted sessions.
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Launch".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T10:00:00.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T10:00:00.100Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-bug".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "evt-3",
                "2026-03-10T10:00:01.000Z",
                Some("evt-2"),
            ),
            // Tool completes before we learn it's a subagent
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-bug".to_string()),
                    parent_tool_call_id: None,
                    model: None,
                    interaction_id: Some("int-1".to_string()),
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "evt-4",
                "2026-03-10T10:00:01.100Z",
                Some("evt-3"),
            ),
            // Then we learn it's a subagent (but SubagentCompleted never arrives)
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("tc-bug".to_string()),
                    agent_name: Some("task".to_string()),
                    agent_display_name: Some("Task Agent".to_string()),
                    agent_description: None,
                }),
                "evt-5",
                "2026-03-10T10:00:01.200Z",
                Some("evt-4"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        let tc = &turns[0].tool_calls[0];

        assert!(tc.is_subagent, "Should be recognized as a subagent");
        // enrich_subagent() clears the early completed_at from ToolExecComplete because it
        // predates SubagentStarted and doesn't reflect the subagent's actual end time.
        // Without SubagentCompleted, the subagent should remain incomplete.
        assert!(
            !tc.is_complete,
            "Should NOT be marked complete — ToolExecComplete timestamp predates SubagentStarted \
             and no SubagentCompleted was received"
        );
        assert!(
            tc.completed_at.is_none(),
            "completed_at should be cleared since the early timestamp doesn't reflect subagent end"
        );
    }

    #[test]
    fn session_model_change_persists_across_turns() {
        // Model change between turns should be inherited by the next turn
        let events = vec![
            make_event(
                SessionEventType::SessionModelChange,
                TypedEventData::ModelChange(ModelChangeData {
                    previous_model: None,
                    new_model: Some("claude-sonnet-4".to_string()),
                    previous_reasoning_effort: None,
                    reasoning_effort: None,
                }),
                "ev-0",
                "2025-01-01T00:00:00Z",
                None,
            ),
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-1",
                "2025-01-01T00:00:01Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "ev-2",
                "2025-01-01T00:00:02Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "ev-3",
                "2025-01-01T00:00:03Z",
                None,
            ),
        ];
        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        assert_eq!(
            turns[0].model.as_deref(),
            Some("claude-sonnet-4"),
            "turn should inherit session_model from prior model change"
        );
    }

    #[test]
    fn attributed_messages_preserve_parent_tool_call_id() {
        // Setup: main agent message + subagent message in same turn
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Do a thing".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: None,
                    source: None,
                    agent_mode: None,
                }),
                "e1", "2026-01-01T00:00:00Z", None,
            ),
            // Main agent message (no parent)
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: None,
                    content: Some("I'll handle this.".to_string()),
                    interaction_id: None,
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "e2", "2026-01-01T00:00:01Z", None,
            ),
            // Subagent tool start
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-sub-1".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: Some(json!({"prompt": "explore"})),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "e3", "2026-01-01T00:00:02Z", None,
            ),
            // Subagent started
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("tc-sub-1".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                    agent_description: Some("Explores the codebase".to_string()),
                }),
                "e4", "2026-01-01T00:00:02Z", None,
            ),
            // Subagent's message (has parent_tool_call_id)
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: None,
                    content: Some("Found the relevant files.".to_string()),
                    interaction_id: None,
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: Some("tc-sub-1".to_string()),
                    reasoning_text: Some("Let me search for this...".to_string()),
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "e5", "2026-01-01T00:00:03Z", None,
            ),
            // Subagent completed
            make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("tc-sub-1".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                }),
                "e6", "2026-01-01T00:00:04Z", None,
            ),
            // Main agent final message
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: None,
                    content: Some("All done!".to_string()),
                    interaction_id: None,
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "e7", "2026-01-01T00:00:05Z", None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "e8", "2026-01-01T00:00:06Z", None,
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        let turn = &turns[0];

        // 3 messages total: 2 from main agent, 1 from subagent
        assert_eq!(turn.assistant_messages.len(), 3);

        // First message: main agent (no parent)
        assert_eq!(turn.assistant_messages[0].content, "I'll handle this.");
        assert!(turn.assistant_messages[0].parent_tool_call_id.is_none());
        assert!(turn.assistant_messages[0].agent_display_name.is_none());

        // Second message: subagent
        assert_eq!(turn.assistant_messages[1].content, "Found the relevant files.");
        assert_eq!(
            turn.assistant_messages[1].parent_tool_call_id.as_deref(),
            Some("tc-sub-1")
        );
        assert_eq!(
            turn.assistant_messages[1].agent_display_name.as_deref(),
            Some("Explore Agent")
        );

        // Third message: main agent (no parent)
        assert_eq!(turn.assistant_messages[2].content, "All done!");
        assert!(turn.assistant_messages[2].parent_tool_call_id.is_none());

        // Reasoning: 1 block from subagent
        assert_eq!(turn.reasoning_texts.len(), 1);
        assert_eq!(turn.reasoning_texts[0].content, "Let me search for this...");
        assert_eq!(
            turn.reasoning_texts[0].parent_tool_call_id.as_deref(),
            Some("tc-sub-1")
        );
        assert_eq!(
            turn.reasoning_texts[0].agent_display_name.as_deref(),
            Some("Explore Agent")
        );
    }

    #[test]
    fn messages_without_subagents_have_none_parent() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: None,
                    source: None,
                    agent_mode: None,
                }),
                "e1", "2026-01-01T00:00:00Z", None,
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: None,
                    content: Some("World".to_string()),
                    interaction_id: None,
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: Some("thinking...".to_string()),
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "e2", "2026-01-01T00:00:01Z", None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData { turn_id: None }),
                "e3", "2026-01-01T00:00:02Z", None,
            ),
        ];

        let turns = reconstruct_turns(&events);
        let turn = &turns[0];

        assert_eq!(turn.assistant_messages.len(), 1);
        assert!(turn.assistant_messages[0].parent_tool_call_id.is_none());
        assert!(turn.assistant_messages[0].agent_display_name.is_none());

        assert_eq!(turn.reasoning_texts.len(), 1);
        assert!(turn.reasoning_texts[0].parent_tool_call_id.is_none());
        assert!(turn.reasoning_texts[0].agent_display_name.is_none());
    }

    // =========================================================================
    // Subagent completion detection — regression tests for the ordering bug
    // where ToolExecComplete arriving after SubagentCompleted would reverse
    // the completion state (is_complete = !is_subagent → false).
    // =========================================================================

    /// Helper: build a standard subagent event sequence with configurable ordering.
    /// Returns the tool call from the reconstructed turn for assertion.
    fn run_subagent_scenario(events: Vec<TypedEvent>) -> TurnToolCall {
        let turns = reconstruct_turns(&events);
        assert!(!turns.is_empty(), "Expected at least one turn");
        let subagent = turns[0]
            .tool_calls
            .iter()
            .find(|tc| tc.is_subagent)
            .expect("Expected a subagent tool call");
        subagent.clone()
    }

    fn base_subagent_events() -> (TypedEvent, TypedEvent, TypedEvent, TypedEvent) {
        let user_msg = make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Do something".to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: Some("int-1".to_string()),
                source: None,
                agent_mode: None,
            }),
            "evt-1",
            "2026-03-18T00:00:00.000Z",
            None,
        );
        let turn_start = make_event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("turn-1".to_string()),
                interaction_id: Some("int-1".to_string()),
            }),
            "evt-2",
            "2026-03-18T00:00:00.100Z",
            Some("evt-1"),
        );
        let tool_start = make_event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("tc-sub".to_string()),
                tool_name: Some("task".to_string()),
                arguments: Some(json!({"agent_type": "explore", "prompt": "Find files"})),
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
            "evt-3",
            "2026-03-18T00:00:01.000Z",
            Some("evt-2"),
        );
        let sub_started = make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("tc-sub".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                agent_description: Some("Explores the codebase".to_string()),
            }),
            "evt-4",
            "2026-03-18T00:00:01.100Z",
            Some("evt-3"),
        );
        (user_msg, turn_start, tool_start, sub_started)
    }

    fn sub_completed_event(ts: &str, evt_id: &str) -> TypedEvent {
        make_event(
            SessionEventType::SubagentCompleted,
            TypedEventData::SubagentCompleted(SubagentCompletedData {
                tool_call_id: Some("tc-sub".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
            }),
            evt_id,
            ts,
            Some("evt-4"),
        )
    }

    fn sub_failed_event(ts: &str, evt_id: &str, error: &str) -> TypedEvent {
        make_event(
            SessionEventType::SubagentFailed,
            TypedEventData::SubagentFailed(SubagentFailedData {
                tool_call_id: Some("tc-sub".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                error: Some(error.to_string()),
            }),
            evt_id,
            ts,
            Some("evt-4"),
        )
    }

    fn tool_complete_event(ts: &str, evt_id: &str, success: Option<bool>) -> TypedEvent {
        make_event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("tc-sub".to_string()),
                parent_tool_call_id: None,
                model: Some("claude-opus-4.6".to_string()),
                interaction_id: Some("int-1".to_string()),
                success,
                result: Some(json!("Agent completed successfully")),
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
            evt_id,
            ts,
            Some("evt-3"),
        )
    }

    fn turn_end_event(ts: &str, evt_id: &str) -> TypedEvent {
        make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData {
                turn_id: Some("turn-1".to_string()),
            }),
            evt_id,
            ts,
            Some("evt-2"),
        )
    }

    #[test]
    fn subagent_completion_normal_order() {
        // Normal order: Start → SubStarted → SubCompleted → ToolExecComplete → TurnEnd
        // This is THE bug scenario — ToolExecComplete must NOT reverse SubagentCompleted.
        let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
        let events = vec![
            user_msg,
            turn_start,
            tool_start,
            sub_started,
            sub_completed_event("2026-03-18T00:00:05.000Z", "evt-5"),
            tool_complete_event("2026-03-18T00:00:05.100Z", "evt-6", Some(true)),
            turn_end_event("2026-03-18T00:00:05.200Z", "evt-7"),
        ];

        let tc = run_subagent_scenario(events);
        assert!(tc.is_subagent, "Should be marked as subagent");
        assert!(tc.is_complete, "Subagent should be complete (SubagentCompleted arrived)");
        assert_eq!(tc.success, Some(true), "Should be successful");
        assert!(tc.completed_at.is_some(), "Should have completed_at timestamp");
        assert!(tc.duration_ms.is_some(), "Should have duration");
    }

    #[test]
    fn subagent_completion_reverse_order() {
        // Reverse order: Start → SubStarted → ToolExecComplete → SubCompleted → TurnEnd
        let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
        let events = vec![
            user_msg,
            turn_start,
            tool_start,
            sub_started,
            tool_complete_event("2026-03-18T00:00:05.000Z", "evt-5", Some(true)),
            sub_completed_event("2026-03-18T00:00:05.100Z", "evt-6"),
            turn_end_event("2026-03-18T00:00:05.200Z", "evt-7"),
        ];

        let tc = run_subagent_scenario(events);
        assert!(tc.is_subagent);
        assert!(tc.is_complete, "Subagent should be complete (SubagentCompleted arrived)");
        assert_eq!(tc.success, Some(true));
    }

    #[test]
    fn subagent_completion_tool_exec_between_sub_events() {
        // Mid order: Start → SubStarted → ToolExecComplete (no SubCompleted yet) → SubCompleted
        // ToolExecComplete should NOT mark subagent complete; SubCompleted does.
        let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
        let events = vec![
            user_msg,
            turn_start,
            tool_start,
            sub_started,
            tool_complete_event("2026-03-18T00:00:04.000Z", "evt-5", Some(true)),
            sub_completed_event("2026-03-18T00:00:05.000Z", "evt-6"),
            turn_end_event("2026-03-18T00:00:05.200Z", "evt-7"),
        ];

        let tc = run_subagent_scenario(events);
        assert!(tc.is_complete, "Should be complete after SubagentCompleted");
        assert_eq!(tc.success, Some(true));
    }

    #[test]
    fn subagent_failed_with_late_tool_exec_complete() {
        // SubagentFailed sets success=false, then ToolExecComplete arrives with success=true.
        // The failure state must be preserved (SubagentFailed has authority).
        let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
        let events = vec![
            user_msg,
            turn_start,
            tool_start,
            sub_started,
            sub_failed_event("2026-03-18T00:00:05.000Z", "evt-5", "Agent crashed"),
            tool_complete_event("2026-03-18T00:00:05.100Z", "evt-6", Some(true)),
            turn_end_event("2026-03-18T00:00:05.200Z", "evt-7"),
        ];

        let tc = run_subagent_scenario(events);
        assert!(tc.is_subagent);
        assert!(tc.is_complete, "Should be complete (SubagentFailed arrived)");
        assert_eq!(tc.success, Some(false), "Failure must be preserved despite ToolExecComplete success=true");
        assert_eq!(tc.error.as_deref(), Some("Agent crashed"), "Error message must be preserved");
    }

    #[test]
    fn subagent_missing_lifecycle_events_stays_incomplete() {
        // Truncated trace: SubagentStarted + ToolExecComplete, but NO SubagentCompleted.
        // Since ToolExecComplete no longer sets completed_at/duration_ms for subagents,
        // the finalization sweep has no completed_at to work with, so the subagent
        // correctly remains incomplete (showing as "in-progress" in the UI).
        let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
        let events = vec![
            user_msg,
            turn_start,
            tool_start,
            sub_started,
            // No SubagentCompleted event!
            tool_complete_event("2026-03-18T00:00:05.000Z", "evt-5", Some(true)),
            turn_end_event("2026-03-18T00:00:05.200Z", "evt-6"),
        ];

        let tc = run_subagent_scenario(events);
        assert!(tc.is_subagent);
        assert!(
            !tc.is_complete,
            "Subagent should remain incomplete when only ToolExecComplete arrived (no SubagentCompleted)"
        );
        assert!(
            tc.completed_at.is_none(),
            "completed_at should be None — ToolExecComplete must not set it for subagents"
        );
    }

    #[test]
    fn subagent_tool_exec_before_subagent_started_then_completed() {
        // Out-of-order: ToolExecComplete before SubagentStarted, then SubagentCompleted.
        // enrich_subagent() resets is_complete; SubagentCompleted then sets it.
        let (user_msg, turn_start, tool_start, _sub_started) = base_subagent_events();
        let sub_started_late = make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("tc-sub".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                agent_description: Some("Explores the codebase".to_string()),
            }),
            "evt-5",
            "2026-03-18T00:00:02.000Z",
            Some("evt-3"),
        );
        let events = vec![
            user_msg,
            turn_start,
            tool_start,
            // ToolExecComplete arrives BEFORE SubagentStarted
            tool_complete_event("2026-03-18T00:00:01.500Z", "evt-4", Some(true)),
            sub_started_late,
            sub_completed_event("2026-03-18T00:00:05.000Z", "evt-6"),
            turn_end_event("2026-03-18T00:00:05.200Z", "evt-7"),
        ];

        let tc = run_subagent_scenario(events);
        assert!(tc.is_subagent);
        assert!(tc.is_complete, "SubagentCompleted should finalize even after out-of-order events");
        assert_eq!(tc.success, Some(true));
    }

    #[test]
    fn subagent_no_tool_exec_complete_only_lifecycle() {
        // Edge case: SubagentStarted + SubagentCompleted but NO ToolExecComplete.
        // Should still be marked complete.
        let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
        let events = vec![
            user_msg,
            turn_start,
            tool_start,
            sub_started,
            sub_completed_event("2026-03-18T00:00:05.000Z", "evt-5"),
            turn_end_event("2026-03-18T00:00:05.200Z", "evt-6"),
        ];

        let tc = run_subagent_scenario(events);
        assert!(tc.is_subagent);
        assert!(tc.is_complete, "SubagentCompleted alone should mark complete");
        assert_eq!(tc.success, Some(true));
    }

    #[test]
    fn subagent_tool_exec_before_subagent_started_no_completion_stays_incomplete() {
        // Regression test: ToolExecComplete arrives before SubagentStarted, and there
        // is NO SubagentCompleted event. Without the fix, finalize_subagent_completion()
        // would see the completed_at from ToolExecComplete and prematurely mark the
        // subagent as complete with a very short (incorrect) duration.
        let (user_msg, turn_start, tool_start, _sub_started) = base_subagent_events();
        let sub_started_late = make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("tc-sub".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                agent_description: Some("Explores the codebase".to_string()),
            }),
            "evt-5",
            "2026-03-18T00:00:02.000Z",
            Some("evt-3"),
        );
        let events = vec![
            user_msg,
            turn_start,
            tool_start,
            // ToolExecComplete arrives BEFORE SubagentStarted
            tool_complete_event("2026-03-18T00:00:01.500Z", "evt-4", Some(true)),
            sub_started_late,
            // No SubagentCompleted — subagent may still be running
            turn_end_event("2026-03-18T00:00:02.200Z", "evt-6"),
        ];

        let tc = run_subagent_scenario(events);
        assert!(tc.is_subagent);
        assert!(
            !tc.is_complete,
            "Subagent should NOT be marked complete when only ToolExecComplete arrived \
             before SubagentStarted and no SubagentCompleted was received"
        );
        assert!(
            tc.completed_at.is_none(),
            "completed_at should be cleared by enrich_subagent() since ToolExecComplete \
             timestamp predates SubagentStarted and doesn't reflect real subagent end"
        );
    }

    #[test]
    fn subagent_tool_exec_before_subagent_started_then_tool_exec_after() {
        // ToolExecComplete fires twice-ish scenario: first early (before SubagentStarted),
        // then the actual ToolExecComplete fires after the subagent work is done.
        // The second ToolExecComplete should set completed_at correctly.
        let (user_msg, turn_start, tool_start, _sub_started) = base_subagent_events();
        let sub_started_late = make_event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("tc-sub".to_string()),
                agent_name: Some("explore".to_string()),
                agent_display_name: Some("Explore Agent".to_string()),
                agent_description: Some("Explores the codebase".to_string()),
            }),
            "evt-5",
            "2026-03-18T00:00:02.000Z",
            Some("evt-3"),
        );
        let events = vec![
            user_msg,
            turn_start,
            tool_start,
            // Early ToolExecComplete (before SubagentStarted)
            tool_complete_event("2026-03-18T00:00:01.500Z", "evt-4", Some(true)),
            sub_started_late,
            // SubagentCompleted arrives with correct timestamp
            sub_completed_event("2026-03-18T00:00:10.000Z", "evt-6"),
            // Late ToolExecComplete with even later timestamp
            tool_complete_event("2026-03-18T00:00:10.100Z", "evt-7", Some(true)),
            turn_end_event("2026-03-18T00:00:10.200Z", "evt-8"),
        ];

        let tc = run_subagent_scenario(events);
        assert!(tc.is_subagent);
        assert!(tc.is_complete);
        assert_eq!(tc.success, Some(true));
        // Duration should be ~9.1s (T=10.1 - T=1.0), not ~0.5s (T=1.5 - T=1.0)
        let dur = tc.duration_ms.expect("Should have duration");
        assert!(
            dur > 8000,
            "Duration should reflect the full subagent run (>8s), not the early ToolExecComplete. Got: {}ms",
            dur
        );
    }


    #[test]
    fn subagent_started_then_tool_exec_complete_no_sub_completed_stays_incomplete() {
        // THE critical regression scenario: normal event ordering where SubagentStarted
        // arrives first, then ToolExecComplete fires, but SubagentCompleted never arrives
        // (session still running or truncated).
        //
        // Previously, ToolExecComplete would set completed_at/duration_ms even for subagents,
        // and finalize_subagent_completion() would then mark it complete with a very short
        // duration (the ToolExecStart->ToolExecComplete gap, not actual subagent runtime).
        //
        // With the fix, ToolExecComplete no longer sets completed_at/duration_ms for
        // subagents, so the subagent correctly remains in-progress.
        let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
        let events = vec![
            user_msg,
            turn_start,
            tool_start,                                                          // T=1.0s
            sub_started,                                                         // T=1.05s
            tool_complete_event("2026-03-18T00:00:01.100Z", "evt-5", Some(true)), // T=1.1s
            // No SubagentCompleted -- subagent is still running
            turn_end_event("2026-03-18T00:00:01.200Z", "evt-6"),
        ];

        let tc = run_subagent_scenario(events);
        assert!(tc.is_subagent, "Should be marked as subagent");
        assert!(
            !tc.is_complete,
            "Subagent should NOT be marked complete when SubagentCompleted never arrived. \
             ToolExecComplete should not finalize subagents."
        );
        assert!(
            tc.completed_at.is_none(),
            "completed_at should be None -- ToolExecComplete must not set it for subagents"
        );
        assert!(
            tc.duration_ms.is_none(),
            "duration_ms should be None -- subagent is still running"
        );
    }
    #[test]
    fn subagent_completed_before_subagent_started_preserves_terminal_state() {
        // Out-of-order edge case: SubagentCompleted arrives before SubagentStarted.
        // enrich_subagent() must NOT wipe the terminal state already set by
        // handle_subagent_terminal().
        let (user_msg, turn_start, tool_start, sub_started) = base_subagent_events();
        let events = vec![
            user_msg,
            turn_start,
            tool_start,                                                     // T=1.0s
            // SubagentCompleted arrives BEFORE SubagentStarted
            sub_completed_event("2026-03-18T00:00:05.000Z", "evt-4"),       // T=5.0s
            sub_started,                                                     // T=1.05s
            turn_end_event("2026-03-18T00:00:05.200Z", "evt-6"),
        ];

        let tc = run_subagent_scenario(events);
        assert!(tc.is_subagent, "Should be marked as subagent");
        assert!(
            tc.is_complete,
            "SubagentCompleted terminal state must be preserved even when SubagentStarted arrives later"
        );
        assert_eq!(tc.success, Some(true));
        assert!(
            tc.completed_at.is_some(),
            "completed_at from SubagentCompleted must be preserved"
        );
        assert!(
            tc.duration_ms.is_some(),
            "duration_ms from SubagentCompleted must be preserved"
        );
    }

    #[test]
    fn assistant_reasoning_appends_to_turn() {
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Think about this".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-1".to_string()),
                    interaction_id: Some("int-1".to_string()),
                }),
                "evt-2",
                "2026-03-10T07:14:51.100Z",
                Some("evt-1"),
            ),
            make_event(
                SessionEventType::AssistantReasoning,
                TypedEventData::AssistantReasoning(AssistantReasoningData {
                    reasoning_id: Some("reason-1".to_string()),
                    content: Some("Let me think step by step...".to_string()),
                }),
                "evt-3",
                "2026-03-10T07:14:51.200Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::AssistantReasoning,
                TypedEventData::AssistantReasoning(AssistantReasoningData {
                    reasoning_id: Some("reason-2".to_string()),
                    content: Some("The answer is 42".to_string()),
                }),
                "evt-4",
                "2026-03-10T07:14:51.300Z",
                Some("evt-2"),
            ),
            // Empty reasoning should be skipped
            make_event(
                SessionEventType::AssistantReasoning,
                TypedEventData::AssistantReasoning(AssistantReasoningData {
                    reasoning_id: Some("reason-3".to_string()),
                    content: Some("   ".to_string()),
                }),
                "evt-5",
                "2026-03-10T07:14:51.400Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: Some("msg-1".to_string()),
                    content: Some("The answer is 42.".to_string()),
                    interaction_id: Some("int-1".to_string()),
                    tool_requests: None,
                    output_tokens: None,
                    parent_tool_call_id: None,
                    reasoning_text: None,
                    reasoning_opaque: None,
                    encrypted_content: None,
                    phase: None,
                }),
                "evt-6",
                "2026-03-10T07:14:52.000Z",
                Some("evt-2"),
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "evt-7",
                "2026-03-10T07:14:53.000Z",
                Some("evt-2"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        let turn = &turns[0];

        // Two non-empty reasoning blocks should be collected
        assert_eq!(turn.reasoning_texts.len(), 2);
        assert_eq!(turn.reasoning_texts[0].content, "Let me think step by step...");
        assert_eq!(turn.reasoning_texts[1].content, "The answer is 42");

        // AssistantReasoning has no parent_tool_call_id
        assert!(turn.reasoning_texts[0].parent_tool_call_id.is_none());

        // The assistant message should still be there
        assert_eq!(msg_contents(&turn.assistant_messages), vec!["The answer is 42."]);
    }

    #[test]
    fn assistant_reasoning_without_prior_turn_creates_turn() {
        // Reasoning event arrives before any UserMessage — should auto-create a turn
        let events = vec![
            make_event(
                SessionEventType::AssistantReasoning,
                TypedEventData::AssistantReasoning(AssistantReasoningData {
                    reasoning_id: Some("reason-1".to_string()),
                    content: Some("Thinking...".to_string()),
                }),
                "evt-1",
                "2026-03-10T07:14:51.000Z",
                None,
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].reasoning_texts.len(), 1);
        assert_eq!(turns[0].reasoning_texts[0].content, "Thinking...");
    }

    // ── Session event embedding tests ─────────────────────────────────

    /// Helper: wrap a full turn around session events for testing.
    fn make_turn_events(
        session_events: Vec<TypedEvent>,
    ) -> Vec<TypedEvent> {
        let mut events = vec![make_event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some("Hello".to_string()),
                transformed_content: None,
                interaction_id: Some("int-1".to_string()),
                attachments: None,
                source: None,
                agent_mode: None,
            }),
            "evt-user",
            "2026-03-10T07:00:00.000Z",
            None,
        )];
        events.extend(session_events);
        events.push(make_event(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData { turn_id: None }),
            "evt-end",
            "2026-03-10T07:01:00.000Z",
            None,
        ));
        events
    }

    #[test]
    fn session_error_embedded_in_turn() {
        let events = make_turn_events(vec![make_event(
            SessionEventType::SessionError,
            TypedEventData::SessionError(SessionErrorData {
                error_type: Some("rate_limit".to_string()),
                message: Some("Rate limit exceeded".to_string()),
                stack: None,
                status_code: Some(429),
                provider_call_id: None,
                url: None,
            }),
            "evt-err",
            "2026-03-10T07:00:30.000Z",
            None,
        )]);

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
        let events = make_turn_events(vec![make_event(
            SessionEventType::SessionError,
            TypedEventData::SessionError(SessionErrorData {
                error_type: Some("connection_timeout".to_string()),
                message: None,
                stack: None,
                status_code: None,
                provider_call_id: None,
                url: None,
            }),
            "evt-err",
            "2026-03-10T07:00:30.000Z",
            None,
        )]);

        let turns = reconstruct_turns(&events);
        assert_eq!(turns[0].session_events[0].summary, "connection_timeout");
    }

    #[test]
    fn session_error_fallback_to_status_code() {
        let events = make_turn_events(vec![make_event(
            SessionEventType::SessionError,
            TypedEventData::SessionError(SessionErrorData {
                error_type: None,
                message: None,
                stack: None,
                status_code: Some(500),
                provider_call_id: None,
                url: None,
            }),
            "evt-err",
            "2026-03-10T07:00:30.000Z",
            None,
        )]);

        let turns = reconstruct_turns(&events);
        assert_eq!(turns[0].session_events[0].summary, "HTTP 500");
    }

    #[test]
    fn session_error_fallback_to_default() {
        let events = make_turn_events(vec![make_event(
            SessionEventType::SessionError,
            TypedEventData::SessionError(SessionErrorData {
                error_type: None,
                message: None,
                stack: None,
                status_code: None,
                provider_call_id: None,
                url: None,
            }),
            "evt-err",
            "2026-03-10T07:00:30.000Z",
            None,
        )]);

        let turns = reconstruct_turns(&events);
        assert_eq!(turns[0].session_events[0].summary, "Session error");
    }

    #[test]
    fn session_warning_embedded_in_turn() {
        let events = make_turn_events(vec![make_event(
            SessionEventType::SessionWarning,
            TypedEventData::SessionWarning(SessionWarningData {
                warning_type: Some("token_budget".to_string()),
                message: Some("Approaching token limit".to_string()),
                url: None,
            }),
            "evt-warn",
            "2026-03-10T07:00:30.000Z",
            None,
        )]);

        let turns = reconstruct_turns(&events);
        assert_eq!(turns[0].session_events.len(), 1);
        let se = &turns[0].session_events[0];
        assert_eq!(se.event_type, "session.warning");
        assert_eq!(se.severity, SessionEventSeverity::Warning);
        assert_eq!(se.summary, "Approaching token limit");
    }

    #[test]
    fn compaction_start_embedded_in_turn() {
        let events = make_turn_events(vec![make_event(
            SessionEventType::SessionCompactionStart,
            TypedEventData::CompactionStart(CompactionStartData {}),
            "evt-comp-start",
            "2026-03-10T07:00:30.000Z",
            None,
        )]);

        let turns = reconstruct_turns(&events);
        assert_eq!(turns[0].session_events.len(), 1);
        let se = &turns[0].session_events[0];
        assert_eq!(se.event_type, "session.compaction_start");
        assert_eq!(se.severity, SessionEventSeverity::Info);
        assert_eq!(se.summary, "Context compaction started");
    }

    #[test]
    fn compaction_complete_success() {
        let events = make_turn_events(vec![make_event(
            SessionEventType::SessionCompactionComplete,
            TypedEventData::CompactionComplete(CompactionCompleteData {
                success: Some(true),
                error: None,
                pre_compaction_tokens: Some(50000),
                pre_compaction_messages_length: Some(120),
                summary_content: None,
                checkpoint_number: None,
                checkpoint_path: None,
                compaction_tokens_used: None,
                request_id: None,
            }),
            "evt-comp",
            "2026-03-10T07:00:30.000Z",
            None,
        )]);

        let turns = reconstruct_turns(&events);
        let se = &turns[0].session_events[0];
        assert_eq!(se.event_type, "session.compaction_complete");
        assert_eq!(se.severity, SessionEventSeverity::Info);
        assert_eq!(se.summary, "Compaction complete (50000 tokens)");
    }

    #[test]
    fn compaction_complete_failure() {
        let events = make_turn_events(vec![make_event(
            SessionEventType::SessionCompactionComplete,
            TypedEventData::CompactionComplete(CompactionCompleteData {
                success: Some(false),
                error: Some("Out of memory".to_string()),
                pre_compaction_tokens: Some(50000),
                pre_compaction_messages_length: None,
                summary_content: None,
                checkpoint_number: None,
                checkpoint_path: None,
                compaction_tokens_used: None,
                request_id: None,
            }),
            "evt-comp",
            "2026-03-10T07:00:30.000Z",
            None,
        )]);

        let turns = reconstruct_turns(&events);
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
    fn multiple_session_events_in_single_turn() {
        let events = make_turn_events(vec![
            make_event(
                SessionEventType::SessionCompactionStart,
                TypedEventData::CompactionStart(CompactionStartData {}),
                "evt-cs",
                "2026-03-10T07:00:10.000Z",
                None,
            ),
            make_event(
                SessionEventType::SessionCompactionComplete,
                TypedEventData::CompactionComplete(CompactionCompleteData {
                    success: Some(true),
                    error: None,
                    pre_compaction_tokens: Some(40000),
                    pre_compaction_messages_length: None,
                    summary_content: None,
                    checkpoint_number: None,
                    checkpoint_path: None,
                    compaction_tokens_used: None,
                    request_id: None,
                }),
                "evt-cc",
                "2026-03-10T07:00:20.000Z",
                None,
            ),
            make_event(
                SessionEventType::SessionError,
                TypedEventData::SessionError(SessionErrorData {
                    error_type: None,
                    message: Some("API timeout".to_string()),
                    stack: None,
                    status_code: None,
                    provider_call_id: None,
                    url: None,
                }),
                "evt-err",
                "2026-03-10T07:00:30.000Z",
                None,
            ),
        ]);

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].session_events.len(), 3);
        assert_eq!(turns[0].session_events[0].event_type, "session.compaction_start");
        assert_eq!(turns[0].session_events[1].event_type, "session.compaction_complete");
        assert_eq!(turns[0].session_events[2].event_type, "session.error");
    }

    #[test]
    fn session_events_between_turns_attach_to_next_turn() {
        // Events that arrive between turns should be buffered and flushed into the next turn
        let events = vec![
            // Turn 1
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("First".to_string()),
                    transformed_content: None,
                    interaction_id: None,
                    attachments: None,
                    source: None,
                    agent_mode: None,
                }),
                "evt-u1",
                "2026-03-10T07:00:00.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData { turn_id: None }),
                "evt-te1",
                "2026-03-10T07:01:00.000Z",
                None,
            ),
            // Session events between turns (no current turn)
            make_event(
                SessionEventType::SessionError,
                TypedEventData::SessionError(SessionErrorData {
                    error_type: None,
                    message: Some("Connection lost".to_string()),
                    stack: None,
                    status_code: None,
                    provider_call_id: None,
                    url: None,
                }),
                "evt-err",
                "2026-03-10T07:01:30.000Z",
                None,
            ),
            make_event(
                SessionEventType::SessionWarning,
                TypedEventData::SessionWarning(SessionWarningData {
                    warning_type: None,
                    message: Some("Reconnecting".to_string()),
                    url: None,
                }),
                "evt-warn",
                "2026-03-10T07:01:45.000Z",
                None,
            ),
            // Turn 2 — buffered events should be flushed here
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Second".to_string()),
                    transformed_content: None,
                    interaction_id: None,
                    attachments: None,
                    source: None,
                    agent_mode: None,
                }),
                "evt-u2",
                "2026-03-10T07:02:00.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData { turn_id: None }),
                "evt-te2",
                "2026-03-10T07:03:00.000Z",
                None,
            ),
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
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Go".to_string()),
                    transformed_content: None,
                    interaction_id: None,
                    attachments: None,
                    source: None,
                    agent_mode: None,
                }),
                "evt-u1",
                "2026-03-10T07:00:00.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData { turn_id: None }),
                "evt-te1",
                "2026-03-10T07:01:00.000Z",
                None,
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].session_events.len(), 1);
        assert_eq!(turns[0].session_events[0].event_type, "session.mode_changed");
        assert_eq!(turns[0].session_events[0].summary, "Mode changed to plan");
    }

    #[test]
    fn trailing_session_events_attach_to_last_turn() {
        // Session events that arrive after the last TurnEnd should attach to the last turn
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    interaction_id: None,
                    attachments: None,
                    source: None,
                    agent_mode: None,
                }),
                "evt-u1",
                "2026-03-10T07:00:00.000Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData { turn_id: None }),
                "evt-te1",
                "2026-03-10T07:01:00.000Z",
                None,
            ),
            make_event(
                SessionEventType::SessionError,
                TypedEventData::SessionError(SessionErrorData {
                    error_type: None,
                    message: Some("Session crashed".to_string()),
                    stack: None,
                    status_code: None,
                    provider_call_id: None,
                    url: None,
                }),
                "evt-err",
                "2026-03-10T07:02:00.000Z",
                None,
            ),
        ];

        let turns = reconstruct_turns(&events);
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
        assert_eq!(deserialized.session_events[0].severity, SessionEventSeverity::Error);
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
        assert_eq!(turns[0].session_events[0].event_type, "session.mode_changed");
    }

    #[test]
    fn orphaned_session_events_create_synthetic_turn() {
        // A session with only session events (no UserMessage or other turn-creating events)
        // should produce a synthetic turn to hold them.
        let events = vec![
            make_event(
                SessionEventType::SessionError,
                TypedEventData::SessionError(SessionErrorData {
                    error_type: Some("auth_failed".to_string()),
                    message: Some("Authentication failed".to_string()),
                    stack: None,
                    status_code: Some(401),
                    provider_call_id: None,
                    url: None,
                }),
                "evt-err",
                "2026-03-10T07:00:00.000Z",
                None,
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        assert!(turns[0].user_message.is_none());
        assert_eq!(turns[0].session_events.len(), 1);
        assert_eq!(turns[0].session_events[0].summary, "Authentication failed");
    }

    #[test]
    fn compaction_error_with_success_none() {
        // When success is None but error is set, treat as failure
        let events = make_turn_events(vec![make_event(
            SessionEventType::SessionCompactionComplete,
            TypedEventData::CompactionComplete(CompactionCompleteData {
                success: None,
                error: Some("OOM".to_string()),
                pre_compaction_tokens: Some(50000),
                pre_compaction_messages_length: None,
                summary_content: None,
                checkpoint_number: None,
                checkpoint_path: None,
                compaction_tokens_used: None,
                request_id: None,
            }),
            "evt-comp",
            "2026-03-10T07:00:30.000Z",
            None,
        )]);

        let turns = reconstruct_turns(&events);
        let se = &turns[0].session_events[0];
        assert_eq!(se.severity, SessionEventSeverity::Warning);
        assert_eq!(se.summary, "Compaction failed: OOM");
    }

    // ── turn.model pollution from subagent child tool calls ───────────

    #[test]
    fn subagent_child_tool_does_not_set_turn_model() {
        // Scenario: main agent (claude) spawns a subagent (gemini) which runs
        // child tool calls. The child tool's ToolExecutionComplete carries the
        // subagent's model. turn.model should NOT be set to the subagent's model.
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-1",
                "2026-01-01T00:00:00Z",
                None,
            ),
            // Main agent tool call that spawns the subagent
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-subagent".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: Some(json!({ "prompt": "explore code", "model": "gemini-3-pro-preview" })),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-2",
                "2026-01-01T00:00:01Z",
                None,
            ),
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("tc-subagent".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                    agent_description: None,
                }),
                "ev-3",
                "2026-01-01T00:00:02Z",
                None,
            ),
            // Subagent's child tool call (grep under the subagent)
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-grep-1".to_string()),
                    tool_name: Some("grep".to_string()),
                    arguments: Some(json!({ "pattern": "foo" })),
                    parent_tool_call_id: Some("tc-subagent".to_string()),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-4",
                "2026-01-01T00:00:03Z",
                None,
            ),
            // Child tool completes WITH a model (the subagent's model)
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-grep-1".to_string()),
                    parent_tool_call_id: Some("tc-subagent".to_string()),
                    model: Some("gemini-3-pro-preview".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: Some(json!("match found")),
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "ev-5",
                "2026-01-01T00:00:04Z",
                None,
            ),
            make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("tc-subagent".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                }),
                "ev-6",
                "2026-01-01T00:00:05Z",
                None,
            ),
            // Main agent tool call completes (sets real model)
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-subagent".to_string()),
                    parent_tool_call_id: None,
                    model: Some("claude-sonnet-4".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "ev-7",
                "2026-01-01T00:00:06Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "ev-8",
                "2026-01-01T00:00:07Z",
                None,
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        // turn.model should NOT be gemini (the subagent's model)
        assert_ne!(
            turns[0].model.as_deref(),
            Some("gemini-3-pro-preview"),
            "turn.model must not be set from a subagent's child tool call"
        );
    }

    #[test]
    fn correct_turn_models_fixes_polluted_model_from_subagent_child() {
        // Scenario: SubagentStarted arrives AFTER its child tool call completes,
        // so the inline guard couldn't catch it. The post-processing step should
        // still correct the turn model.
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-1",
                "2026-01-01T00:00:00Z",
                None,
            ),
            // ToolExecStart for the subagent wrapper (before SubagentStarted)
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-subagent".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-2",
                "2026-01-01T00:00:01Z",
                None,
            ),
            // Subagent's child tool starts
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-child".to_string()),
                    tool_name: Some("grep".to_string()),
                    arguments: None,
                    parent_tool_call_id: Some("tc-subagent".to_string()),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-3",
                "2026-01-01T00:00:02Z",
                None,
            ),
            // Child tool completes — at this point, parent isn't yet marked as subagent!
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-child".to_string()),
                    parent_tool_call_id: Some("tc-subagent".to_string()),
                    model: Some("gemini-3-pro-preview".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "ev-4",
                "2026-01-01T00:00:03Z",
                None,
            ),
            // NOW SubagentStarted arrives — marks tc-subagent as subagent
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("tc-subagent".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                    agent_description: None,
                }),
                "ev-5",
                "2026-01-01T00:00:04Z",
                None,
            ),
            make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("tc-subagent".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                }),
                "ev-6",
                "2026-01-01T00:00:05Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "ev-7",
                "2026-01-01T00:00:06Z",
                None,
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        // Even though the inline guard couldn't catch it (parent wasn't subagent yet),
        // correct_turn_models() should have cleared the polluted model.
        assert_ne!(
            turns[0].model.as_deref(),
            Some("gemini-3-pro-preview"),
            "post-processing should correct turn.model polluted by out-of-order subagent events"
        );
    }

    #[test]
    fn correct_turn_models_preserves_main_agent_model() {
        // Scenario: main agent (claude) does its own tool calls AND has subagents.
        // turn.model should be the main agent's model, not a subagent's.
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Hello".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-1",
                "2026-01-01T00:00:00Z",
                None,
            ),
            // Main agent's own tool call
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-main".to_string()),
                    tool_name: Some("read_file".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-2",
                "2026-01-01T00:00:01Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-main".to_string()),
                    parent_tool_call_id: None,
                    model: Some("claude-sonnet-4".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "ev-3",
                "2026-01-01T00:00:02Z",
                None,
            ),
            // Subagent tool call
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-sub".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-4",
                "2026-01-01T00:00:03Z",
                None,
            ),
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("tc-sub".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                    agent_description: None,
                }),
                "ev-5",
                "2026-01-01T00:00:04Z",
                None,
            ),
            // Subagent child tool
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-sub-child".to_string()),
                    tool_name: Some("grep".to_string()),
                    arguments: None,
                    parent_tool_call_id: Some("tc-sub".to_string()),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-6",
                "2026-01-01T00:00:05Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-sub-child".to_string()),
                    parent_tool_call_id: Some("tc-sub".to_string()),
                    model: Some("gemini-3-pro-preview".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "ev-7",
                "2026-01-01T00:00:06Z",
                None,
            ),
            make_event(
                SessionEventType::SubagentCompleted,
                TypedEventData::SubagentCompleted(SubagentCompletedData {
                    tool_call_id: Some("tc-sub".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                }),
                "ev-8",
                "2026-01-01T00:00:07Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "ev-9",
                "2026-01-01T00:00:08Z",
                None,
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 1);
        assert_eq!(
            turns[0].model.as_deref(),
            Some("claude-sonnet-4"),
            "turn.model should be the main agent's model, not the subagent's"
        );
    }

    #[test]
    fn cross_turn_subagent_child_does_not_pollute_next_turn_model() {
        // Scenario: Turn 1 spawns a subagent. Turn 2 starts, and the subagent's
        // child tool calls land in Turn 2. Turn 2's model should not be the subagent's.
        let events = vec![
            // --- Turn 1: main agent spawns subagent ---
            make_event(
                SessionEventType::SessionModelChange,
                TypedEventData::ModelChange(ModelChangeData {
                    previous_model: None,
                    new_model: Some("claude-sonnet-4".to_string()),
                    previous_reasoning_effort: None,
                    reasoning_effort: None,
                }),
                "ev-0",
                "2026-01-01T00:00:00Z",
                None,
            ),
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Turn 1".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-1",
                "2026-01-01T00:00:01Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-subagent".to_string()),
                    tool_name: Some("task".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-2",
                "2026-01-01T00:00:02Z",
                None,
            ),
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("tc-subagent".to_string()),
                    agent_name: Some("explore".to_string()),
                    agent_display_name: Some("Explore Agent".to_string()),
                    agent_description: None,
                }),
                "ev-3",
                "2026-01-01T00:00:03Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-1".to_string()),
                }),
                "ev-4",
                "2026-01-01T00:00:04Z",
                None,
            ),
            // --- Turn 2: new user message, but subagent child events arrive here ---
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Turn 2".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-2".to_string()),
                    source: None,
                    agent_mode: None,
                }),
                "ev-5",
                "2026-01-01T00:00:05Z",
                None,
            ),
            // Subagent's child tool call lands in Turn 2
            make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tc-child".to_string()),
                    tool_name: Some("grep".to_string()),
                    arguments: None,
                    parent_tool_call_id: Some("tc-subagent".to_string()),
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                "ev-6",
                "2026-01-01T00:00:06Z",
                None,
            ),
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-child".to_string()),
                    parent_tool_call_id: Some("tc-subagent".to_string()),
                    model: Some("gemini-3-pro-preview".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                "ev-7",
                "2026-01-01T00:00:07Z",
                None,
            ),
            make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some("turn-2".to_string()),
                }),
                "ev-8",
                "2026-01-01T00:00:08Z",
                None,
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns.len(), 2);

        // Turn 1 should have claude model (from SessionModelChange)
        assert_eq!(
            turns[0].model.as_deref(),
            Some("claude-sonnet-4"),
            "Turn 1 model should be main agent's model"
        );

        // Turn 2 should inherit session model (claude), not the subagent's model (gemini)
        assert_eq!(
            turns[1].model.as_deref(),
            Some("claude-sonnet-4"),
            "Turn 2 model should not be polluted by cross-turn subagent child tool calls"
        );
    }

    // ── Performance measurement for subagent-heavy sessions ──────────

    /// Generate a session with the given number of turns, each with `subagents_per_turn`
    /// subagents and `tools_per_subagent` child tool calls per subagent.
    fn make_subagent_heavy_session(
        turn_count: usize,
        subagents_per_turn: usize,
        tools_per_subagent: usize,
    ) -> Vec<TypedEvent> {
        let mut events = Vec::new();
        let mut ts_counter: u64 = 0;
        let mut next_ts = move || -> String {
            ts_counter += 1;
            let secs = ts_counter / 1000;
            let millis = ts_counter % 1000;
            let mins = secs / 60;
            let s = secs % 60;
            let hours = mins / 60;
            let m = mins % 60;
            format!("2026-01-01T{hours:02}:{m:02}:{s:02}.{millis:03}Z")
        };
        let mut evt_id: usize = 0;
        let mut next_id = move || -> String {
            evt_id += 1;
            format!("ev-{evt_id}")
        };

        // Session model change
        events.push(make_event(
            SessionEventType::SessionModelChange,
            TypedEventData::ModelChange(ModelChangeData {
                previous_model: None,
                new_model: Some("claude-sonnet-4".to_string()),
                previous_reasoning_effort: None,
                reasoning_effort: None,
            }),
            &next_id(),
            &next_ts(),
            None,
        ));

        for turn_idx in 0..turn_count {
            // UserMessage
            events.push(make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some(format!("Turn {turn_idx}")),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some(format!("int-{turn_idx}")),
                    source: None,
                    agent_mode: None,
                }),
                &next_id(),
                &next_ts(),
                None,
            ));

            // Main agent direct tool call
            let main_tc_id = format!("tc-main-{turn_idx}");
            events.push(make_event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some(main_tc_id.clone()),
                    tool_name: Some("read_file".to_string()),
                    arguments: None,
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
                &next_id(),
                &next_ts(),
                None,
            ));
            events.push(make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some(main_tc_id),
                    parent_tool_call_id: None,
                    model: Some("claude-sonnet-4".to_string()),
                    interaction_id: None,
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
                &next_id(),
                &next_ts(),
                None,
            ));

            // Subagents
            for sub_idx in 0..subagents_per_turn {
                let sub_tc_id = format!("tc-sub-{turn_idx}-{sub_idx}");
                let sub_model = if sub_idx % 2 == 0 { "gemini-3-pro-preview" } else { "gpt-5.3-codex" };

                // ToolExecStart for subagent wrapper
                events.push(make_event(
                    SessionEventType::ToolExecutionStart,
                    TypedEventData::ToolExecutionStart(ToolExecStartData {
                        tool_call_id: Some(sub_tc_id.clone()),
                        tool_name: Some("task".to_string()),
                        arguments: Some(json!({ "model": sub_model })),
                        parent_tool_call_id: None,
                        mcp_server_name: None,
                        mcp_tool_name: None,
                    }),
                    &next_id(),
                    &next_ts(),
                    None,
                ));
                events.push(make_event(
                    SessionEventType::SubagentStarted,
                    TypedEventData::SubagentStarted(SubagentStartedData {
                        tool_call_id: Some(sub_tc_id.clone()),
                        agent_name: Some(format!("agent-{sub_idx}")),
                        agent_display_name: Some(format!("Agent {sub_idx}")),
                        agent_description: None,
                    }),
                    &next_id(),
                    &next_ts(),
                    None,
                ));

                // Child tool calls under this subagent
                for tool_idx in 0..tools_per_subagent {
                    let child_tc_id = format!("tc-child-{turn_idx}-{sub_idx}-{tool_idx}");
                    events.push(make_event(
                        SessionEventType::ToolExecutionStart,
                        TypedEventData::ToolExecutionStart(ToolExecStartData {
                            tool_call_id: Some(child_tc_id.clone()),
                            tool_name: Some("grep".to_string()),
                            arguments: None,
                            parent_tool_call_id: Some(sub_tc_id.clone()),
                            mcp_server_name: None,
                            mcp_tool_name: None,
                        }),
                        &next_id(),
                        &next_ts(),
                        None,
                    ));
                    events.push(make_event(
                        SessionEventType::ToolExecutionComplete,
                        TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                            tool_call_id: Some(child_tc_id),
                            parent_tool_call_id: Some(sub_tc_id.clone()),
                            model: Some(sub_model.to_string()),
                            interaction_id: None,
                            success: Some(true),
                            result: None,
                            error: None,
                            tool_telemetry: None,
                            is_user_requested: None,
                        }),
                        &next_id(),
                        &next_ts(),
                        None,
                    ));
                }

                events.push(make_event(
                    SessionEventType::SubagentCompleted,
                    TypedEventData::SubagentCompleted(SubagentCompletedData {
                        tool_call_id: Some(sub_tc_id.clone()),
                        agent_name: Some(format!("agent-{sub_idx}")),
                        agent_display_name: Some(format!("Agent {sub_idx}")),
                    }),
                    &next_id(),
                    &next_ts(),
                    None,
                ));
                events.push(make_event(
                    SessionEventType::ToolExecutionComplete,
                    TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                        tool_call_id: Some(sub_tc_id),
                        parent_tool_call_id: None,
                        model: Some("claude-sonnet-4".to_string()),
                        interaction_id: None,
                        success: Some(true),
                        result: None,
                        error: None,
                        tool_telemetry: None,
                        is_user_requested: None,
                    }),
                    &next_id(),
                    &next_ts(),
                    None,
                ));
            }

            events.push(make_event(
                SessionEventType::AssistantTurnEnd,
                TypedEventData::TurnEnd(TurnEndData {
                    turn_id: Some(format!("turn-{turn_idx}")),
                }),
                &next_id(),
                &next_ts(),
                None,
            ));
        }

        events
    }

    #[test]
    #[ignore] // Perf measurement test — run with --include-ignored
    fn perf_reconstruct_turns_subagent_heavy() {
        // Measure performance with subagent-heavy sessions at different scales.
        // This is a timing test, not a pass/fail — prints results for manual review.
        let configs = [
            // (turns, subagents_per_turn, tools_per_subagent)
            (10, 3, 5),     // small: 10 turns, 3 subagents each with 5 tools
            (50, 3, 5),     // medium: 50 turns
            (200, 4, 8),    // large: 200 turns, 4 subagents each with 8 tools
            (500, 5, 10),   // xlarge: 500 turns, 5 subagents each with 10 tools
        ];

        for (turns, subs, tools) in configs {
            let events = make_subagent_heavy_session(turns, subs, tools);
            let event_count = events.len();

            // Warm up
            let _ = reconstruct_turns(&events);

            // Measure
            let iterations = 50;
            let start = std::time::Instant::now();
            for _ in 0..iterations {
                let result = reconstruct_turns(&events);
                std::hint::black_box(&result);
            }
            let elapsed = start.elapsed();
            let per_iter = elapsed / iterations;

            // Verify correctness
            let result = reconstruct_turns(&events);
            assert_eq!(result.len(), turns);
            for turn in &result {
                assert_eq!(
                    turn.model.as_deref(),
                    Some("claude-sonnet-4"),
                    "turn {} model should be main agent's, got {:?}",
                    turn.turn_index,
                    turn.model
                );
            }

            let total_tool_calls: usize = result.iter().map(|t| t.tool_calls.len()).sum();
            let subagent_count: usize = result.iter()
                .flat_map(|t| t.tool_calls.iter())
                .filter(|tc| tc.is_subagent)
                .count();

            eprintln!(
                "  {turns:>4} turns x {subs} subs x {tools} tools | {event_count:>6} events | {total_tool_calls:>6} tool_calls ({subagent_count} subagents) | {per_iter:>10.2?}/iter | {:.1} events/us",
                event_count as f64 / per_iter.as_micros() as f64
            );
        }
    }