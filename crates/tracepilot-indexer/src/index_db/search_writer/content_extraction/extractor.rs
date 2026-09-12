use super::super::SearchContentRow;
use super::super::tool_extraction::{extract_tool_result, flatten_json_value};
use super::builder::SearchContentRowBuilder;
use super::limits::*;
use std::collections::HashMap;
use tracepilot_core::parsing::events::{TypedEvent, TypedEventData};
use tracepilot_core::turns::TurnReconstructor;
use tracepilot_core::utils::truncate_utf8;

/// Extract searchable content rows from a session's typed events.
/// This is a pure function with no database interaction — safe to call
/// outside of a transaction to avoid holding locks during CPU work.
///
/// Accepts a validated [`SessionId`](tracepilot_core::ids::SessionId) so
/// callers cannot accidentally stamp rows with a task/job identifier.
pub fn extract_search_content(
    session_id: &tracepilot_core::ids::SessionId,
    events: &[TypedEvent],
) -> Vec<SearchContentRow> {
    let session_id = session_id.as_str();
    let mut rows = Vec::with_capacity(events.len() / 2);
    let mut turns = TurnReconstructor::with_agent_ownership(events);
    let mut tool_names = HashMap::new();
    let mut pending_rows: Vec<SearchContentRow> = Vec::new();

    for (event_index, event) in events.iter().enumerate() {
        let ts_unix = event.raw.timestamp.map(|t| t.timestamp());
        let idx = event_index as i64;
        turns.process(event, event_index);
        let turn = turns.content_turn_index(event).map(|index| index as i64);
        if let Some(active) = turns.active_turn_index() {
            for mut row in pending_rows.drain(..) {
                row.turn_number = Some(active as i64);
                rows.push(row);
            }
        }

        match &event.typed_data {
            TypedEventData::UserMessage(d) => {
                if let Some(ref content) = d.content
                    && !content.is_empty()
                {
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_content("user_message", content.clone());
                    rows.push(row);
                }
            }

            TypedEventData::AssistantMessage(d) => {
                if let Some(ref content) = d.content
                    && !content.is_empty()
                {
                    let truncated = truncate_utf8(content, MAX_ASSISTANT_MESSAGE_BYTES);
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_content("assistant_message", truncated.to_string());
                    rows.push(row);
                }
                // Also index reasoning text if present
                if let Some(ref reasoning) = d.reasoning_text
                    && !reasoning.is_empty()
                {
                    let truncated = truncate_utf8(reasoning, MAX_REASONING_BYTES);
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_content("reasoning", truncated.to_string());
                    rows.push(row);
                }
            }

            TypedEventData::AssistantReasoning(d) => {
                if let Some(ref content) = d.content
                    && !content.is_empty()
                {
                    let truncated = truncate_utf8(content, MAX_REASONING_BYTES);
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_content("reasoning", truncated.to_string());
                    rows.push(row);
                }
            }

            TypedEventData::ToolExecutionStart(d) => {
                let name = d.tool_name.clone().unwrap_or_else(|| "unknown".to_string());

                // Remember tool name and turn for completion events
                if let Some(ref id) = d.tool_call_id {
                    tool_names.insert(id.clone(), name.clone());
                }

                // Skip tools that add negligible search value
                let name_lower = name.to_lowercase();
                if SKIP_TOOLS.iter().any(|s| s.to_lowercase() == name_lower) {
                    continue;
                }

                // Serialize arguments to searchable text
                if let Some(ref args) = d.arguments {
                    let args_text = flatten_json_value(args);
                    if !args_text.is_empty() {
                        let truncated = truncate_utf8(&args_text, MAX_TOOL_CALL_BYTES);
                        let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                            .with_tool_content("tool_call", Some(name), truncated.to_string());
                        rows.push(row);
                    }
                }
            }

            TypedEventData::ToolExecutionComplete(d) => {
                let tool_name = d
                    .tool_call_id
                    .as_ref()
                    .and_then(|id| tool_names.get(id))
                    .cloned();
                let name_lower = tool_name.as_deref().unwrap_or("").to_lowercase();

                // Skip tools that add negligible search value
                if SKIP_TOOLS.iter().any(|s| s.to_lowercase() == name_lower) {
                    continue;
                }

                // Index tool errors
                if let Some(ref error) = d.error {
                    let error_text = flatten_json_value(error);
                    if !error_text.is_empty() {
                        let truncated = truncate_utf8(&error_text, MAX_TOOL_ERROR_BYTES);
                        let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                            .with_tool_content(
                                "tool_error",
                                tool_name.clone(),
                                truncated.to_string(),
                            );
                        rows.push(row);
                    }
                    continue;
                }

                // Skip result-only tools (call is indexed, result is boilerplate)
                if SKIP_RESULT_ONLY_TOOLS
                    .iter()
                    .any(|s| s.to_lowercase() == name_lower)
                {
                    continue;
                }

                // Index successful tool results
                if let Some(ref result) = d.result {
                    let content = extract_tool_result(&name_lower, result);
                    if !content.is_empty() {
                        let truncated = truncate_utf8(&content, MAX_TOOL_RESULT_BYTES);
                        let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                            .with_tool_content(
                                "tool_result",
                                tool_name.clone(),
                                truncated.to_string(),
                            );
                        rows.push(row);
                    }
                }
            }

            TypedEventData::SessionError(d) => {
                let mut parts = Vec::new();
                if let Some(ref t) = d.error_type {
                    parts.push(t.clone());
                }
                if let Some(ref m) = d.message {
                    parts.push(m.clone());
                }
                let content = parts.join(": ");
                if !content.is_empty() {
                    let truncated = truncate_utf8(&content, MAX_ERROR_BYTES);
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_content("error", truncated.to_string());
                    if turn.is_some() {
                        rows.push(row);
                    } else {
                        pending_rows.push(row);
                    }
                }
            }

            TypedEventData::CompactionComplete(d) => {
                if let Some(ref summary) = d.summary_content
                    && !summary.is_empty()
                {
                    let truncated = truncate_utf8(summary, MAX_COMPACTION_BYTES);
                    let metadata = d
                        .checkpoint_number
                        .map(|n| serde_json::json!({"checkpoint": n}).to_string());
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_metadata("compaction_summary", truncated.to_string(), metadata);
                    if turn.is_some() {
                        rows.push(row);
                    } else {
                        pending_rows.push(row);
                    }
                }
            }

            TypedEventData::SystemMessage(d) => {
                if let Some(ref content) = d.content
                    && !content.is_empty()
                {
                    let truncated = truncate_utf8(content, MAX_SYSTEM_MESSAGE_BYTES);
                    let metadata = d
                        .role
                        .as_ref()
                        .map(|r| serde_json::json!({"role": r}).to_string());
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_metadata("system_message", truncated.to_string(), metadata);
                    if turn.is_some() {
                        rows.push(row);
                    } else {
                        pending_rows.push(row);
                    }
                }
            }

            TypedEventData::SubagentStarted(d) => {
                let mut parts = Vec::new();
                if let Some(ref name) = d.agent_name {
                    parts.push(name.clone());
                }
                if let Some(ref display) = d.agent_display_name {
                    parts.push(display.clone());
                }
                let content = parts.join(" — ");
                if !content.is_empty() {
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_content("subagent", content);
                    rows.push(row);
                }
            }

            // All other event types are not indexed for FTS
            _ => {}
        }
    }

    // Any session rows still pending (no subsequent turn opened) keep turn_number: None
    rows.append(&mut pending_rows);
    rows
}
