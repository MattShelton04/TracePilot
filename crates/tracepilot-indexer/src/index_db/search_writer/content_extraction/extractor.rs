use super::super::SearchContentRow;
use super::super::tool_extraction::{extract_tool_result, flatten_json_value};
use super::builder::SearchContentRowBuilder;
use super::limits::*;
use super::state::ExtractionState;
use tracepilot_core::parsing::events::{TypedEvent, TypedEventData};
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
    let mut state = ExtractionState::new();

    for (event_index, event) in events.iter().enumerate() {
        let ts_unix = event.raw.timestamp.map(|t| t.timestamp());
        let idx = event_index as i64;

        match &event.typed_data {
            // TurnStart opens a turn if none is open (mirrors ensure_current_turn).
            // After a TurnEnd closes a turn, the next TurnStart begins a new one.
            TypedEventData::TurnStart(_) if state.ensure_turn() => {
                state.flush_pending(&mut rows);
            }

            TypedEventData::UserMessage(d) => {
                // UserMessage always opens a new turn (mirrors reconstructor:
                // finalize_current_turn + new_turn).
                state.current_turn += 1;
                state.turn_is_open = true;
                state.flush_pending(&mut rows);
                if let Some(ref content) = d.content
                    && !content.is_empty()
                {
                    let row = SearchContentRowBuilder::new(
                        session_id,
                        Some(state.current_turn),
                        idx,
                        ts_unix,
                    )
                    .with_content("user_message", content.clone());
                    rows.push(row);
                }
            }

            TypedEventData::AssistantMessage(d) => {
                if state.ensure_turn() {
                    state.flush_pending(&mut rows);
                }
                if let Some(ref content) = d.content
                    && !content.is_empty()
                {
                    let truncated = truncate_utf8(content, MAX_ASSISTANT_MESSAGE_BYTES);
                    let row = SearchContentRowBuilder::new(
                        session_id,
                        Some(state.current_turn),
                        idx,
                        ts_unix,
                    )
                    .with_content("assistant_message", truncated.to_string());
                    rows.push(row);
                }
                // Also index reasoning text if present
                if let Some(ref reasoning) = d.reasoning_text
                    && !reasoning.is_empty()
                {
                    let truncated = truncate_utf8(reasoning, MAX_REASONING_BYTES);
                    let row = SearchContentRowBuilder::new(
                        session_id,
                        Some(state.current_turn),
                        idx,
                        ts_unix,
                    )
                    .with_content("reasoning", truncated.to_string());
                    rows.push(row);
                }
            }

            TypedEventData::AssistantReasoning(d) => {
                if state.ensure_turn() {
                    state.flush_pending(&mut rows);
                }
                if let Some(ref content) = d.content
                    && !content.is_empty()
                {
                    let truncated = truncate_utf8(content, MAX_REASONING_BYTES);
                    let row = SearchContentRowBuilder::new(
                        session_id,
                        Some(state.current_turn),
                        idx,
                        ts_unix,
                    )
                    .with_content("reasoning", truncated.to_string());
                    rows.push(row);
                }
            }

            TypedEventData::ToolExecutionStart(d) => {
                if state.ensure_turn() {
                    state.flush_pending(&mut rows);
                }
                let name = d.tool_name.clone().unwrap_or_else(|| "unknown".to_string());

                // Remember tool name and turn for completion events
                if let Some(ref id) = d.tool_call_id {
                    state
                        .tool_info
                        .insert(id.clone(), (name.clone(), state.current_turn));
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
                        let row = SearchContentRowBuilder::new(
                            session_id,
                            Some(state.current_turn),
                            idx,
                            ts_unix,
                        )
                        .with_tool_content(
                            "tool_call",
                            Some(name),
                            truncated.to_string(),
                        );
                        rows.push(row);
                    }
                }
            }

            TypedEventData::ToolExecutionComplete(d) => {
                let info = d
                    .tool_call_id
                    .as_ref()
                    .and_then(|id| state.tool_info.get(id));
                let tool_name = info.map(|(name, _)| name.clone());
                let completion_turn = info.map(|(_, t)| *t).unwrap_or(state.current_turn);
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
                        let turn = if completion_turn >= 0 {
                            Some(completion_turn)
                        } else {
                            None
                        };
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
                        let turn = if completion_turn >= 0 {
                            Some(completion_turn)
                        } else {
                            None
                        };
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
                    let turn = if state.turn_is_open && state.current_turn >= 0 {
                        Some(state.current_turn)
                    } else {
                        None
                    };
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_content("error", truncated.to_string());
                    if state.turn_is_open {
                        rows.push(row);
                    } else {
                        state.pending_session_rows.push(row);
                    }
                }
            }

            TypedEventData::CompactionComplete(d) => {
                if let Some(ref summary) = d.summary_content
                    && !summary.is_empty()
                {
                    let truncated = truncate_utf8(summary, MAX_COMPACTION_BYTES);
                    let turn = if state.turn_is_open && state.current_turn >= 0 {
                        Some(state.current_turn)
                    } else {
                        None
                    };
                    let metadata = d
                        .checkpoint_number
                        .map(|n| serde_json::json!({"checkpoint": n}).to_string());
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_metadata("compaction_summary", truncated.to_string(), metadata);
                    if state.turn_is_open {
                        rows.push(row);
                    } else {
                        state.pending_session_rows.push(row);
                    }
                }
            }

            TypedEventData::SystemMessage(d) => {
                if let Some(ref content) = d.content
                    && !content.is_empty()
                {
                    let truncated = truncate_utf8(content, MAX_SYSTEM_MESSAGE_BYTES);
                    let turn = if state.turn_is_open && state.current_turn >= 0 {
                        Some(state.current_turn)
                    } else {
                        None
                    };
                    let metadata = d
                        .role
                        .as_ref()
                        .map(|r| serde_json::json!({"role": r}).to_string());
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_metadata("system_message", truncated.to_string(), metadata);
                    if state.turn_is_open {
                        rows.push(row);
                    } else {
                        state.pending_session_rows.push(row);
                    }
                }
            }

            TypedEventData::SubagentStarted(d) => {
                if state.ensure_turn() {
                    state.flush_pending(&mut rows);
                }
                let mut parts = Vec::new();
                if let Some(ref name) = d.agent_name {
                    parts.push(name.clone());
                }
                if let Some(ref display) = d.agent_display_name {
                    parts.push(display.clone());
                }
                let content = parts.join(" — ");
                if !content.is_empty() {
                    let row = SearchContentRowBuilder::new(
                        session_id,
                        Some(state.current_turn),
                        idx,
                        ts_unix,
                    )
                    .with_content("subagent", content);
                    rows.push(row);
                }
            }

            // TurnEnd/Abort close the current turn (mirrors reconstructor's finalize_current_turn)
            TypedEventData::TurnEnd(_) | TypedEventData::Abort(_) => {
                state.turn_is_open = false;
            }

            // All other event types are not indexed for FTS
            _ => {}
        }
    }

    // Any session rows still pending (no subsequent turn opened) keep turn_number: None
    state.finish(&mut rows);
    rows
}
