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
/// The rule is the same for every source: prompts, messages, visible
/// reasoning and tool text are searchable. Only canonical event types are
/// matched, so prompt attachments (never read from `UserMessage`) and the
/// native-only records a source keeps for the Events tab (`Unknown` types
/// with `Other` data: attachments, bookkeeping) are not.
///
/// Accepts a validated [`SessionId`](tracepilot_core::ids::SessionId) so
/// callers cannot accidentally stamp rows with a task/job identifier.
pub fn extract_search_content(
    session_id: &tracepilot_core::ids::SessionId,
    events: &[TypedEvent],
) -> Vec<SearchContentRow> {
    extract_search_content_cancellable(session_id, events, &|| false).unwrap_or_default()
}

pub(crate) fn extract_search_content_cancellable(
    session_id: &tracepilot_core::ids::SessionId,
    events: &[TypedEvent],
    is_cancelled: &impl Fn() -> bool,
) -> Option<Vec<SearchContentRow>> {
    let session_id = session_id.as_str();
    let mut rows = Vec::with_capacity(events.len() / 2);
    let mut turns = TurnReconstructor::with_agent_ownership(events);
    let mut tool_names = HashMap::new();
    let mut native_tool_names = HashMap::new();
    let mut pending_rows: Vec<SearchContentRow> = Vec::new();

    for (event_index, event) in events.iter().enumerate() {
        if is_cancelled() {
            return None;
        }
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
                    // A notification wake's lines were written by the tool,
                    // not the user (only Claude Code records notifications).
                    let content_type = if d.notifications.is_empty() {
                        "user_message"
                    } else {
                        "system_message"
                    };
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_content(content_type, content.clone());
                    rows.push(row);
                }
                // A notification's message is one short line per task; the
                // agent's report and the Monitor's event stay searchable here.
                for note in &d.notifications {
                    for text in [&note.result, &note.event].into_iter().flatten() {
                        let truncated = truncate_utf8(text, MAX_SYSTEM_MESSAGE_BYTES);
                        let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                            .with_content("system_message", truncated.to_string());
                        rows.push(row);
                    }
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
                if let Some(reasoning) = d.visible_reasoning() {
                    let truncated = truncate_utf8(&reasoning, MAX_REASONING_BYTES);
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
                    if let Some(native) = &d.native_tool_name {
                        native_tool_names.insert(id.clone(), native.clone());
                    }
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
                        let mut row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                            .with_tool_content("tool_call", Some(name), truncated.to_string());
                        row.metadata_json = native_tool_metadata(d.native_tool_name.as_ref());
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
                let native_metadata = native_tool_metadata(
                    d.tool_call_id
                        .as_ref()
                        .and_then(|id| native_tool_names.get(id)),
                );

                // Skip tools that add negligible search value
                if SKIP_TOOLS.iter().any(|s| s.to_lowercase() == name_lower) {
                    continue;
                }

                // Index tool errors
                if let Some(ref error) = d.error {
                    let error_text = flatten_json_value(error);
                    if !error_text.is_empty() {
                        let truncated = truncate_utf8(&error_text, MAX_TOOL_ERROR_BYTES);
                        let mut row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                            .with_tool_content(
                                "tool_error",
                                tool_name.clone(),
                                truncated.to_string(),
                            );
                        row.metadata_json = native_metadata;
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
                        let mut row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                            .with_tool_content(
                                "tool_result",
                                tool_name.clone(),
                                truncated.to_string(),
                            );
                        row.metadata_json = native_metadata;
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
    Some(rows)
}

/// Metadata naming a tool row's source-native tool (Claude Code's `Bash`),
/// so results can show the name the session used. `tool_name` stays
/// canonical for the `tool:` filter.
fn native_tool_metadata(native: Option<&String>) -> Option<String> {
    native.map(|name| serde_json::json!({ "nativeToolName": name }).to_string())
}
