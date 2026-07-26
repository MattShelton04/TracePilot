use super::*;

#[test]
fn excludes_nested_subagent_work_from_main_context_contributions() {
    let large_child_payload = "subagent-only payload ".repeat(100);
    let mut child_message = assistant_message(&large_child_payload);
    if let TypedEventData::AssistantMessage(data) = &mut child_message.typed_data {
        data.parent_tool_call_id = Some("subagent-call".into());
    }
    let mut child_reasoning = event(
        SessionEventType::AssistantReasoning,
        TypedEventData::AssistantReasoning(AssistantReasoningData {
            reasoning_id: Some("child-reasoning".into()),
            content: Some(large_child_payload.clone()),
        }),
    );
    child_reasoning.raw.agent_id = Some("subagent-call".into());

    let events = vec![
        user_message("delegate this", "interaction-1"),
        event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("turn-1".into()),
                interaction_id: Some("interaction-1".into()),
            }),
        ),
        event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("subagent-call".into()),
                turn_id: Some("turn-1".into()),
                tool_name: Some("task".into()),
                arguments: Some(json!({"prompt": "review"})),
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
        ),
        event(
            SessionEventType::SubagentStarted,
            TypedEventData::SubagentStarted(SubagentStartedData {
                tool_call_id: Some("subagent-call".into()),
                agent_name: Some("review".into()),
                agent_display_name: Some("Review Agent".into()),
                agent_description: None,
            }),
        ),
        child_message,
        child_reasoning,
        event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some("child-tool".into()),
                turn_id: Some("turn-1".into()),
                tool_name: Some("view".into()),
                arguments: Some(json!({"payload": large_child_payload})),
                parent_tool_call_id: Some("subagent-call".into()),
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
        ),
        event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("child-tool".into()),
                turn_id: Some("turn-1".into()),
                parent_tool_call_id: Some("subagent-call".into()),
                model: Some("gpt-5.6-luna".into()),
                interaction_id: Some("interaction-1".into()),
                success: Some(true),
                result: Some(json!({"content": large_child_payload})),
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
        ),
        event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some("subagent-call".into()),
                turn_id: Some("turn-1".into()),
                parent_tool_call_id: None,
                model: Some("gpt-5.6-luna".into()),
                interaction_id: Some("interaction-1".into()),
                success: Some(true),
                result: Some(json!({"content": "review complete"})),
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
        ),
    ];

    let timeline = build_context_timeline(&events);
    assert_eq!(timeline.top_tool_calls.len(), 1);
    assert_eq!(timeline.top_tool_calls[0].tool_name, "task");
    assert!(
        timeline.points[0].conversation_tokens < 100,
        "subagent-private context leaked into the main context estimate"
    );
}

#[test]
fn folded_skill_context_is_counted_once_and_not_shown_as_user_input() {
    let skill_body = "Follow this skill workflow exactly.";
    let folded_context = format!("<skill-context name=\"demo\">{skill_body}</skill-context>");
    let mut invocation = event(
        SessionEventType::SkillInvoked,
        TypedEventData::SkillInvoked(SkillInvokedData {
            name: Some("demo".into()),
            path: None,
            content: Some(skill_body.into()),
            allowed_tools: None,
            plugin_name: None,
            plugin_version: None,
            description: None,
        }),
    );
    invocation.raw.id = Some("skill-event".into());
    let mut folded_message = user_message(&folded_context, "interaction-1");
    folded_message.raw.parent_id = Some("skill-event".into());

    let events = vec![
        invocation,
        folded_message,
        event(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: Some("turn-1".into()),
                interaction_id: Some("interaction-1".into()),
            }),
        ),
        assistant_message("done"),
    ];

    let timeline = build_context_timeline(&events);
    let expected_tokens = (folded_context.len() as u64).div_ceil(4) + 1;
    assert_eq!(timeline.points[0].conversation_tokens, expected_tokens);
    assert!(timeline.events.is_empty());
}
