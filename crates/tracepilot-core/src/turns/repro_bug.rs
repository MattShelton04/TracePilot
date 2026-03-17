
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::event_types::{
        SubagentStartedData, ToolExecCompleteData, ToolExecStartData, TurnStartData,
        UserMessageData,
    };
    use crate::parsing::events::{RawEvent, TypedEvent, TypedEventData};
    use crate::models::event_types::SessionEventType;
    use crate::turns::{TurnReconstructor, reconstruct_turns};
    use serde_json::json;
    use chrono::Utc;
    use std::collections::HashMap;

    fn make_event(
        event_type: SessionEventType,
        data: TypedEventData,
        id: &str,
        ts: &str,
        parent: Option<&str>,
    ) -> TypedEvent {
        let raw_data = match &data {
             TypedEventData::UserMessage(v) => serde_json::to_value(v).unwrap(),
             TypedEventData::TurnStart(v) => serde_json::to_value(v).unwrap(),
             TypedEventData::ToolExecutionStart(v) => serde_json::to_value(v).unwrap(),
             TypedEventData::ToolExecutionComplete(v) => serde_json::to_value(v).unwrap(),
             TypedEventData::SubagentStarted(v) => serde_json::to_value(v).unwrap(),
             _ => json!({}),
        };

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

    #[test]
    fn repro_enrich_subagent_bug() {
        // Scenario: ToolExecComplete arrives BEFORE SubagentStarted.
        // This simulates a fast tool completion or out-of-order delivery.
        let events = vec![
            make_event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some("Launch".to_string()),
                    transformed_content: None,
                    attachments: None,
                    interaction_id: Some("int-1".to_string()),
                    source: None,
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
                    tool_call_id: Some("tc-1".to_string()),
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
            // Tool completes immediately (is_complete = true)
            make_event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tc-1".to_string()),
                    parent_tool_call_id: None,
                    model: None,
                    interaction_id: Some("int-1".to_string()),
                    success: Some(true),
                    result: None,
                    error: None,
                    tool_telemetry: None,
                }),
                "evt-4",
                "2026-03-10T10:00:01.100Z",
                Some("evt-3"),
            ),
            // Then we learn it's a subagent
            make_event(
                SessionEventType::SubagentStarted,
                TypedEventData::SubagentStarted(SubagentStartedData {
                    tool_call_id: Some("tc-1".to_string()),
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
        
        println!("DEBUG: is_subagent={}, is_complete={}, success={:?}", tc.is_subagent, tc.is_complete, tc.success);

        // Expectation based on comment: should be false (waiting for SubagentCompleted)
        // Actual based on code: true (because success is Some)
        assert!(!tc.is_complete, "Subagent should be incomplete despite ToolExecComplete");
    }
}
