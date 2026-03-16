//! Conversation turn reconstruction from flat typed event streams.

use std::collections::HashMap;

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
    let mut intention_summaries: HashMap<String, String> = HashMap::new();

    for event in events {
        match (&event.event_type, &event.typed_data) {
            (SessionEventType::UserMessage, TypedEventData::UserMessage(data)) => {
                finalize_current_turn(&mut current_turn, &mut turns, false, None);

                current_turn = Some(new_turn(
                    turns.len(),
                    event.raw.timestamp,
                    data.interaction_id.clone(),
                    data.content.clone(),
                    data.transformed_content.clone(),
                    data.attachments.clone(),
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
                    if !content.trim().is_empty() {
                        turn.assistant_messages.push(content.clone());
                    }
                }
                if let Some(reasoning) = &data.reasoning_text {
                    if !reasoning.trim().is_empty() {
                        turn.reasoning_texts.push(reasoning.clone());
                    }
                }
                if let Some(tokens) = data.output_tokens {
                    *turn.output_tokens.get_or_insert(0) += tokens;
                }
                if let Some(requests) = &data.tool_requests {
                    for req in requests {
                        if let (Some(id), Some(summary)) = (
                            req.get("toolCallId").and_then(|v| v.as_str()),
                            req.get("intentionSummary").and_then(|v| v.as_str()),
                        ) {
                            if !summary.trim().is_empty() {
                                intention_summaries
                                    .insert(id.to_string(), summary.to_string());
                            }
                        }
                    }
                }
            }
            (SessionEventType::ToolExecutionStart, TypedEventData::ToolExecutionStart(data)) => {
                let turn = ensure_current_turn(&mut current_turn, turns.len(), event.raw.timestamp);
                let intention = data
                    .tool_call_id
                    .as_ref()
                    .and_then(|id| intention_summaries.get(id))
                    .cloned();
                // Extract model hint from tool call arguments (subagents specify model in arguments)
                let model_from_args = data
                    .arguments
                    .as_ref()
                    .and_then(|args| args.get("model"))
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string());
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
                    model: model_from_args,
                    intention_summary: intention,
                    result_content: None,
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
                }

                // Search current turn first, then finalized turns (tool may complete after turn boundary)
                let tool_call = current_turn
                    .as_mut()
                    .and_then(|turn| {
                        find_tool_call_mut(&mut turn.tool_calls, data.tool_call_id.as_deref())
                    })
                    .or_else(|| {
                        turns.iter_mut().rev().find_map(|turn| {
                            find_tool_call_mut(&mut turn.tool_calls, data.tool_call_id.as_deref())
                        })
                    });

                if let Some(tool_call) = tool_call {
                    // Only overwrite success/error if the new data provides them
                    // (avoids SubagentCompleted's success being erased by ToolExecComplete's None)
                    if data.success.is_some() {
                        tool_call.success = data.success;
                    }
                    if let Some(ref err) = data.error {
                        tool_call.error = Some(json_value_to_string(err));
                    }
                    // Use latest timestamp for completion (longest observed duration wins)
                    if tool_call.completed_at.is_none()
                        || event.raw.timestamp > tool_call.completed_at
                    {
                        tool_call.completed_at = event.raw.timestamp;
                        tool_call.duration_ms =
                            duration_ms(tool_call.started_at, tool_call.completed_at);
                    }
                    tool_call.is_complete = true;
                    if data.model.is_some() {
                        tool_call.model = data.model.clone();
                    }
                    if tool_call.parent_tool_call_id.is_none() {
                        tool_call.parent_tool_call_id = data.parent_tool_call_id.clone();
                    }
                    // Always update result — last completion wins (matches timestamp logic)
                    if let Some(result) = &data.result {
                        if let Some(preview) = extract_result_preview(result) {
                            tool_call.result_content = Some(preview);
                        }
                    }
                }

                // Set turn-level model from non-subagent completions
                // Check current turn first, then the finalized turn owning the tool call
                let tc_id = data.tool_call_id.as_deref();
                let has_tc = |t: &ConversationTurn| {
                    tc_id.is_some_and(|id| t.tool_calls.iter().any(|tc| tc.tool_call_id.as_deref() == Some(id)))
                };
                let owning_turn = current_turn
                    .as_mut()
                    .filter(|t| has_tc(t))
                    .or_else(|| {
                        turns.iter_mut().rev().find(|t| has_tc(t))
                    });
                if let Some(turn) = owning_turn {
                    if let Some(tc) = find_tool_call_mut(&mut turn.tool_calls, tc_id) {
                        if turn.model.is_none() && !tc.is_subagent {
                            turn.model = data.model.clone();
                        }
                    }
                }
            }
            (SessionEventType::SubagentStarted, TypedEventData::SubagentStarted(data)) => {
                let turn = ensure_current_turn(&mut current_turn, turns.len(), event.raw.timestamp);

                // Helper closure to enrich an existing entry with subagent metadata
                fn enrich_subagent(existing: &mut TurnToolCall, data: &crate::models::event_types::SubagentStartedData) {
                    existing.is_subagent = true;
                    existing.agent_display_name = data.agent_display_name.clone();
                    existing.agent_description = data.agent_description.clone();
                    if let Some(name) = data.agent_name.as_ref().or(data.agent_display_name.as_ref()) {
                        existing.tool_name = name.clone();
                    }
                }

                // Try current turn first, then search finalized turns
                if let Some(existing) =
                    find_tool_call_mut(&mut turn.tool_calls, data.tool_call_id.as_deref())
                {
                    enrich_subagent(existing, &data);
                } else if let Some(existing) = turns.iter_mut().rev().find_map(|t| {
                    find_tool_call_mut(&mut t.tool_calls, data.tool_call_id.as_deref())
                }) {
                    enrich_subagent(existing, &data);
                } else {
                    // No matching ToolExecStart anywhere — create a new entry
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
                        model: None,
                        intention_summary: None,
                        result_content: None,
                    });
                }
            }
            (SessionEventType::SubagentCompleted, TypedEventData::SubagentCompleted(data)) => {
                // First try current turn, then search finalized turns
                let found = current_turn.as_mut().and_then(|turn| {
                    find_tool_call_mut(&mut turn.tool_calls, data.tool_call_id.as_deref())
                });
                let tool_call = if found.is_some() {
                    found
                } else {
                    // Search finalized turns (subagent may complete after turn boundary)
                    turns.iter_mut().rev().find_map(|turn| {
                        find_tool_call_mut(&mut turn.tool_calls, data.tool_call_id.as_deref())
                    })
                };
                if let Some(tool_call) = tool_call {
                    // Use latest timestamp (SubagentCompleted should override early ToolExecComplete)
                    if tool_call.completed_at.is_none()
                        || event.raw.timestamp > tool_call.completed_at
                    {
                        tool_call.completed_at = event.raw.timestamp;
                        tool_call.duration_ms =
                            duration_ms(tool_call.started_at, tool_call.completed_at);
                    }
                    tool_call.success = Some(true);
                    tool_call.is_complete = true;
                }
            }
            (SessionEventType::SubagentFailed, TypedEventData::SubagentFailed(data)) => {
                // First try current turn, then search finalized turns
                let found = current_turn.as_mut().and_then(|turn| {
                    find_tool_call_mut(&mut turn.tool_calls, data.tool_call_id.as_deref())
                });
                let tool_call = if found.is_some() {
                    found
                } else {
                    turns.iter_mut().rev().find_map(|turn| {
                        find_tool_call_mut(&mut turn.tool_calls, data.tool_call_id.as_deref())
                    })
                };
                if let Some(tool_call) = tool_call {
                    if tool_call.completed_at.is_none()
                        || event.raw.timestamp > tool_call.completed_at
                    {
                        tool_call.completed_at = event.raw.timestamp;
                        tool_call.duration_ms =
                            duration_ms(tool_call.started_at, tool_call.completed_at);
                    }
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

    // Post-process: infer subagent models from their child tool calls
    loop {
        let mut changed = false;
        for turn in turns.iter_mut() {
            // Build map: tool_call_id -> first child model found
            let mut child_models: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();
            for tc in turn.tool_calls.iter() {
                if let (Some(model), Some(parent_id)) =
                    (&tc.model, &tc.parent_tool_call_id)
                {
                    child_models
                        .entry(parent_id.clone())
                        .or_insert_with(|| model.clone());
                }
            }
            // Propagate to subagents — always prefer the child model over the
            // parent model that ToolExecComplete may have incorrectly set.
            // For childless subagents, fall back to the model from arguments.
            for tc in turn.tool_calls.iter_mut() {
                if tc.is_subagent {
                    if let Some(ref id) = tc.tool_call_id {
                        if let Some(model) = child_models.get(id) {
                            if tc.model.as_deref() != Some(model.as_str()) {
                                tc.model = Some(model.clone());
                                changed = true;
                            }
                        } else {
                            // No child tool calls — use model from arguments as fallback
                            let args_model = tc.arguments.as_ref()
                                .and_then(|a| a.get("model"))
                                .and_then(|m| m.as_str())
                                .map(|s| s.to_string());
                            if let Some(ref m) = args_model {
                                if tc.model.as_deref() != Some(m.as_str()) {
                                    tc.model = args_model;
                                    changed = true;
                                }
                            }
                        }
                    }
                }
            }
        }
        if !changed {
            break;
        }
    }

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
    transformed_user_message: Option<String>,
    attachments: Option<Vec<serde_json::Value>>,
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
        reasoning_texts: Vec::new(),
        output_tokens: None,
        transformed_user_message,
        attachments,
    }
}

fn ensure_current_turn(
    current_turn: &mut Option<ConversationTurn>,
    turn_index: usize,
    timestamp: Option<DateTime<Utc>>,
) -> &mut ConversationTurn {
    current_turn.get_or_insert_with(|| new_turn(turn_index, timestamp, None, None, None, None))
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

const RESULT_PREVIEW_MAX_BYTES: usize = 1024;

/// Truncate a string to a maximum byte length, respecting UTF-8 boundaries.
fn truncate_str(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let truncate_at = s
        .char_indices()
        .map(|(idx, _)| idx)
        .take_while(|idx| *idx <= max_bytes)
        .last()
        .unwrap_or(0);
    format!("{}…[truncated]", &s[..truncate_at])
}

/// Extract a truncated result preview from a polymorphic `result` field.
/// The result can be a plain string, an object with `content`/`detailedContent`, or other shapes.
fn extract_result_preview(result: &serde_json::Value) -> Option<String> {
    match result {
        serde_json::Value::String(s) => {
            if s.trim().is_empty() {
                None
            } else {
                Some(truncate_str(s, RESULT_PREVIEW_MAX_BYTES))
            }
        }
        serde_json::Value::Object(obj) => {
            // Prefer `content` (the summarized output), fall back to `detailedContent`.
            // Treat empty/whitespace `content` as absent so `detailedContent` is considered.
            let text = obj
                .get("content")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .or_else(|| {
                    obj.get("detailedContent")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.trim().is_empty())
                });
            text.map(|s| truncate_str(s, RESULT_PREVIEW_MAX_BYTES))
        }
        _ => None,
    }
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
            TypedEventData::ContextChanged(value) => value.clone(),
            TypedEventData::WorkspaceFileChanged(value) => serde_json::to_value(value).unwrap(),
            TypedEventData::ToolUserRequested(value) => serde_json::to_value(value).unwrap(),
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
                    reasoning_text: None,
                    reasoning_opaque: None,
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
                    reasoning_text: None,
                    reasoning_opaque: None,
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
                    reasoning_text: None,
                    reasoning_opaque: None,
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
                    reasoning_text: None,
                    reasoning_opaque: None,
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
                    reasoning_text: None,
                    reasoning_opaque: None,
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
                    reasoning_text: None,
                    reasoning_opaque: None,
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
                    reasoning_text: None,
                    reasoning_opaque: None,
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
            turn.assistant_messages[0],
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
                }),
                "evt-4",
                "2026-03-10T07:14:52.200Z",
                Some("evt-1"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns[0].assistant_messages.len(), 1);
        assert_eq!(turns[0].assistant_messages[0], "Real response");
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
                }),
                "evt-3",
                "2026-03-10T07:14:53.000Z",
                Some("evt-1"),
            ),
        ];

        let turns = reconstruct_turns(&events);
        assert_eq!(turns[0].assistant_messages.len(), 1);
        assert_eq!(turns[0].assistant_messages[0], "Done!");
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
            turn.assistant_messages[0],
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
        assert_eq!(turn.reasoning_texts[0], "Let me think about this...");
        assert_eq!(turn.reasoning_texts[1], "Now I should summarize.");
        // Output tokens accumulated
        assert_eq!(turn.output_tokens, Some(150));
        // Only non-empty message kept
        assert_eq!(turn.assistant_messages.len(), 1);
        assert_eq!(turn.assistant_messages[0], "Here is the explanation.");
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
}
