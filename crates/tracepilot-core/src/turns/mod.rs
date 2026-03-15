//! Conversation turn reconstruction from flat typed event streams.

use crate::models::conversation::{ConversationTurn, TurnToolCall};
use crate::models::event_types::SessionEventType;
use crate::parsing::events::{TypedEvent, TypedEventData};
use chrono::{DateTime, Utc};

/// Aggregate statistics for reconstructed turns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnStats {
    pub total_turns: usize,
    pub complete_turns: usize,
    pub incomplete_turns: usize,
    pub total_tool_calls: usize,
    pub total_messages: usize,
    pub models_used: Vec<String>,
}

/// Reconstruct conversation turns from a flat stream of typed events.
pub fn reconstruct_turns(events: &[TypedEvent]) -> Vec<ConversationTurn> {
    let mut turns = Vec::new();
    let mut current_turn: Option<ConversationTurn> = None;

    for event in events {
        match (&event.event_type, &event.typed_data) {
            (SessionEventType::UserMessage, TypedEventData::UserMessage(data)) => {
                finalize_current_turn(&mut current_turn, &mut turns, false, None);

                current_turn = Some(new_turn(
                    turns.len(),
                    event.raw.timestamp,
                    data.interaction_id.clone(),
                    data.content.clone(),
                ));
            }
            (SessionEventType::AssistantTurnStart, TypedEventData::TurnStart(data)) => {
                let turn = ensure_current_turn(&mut current_turn, turns.len(), event.raw.timestamp);
                if turn.turn_id.is_none() {
                    turn.turn_id = data.turn_id.clone();
                }
                if turn.interaction_id.is_none() {
                    turn.interaction_id = data.interaction_id.clone();
                }
            }
            (SessionEventType::AssistantMessage, TypedEventData::AssistantMessage(data)) => {
                let turn = ensure_current_turn(&mut current_turn, turns.len(), event.raw.timestamp);
                if turn.interaction_id.is_none() {
                    turn.interaction_id = data.interaction_id.clone();
                }
                if let Some(content) = &data.content {
                    turn.assistant_messages.push(content.clone());
                }
            }
            (SessionEventType::ToolExecutionStart, TypedEventData::ToolExecutionStart(data)) => {
                let turn = ensure_current_turn(&mut current_turn, turns.len(), event.raw.timestamp);
                turn.tool_calls.push(TurnToolCall {
                    tool_call_id: data.tool_call_id.clone(),
                    parent_tool_call_id: data.parent_tool_call_id.clone(),
                    tool_name: data
                        .tool_name
                        .clone()
                        .unwrap_or_else(|| "unknown".to_string()),
                    arguments: data.arguments.clone(),
                    success: None,
                    error: None,
                    started_at: event.raw.timestamp,
                    completed_at: None,
                    duration_ms: None,
                    mcp_server_name: data.mcp_server_name.clone(),
                    mcp_tool_name: data.mcp_tool_name.clone(),
                    is_complete: false,
                    is_subagent: false,
                    agent_display_name: None,
                    agent_description: None,
                });
            }
            (
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(data),
            ) => {
                if let Some(turn) = current_turn.as_mut() {
                    if turn.interaction_id.is_none() {
                        turn.interaction_id = data.interaction_id.clone();
                    }
                    if turn.model.is_none() {
                        turn.model = data.model.clone();
                    }

                    if let Some(tool_call) =
                        find_tool_call_mut(&mut turn.tool_calls, data.tool_call_id.as_deref())
                    {
                        tool_call.success = data.success;
                        tool_call.error = data.error.as_ref().map(json_value_to_string);
                        tool_call.completed_at = event.raw.timestamp;
                        tool_call.duration_ms =
                            duration_ms(tool_call.started_at, tool_call.completed_at);
                        tool_call.is_complete = true;
                        if tool_call.parent_tool_call_id.is_none() {
                            tool_call.parent_tool_call_id = data.parent_tool_call_id.clone();
                        }
                    }
                }
            }
            (SessionEventType::SubagentStarted, TypedEventData::SubagentStarted(data)) => {
                let turn = ensure_current_turn(&mut current_turn, turns.len(), event.raw.timestamp);
                turn.tool_calls.push(TurnToolCall {
                    tool_call_id: data.tool_call_id.clone(),
                    parent_tool_call_id: None,
                    tool_name: data
                        .agent_name
                        .clone()
                        .or_else(|| data.agent_display_name.clone())
                        .unwrap_or_else(|| "subagent".to_string()),
                    arguments: None,
                    success: None,
                    error: None,
                    started_at: event.raw.timestamp,
                    completed_at: None,
                    duration_ms: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                    is_complete: false,
                    is_subagent: true,
                    agent_display_name: data.agent_display_name.clone(),
                    agent_description: data.agent_description.clone(),
                });
            }
            (SessionEventType::SubagentCompleted, TypedEventData::SubagentCompleted(data)) => {
                if let Some(turn) = current_turn.as_mut()
                    && let Some(tool_call) =
                        find_tool_call_mut(&mut turn.tool_calls, data.tool_call_id.as_deref())
                {
                    tool_call.completed_at = event.raw.timestamp;
                    tool_call.duration_ms =
                        duration_ms(tool_call.started_at, tool_call.completed_at);
                    tool_call.success = Some(true);
                    tool_call.is_complete = true;
                }
            }
            (SessionEventType::SubagentFailed, TypedEventData::SubagentFailed(data)) => {
                if let Some(turn) = current_turn.as_mut()
                    && let Some(tool_call) =
                        find_tool_call_mut(&mut turn.tool_calls, data.tool_call_id.as_deref())
                {
                    tool_call.completed_at = event.raw.timestamp;
                    tool_call.duration_ms =
                        duration_ms(tool_call.started_at, tool_call.completed_at);
                    tool_call.success = Some(false);
                    tool_call.error = data.error.clone();
                    tool_call.is_complete = true;
                }
            }
            (SessionEventType::AssistantTurnEnd, TypedEventData::TurnEnd(data)) => {
                if let Some(turn) = current_turn.as_mut()
                    && turn.turn_id.is_none()
                {
                    turn.turn_id = data.turn_id.clone();
                }
                finalize_current_turn(&mut current_turn, &mut turns, true, event.raw.timestamp);
            }
            _ => {}
        }
    }

    finalize_current_turn(&mut current_turn, &mut turns, false, None);
    turns
}

/// Compute summary statistics for reconstructed turns.
pub fn turn_stats(turns: &[ConversationTurn]) -> TurnStats {
    let mut models_set = std::collections::HashSet::new();

    for model in turns.iter().filter_map(|turn| turn.model.as_ref()) {
        models_set.insert(model.clone());
    }
    let models_used: Vec<String> = models_set.into_iter().collect();

    TurnStats {
        total_turns: turns.len(),
        complete_turns: turns.iter().filter(|turn| turn.is_complete).count(),
        incomplete_turns: turns.iter().filter(|turn| !turn.is_complete).count(),
        total_tool_calls: turns.iter().map(|turn| turn.tool_calls.len()).sum(),
        total_messages: turns.iter().map(|turn| turn.assistant_messages.len()).sum(),
        models_used,
    }
}

fn new_turn(
    turn_index: usize,
    timestamp: Option<DateTime<Utc>>,
    interaction_id: Option<String>,
    user_message: Option<String>,
) -> ConversationTurn {
    ConversationTurn {
        turn_index,
        turn_id: None,
        interaction_id,
        user_message,
        assistant_messages: Vec::new(),
        model: None,
        timestamp,
        end_timestamp: None,
        tool_calls: Vec::new(),
        duration_ms: None,
        is_complete: false,
    }
}

fn ensure_current_turn(
    current_turn: &mut Option<ConversationTurn>,
    turn_index: usize,
    timestamp: Option<DateTime<Utc>>,
) -> &mut ConversationTurn {
    current_turn.get_or_insert_with(|| new_turn(turn_index, timestamp, None, None))
}

fn finalize_current_turn(
    current_turn: &mut Option<ConversationTurn>,
    turns: &mut Vec<ConversationTurn>,
    is_complete: bool,
    end_timestamp: Option<DateTime<Utc>>,
) {
    if let Some(mut turn) = current_turn.take() {
        if turn.end_timestamp.is_none() {
            turn.end_timestamp = end_timestamp;
        }
        turn.duration_ms = duration_ms(turn.timestamp, turn.end_timestamp);
        turn.is_complete = is_complete;
        turns.push(turn);
    }
}

fn duration_ms(start: Option<DateTime<Utc>>, end: Option<DateTime<Utc>>) -> Option<u64> {
    let (Some(start), Some(end)) = (start, end) else {
        return None;
    };

    let millis = end.signed_duration_since(start).num_milliseconds();
    (millis >= 0).then_some(millis as u64)
}

fn find_tool_call_mut<'a>(
    tool_calls: &'a mut [TurnToolCall],
    tool_call_id: Option<&str>,
) -> Option<&'a mut TurnToolCall> {
    tool_call_id.and_then(|id| {
        tool_calls
            .iter_mut()
            .rev()
            .find(|tool_call| tool_call.tool_call_id.as_deref() == Some(id))
    })
}

fn json_value_to_string(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::event_types::{
        AssistantMessageData, SubagentCompletedData, SubagentStartedData, ToolExecCompleteData,
        ToolExecStartData, TurnEndData, TurnStartData, UserMessageData,
    };
    use crate::parsing::events::{RawEvent, TypedEvent};
    use serde_json::{Value, json};

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
        assert_eq!(turn.assistant_messages, vec!["Hi there!".to_string()]);
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
            turns[0].assistant_messages,
            vec!["Part one".to_string(), "Part two".to_string()]
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
}
