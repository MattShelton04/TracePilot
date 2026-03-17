//! Conversation turn reconstruction from flat typed event streams.
//!
//! ## State Machine
//!
//! Turn reconstruction treats the event stream as a state machine:
//!
//! 1. A `UserMessage` opens a new turn (finalizing any previous one)
//! 2. `AssistantTurnStart` / `AssistantTurnEnd` bracket the assistant's response
//! 3. `ToolExecutionStart` / `ToolExecutionComplete` are paired into `TurnToolCall`s
//! 4. `SubagentStarted` / `SubagentCompleted` / `SubagentFailed` are treated as
//!    nested tool calls within the enclosing turn
//! 5. `AssistantMessage` appends content to the current turn
//!
//! Events that don't affect turn state (e.g. `SessionInfo`, `SystemNotification`)
//! are silently skipped.
//!
//! ## Assumptions
//!
//! - Events are ordered chronologically (as written to `events.jsonl`)
//! - `parentId` links are used for subagent nesting, not for turn ordering
//! - A session may end mid-turn (no `TurnEnd`); the final turn is still emitted

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
                    // Don't mark subagents complete here — wait for SubagentCompleted/Failed
                    tool_call.is_complete = !tool_call.is_subagent;
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
                    // If ToolExecComplete already set is_complete before we knew this was
                    // a subagent, reset it — only SubagentCompleted/Failed should finalize.
                    if existing.success.is_none() {
                        existing.is_complete = false;
                    }
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
#[path = "tests.rs"]
mod tests;

