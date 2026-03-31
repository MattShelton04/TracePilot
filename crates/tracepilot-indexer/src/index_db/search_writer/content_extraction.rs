//! Pure content extraction from session events into searchable rows.
//!
//! `extract_search_content` converts a sequence of typed session events into
//! `SearchContentRow` entries suitable for FTS indexing. This is a pure function
//! with no database interaction — safe to call outside of a transaction.

use super::tool_extraction::{extract_tool_result, flatten_json_value};
use super::SearchContentRow;
use tracepilot_core::parsing::events::{TypedEvent, TypedEventData};
use tracepilot_core::utils::truncate_utf8;

/// Maximum bytes for individual content fields.
const MAX_TOOL_CALL_BYTES: usize = 2_000;
const MAX_TOOL_RESULT_BYTES: usize = 800;
const MAX_TOOL_ERROR_BYTES: usize = 2_000;
const MAX_ERROR_BYTES: usize = 2_000;
const MAX_COMPACTION_BYTES: usize = 3_000;
const MAX_SYSTEM_MESSAGE_BYTES: usize = 3_000;
const MAX_ASSISTANT_MESSAGE_BYTES: usize = 5_000;
const MAX_REASONING_BYTES: usize = 4_000;

/// Tools whose results add negligible search value (session management, status).
/// Both tool_call and tool_result are skipped for these tools.
const SKIP_TOOLS: &[&str] = &[
    "list_agents",
    "list_powershell",
    "stop_powershell",
    "write_powershell",
    "read_agent",
    "fetch_copilot_cli_documentation",
];

/// Tools where the call contains useful info but the result is boilerplate.
/// tool_call is indexed, tool_result is skipped.
const SKIP_RESULT_ONLY_TOOLS: &[&str] = &[
    "store_memory",
    "report_intent",
    "task",
];

/// Extract searchable content rows from a session's typed events.
/// This is a pure function with no database interaction — safe to call
/// outside of a transaction to avoid holding locks during CPU work.
pub fn extract_search_content(
    session_id: &str,
    events: &[TypedEvent],
) -> Vec<SearchContentRow> {
    let mut rows = Vec::with_capacity(events.len() / 2);
    // Track turn number matching the reconstructor's turnIndex (0-based).
    // The reconstructor creates new turns on: UserMessage (always), and
    // ensure_current_turn (when current_turn is None after TurnEnd/Abort).
    let mut current_turn: i64 = -1;
    let mut turn_is_open = false;
    // Map tool_call_id → (tool_name, turn_number) for carrying to completion events
    let mut tool_info: std::collections::HashMap<String, (String, i64)> =
        std::collections::HashMap::new();
    // Session-level rows emitted between turns, flushed into the next turn
    let mut pending_session_rows: Vec<SearchContentRow> = Vec::new();

    /// Open a new turn if none is currently open (mirrors `ensure_current_turn`).
    /// Returns true if a new turn was opened.
    #[inline]
    fn ensure_turn(current_turn: &mut i64, turn_is_open: &mut bool) -> bool {
        if !*turn_is_open {
            *current_turn += 1;
            *turn_is_open = true;
            true
        } else {
            false
        }
    }

    /// Flush buffered session-level rows, assigning them to the given turn.
    #[inline]
    fn flush_pending(
        pending: &mut Vec<SearchContentRow>,
        rows: &mut Vec<SearchContentRow>,
        turn: i64,
    ) {
        for mut row in pending.drain(..) {
            row.turn_number = Some(turn);
            rows.push(row);
        }
    }

    for (event_index, event) in events.iter().enumerate() {
        let ts_unix = event.raw.timestamp.map(|t| t.timestamp());
        let idx = event_index as i64;

        match &event.typed_data {
            // TurnStart opens a turn if none is open (mirrors ensure_current_turn).
            // After a TurnEnd closes a turn, the next TurnStart begins a new one.
            TypedEventData::TurnStart(_) => {
                if ensure_turn(&mut current_turn, &mut turn_is_open) {
                    flush_pending(&mut pending_session_rows, &mut rows, current_turn);
                }
            }

            TypedEventData::UserMessage(d) => {
                // UserMessage always opens a new turn (mirrors reconstructor:
                // finalize_current_turn + new_turn).
                current_turn += 1;
                turn_is_open = true;
                flush_pending(&mut pending_session_rows, &mut rows, current_turn);
                if let Some(ref content) = d.content
                    && !content.is_empty() {
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "user_message",
                            turn_number: Some(current_turn),
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: None,
                            content: content.clone(),
                            metadata_json: None,
                        });
                    }
            }

            TypedEventData::AssistantMessage(d) => {
                if ensure_turn(&mut current_turn, &mut turn_is_open) {
                    flush_pending(&mut pending_session_rows, &mut rows, current_turn);
                }
                if let Some(ref content) = d.content
                    && !content.is_empty() {
                        let truncated = truncate_utf8(content, MAX_ASSISTANT_MESSAGE_BYTES);
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "assistant_message",
                            turn_number: Some(current_turn),
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: None,
                            content: truncated.to_string(),
                            metadata_json: None,
                        });
                    }
                // Also index reasoning text if present
                if let Some(ref reasoning) = d.reasoning_text
                    && !reasoning.is_empty() {
                        let truncated = truncate_utf8(reasoning, MAX_REASONING_BYTES);
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "reasoning",
                            turn_number: Some(current_turn),
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: None,
                            content: truncated.to_string(),
                            metadata_json: None,
                        });
                    }
            }

            TypedEventData::AssistantReasoning(d) => {
                if ensure_turn(&mut current_turn, &mut turn_is_open) {
                    flush_pending(&mut pending_session_rows, &mut rows, current_turn);
                }
                if let Some(ref content) = d.content
                    && !content.is_empty() {
                        let truncated = truncate_utf8(content, MAX_REASONING_BYTES);
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "reasoning",
                            turn_number: Some(current_turn),
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: None,
                            content: truncated.to_string(),
                            metadata_json: None,
                        });
                    }
            }

            TypedEventData::ToolExecutionStart(d) => {
                if ensure_turn(&mut current_turn, &mut turn_is_open) {
                    flush_pending(&mut pending_session_rows, &mut rows, current_turn);
                }
                let name = d
                    .tool_name
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string());

                // Remember tool name and turn for completion events
                if let Some(ref id) = d.tool_call_id {
                    tool_info.insert(id.clone(), (name.clone(), current_turn));
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
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "tool_call",
                            turn_number: Some(current_turn),
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: Some(name),
                            content: truncated.to_string(),
                            metadata_json: None,
                        });
                    }
                }
            }

            TypedEventData::ToolExecutionComplete(d) => {
                let info = d
                    .tool_call_id
                    .as_ref()
                    .and_then(|id| tool_info.get(id));
                let tool_name = info.map(|(name, _)| name.clone());
                let completion_turn = info.map(|(_, t)| *t)
                    .unwrap_or(current_turn);
                let name_lower = tool_name
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase();

                // Skip tools that add negligible search value
                if SKIP_TOOLS.iter().any(|s| s.to_lowercase() == name_lower) {
                    continue;
                }

                // Index tool errors
                if let Some(ref error) = d.error {
                    let error_text = flatten_json_value(error);
                    if !error_text.is_empty() {
                        let truncated = truncate_utf8(&error_text, MAX_TOOL_ERROR_BYTES);
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "tool_error",
                            turn_number: if completion_turn >= 0 { Some(completion_turn) } else { None },
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: tool_name.clone(),
                            content: truncated.to_string(),
                            metadata_json: None,
                        });
                    }
                    continue;
                }

                // Skip result-only tools (call is indexed, result is boilerplate)
                if SKIP_RESULT_ONLY_TOOLS.iter().any(|s| s.to_lowercase() == name_lower) {
                    continue;
                }

                // Index successful tool results
                if let Some(ref result) = d.result {
                    let content = extract_tool_result(&name_lower, result);
                    if !content.is_empty() {
                        let truncated = truncate_utf8(&content, MAX_TOOL_RESULT_BYTES);
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "tool_result",
                            turn_number: if completion_turn >= 0 { Some(completion_turn) } else { None },
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: tool_name.clone(),
                            content: truncated.to_string(),
                            metadata_json: None,
                        });
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
                    let row = SearchContentRow {
                        session_id: session_id.to_string(),
                        content_type: "error",
                        turn_number: if turn_is_open && current_turn >= 0 { Some(current_turn) } else { None },
                        event_index: idx,
                        timestamp_unix: ts_unix,
                        tool_name: None,
                        content: truncated.to_string(),
                        metadata_json: None,
                    };
                    if turn_is_open {
                        rows.push(row);
                    } else {
                        pending_session_rows.push(row);
                    }
                }
            }

            TypedEventData::CompactionComplete(d) => {
                if let Some(ref summary) = d.summary_content
                    && !summary.is_empty() {
                        let truncated = truncate_utf8(summary, MAX_COMPACTION_BYTES);
                        let row = SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "compaction_summary",
                            turn_number: if turn_is_open && current_turn >= 0 { Some(current_turn) } else { None },
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: None,
                            content: truncated.to_string(),
                            metadata_json: d
                                .checkpoint_number
                                .map(|n| serde_json::json!({"checkpoint": n}).to_string()),
                        };
                        if turn_is_open {
                            rows.push(row);
                        } else {
                            pending_session_rows.push(row);
                        }
                    }
            }

            TypedEventData::SystemMessage(d) => {
                if let Some(ref content) = d.content
                    && !content.is_empty() {
                        let truncated = truncate_utf8(content, MAX_SYSTEM_MESSAGE_BYTES);
                        let row = SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "system_message",
                            turn_number: if turn_is_open && current_turn >= 0 { Some(current_turn) } else { None },
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: None,
                            content: truncated.to_string(),
                            metadata_json: d.role.as_ref().map(|r| {
                                serde_json::json!({"role": r}).to_string()
                            }),
                        };
                        if turn_is_open {
                            rows.push(row);
                        } else {
                            pending_session_rows.push(row);
                        }
                    }
            }

            TypedEventData::SubagentStarted(d) => {
                if ensure_turn(&mut current_turn, &mut turn_is_open) {
                    flush_pending(&mut pending_session_rows, &mut rows, current_turn);
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
                    rows.push(SearchContentRow {
                        session_id: session_id.to_string(),
                        content_type: "subagent",
                        turn_number: Some(current_turn),
                        event_index: idx,
                        timestamp_unix: ts_unix,
                        tool_name: None,
                        content,
                        metadata_json: None,
                    });
                }
            }

            // TurnEnd/Abort close the current turn (mirrors reconstructor's finalize_current_turn)
            TypedEventData::TurnEnd(_) | TypedEventData::Abort(_) => {
                turn_is_open = false;
            }

            // All other event types are not indexed for FTS
            _ => {}
        }
    }

    // Any session rows still pending (no subsequent turn opened) keep turn_number: None
    rows.append(&mut pending_session_rows);
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skip_tools_list() {
        // Verify read_powershell is NOT in skip list (we want async output indexed)
        assert!(!SKIP_TOOLS.contains(&"read_powershell"));
        // These should be skipped
        assert!(SKIP_TOOLS.contains(&"list_agents"));
        assert!(SKIP_TOOLS.contains(&"list_powershell"));
        assert!(SKIP_TOOLS.contains(&"stop_powershell"));
        assert!(SKIP_TOOLS.contains(&"write_powershell"));
        assert!(SKIP_TOOLS.contains(&"read_agent"));
        assert!(SKIP_TOOLS.contains(&"fetch_copilot_cli_documentation"));
    }

    #[test]
    fn test_skip_result_only_tools() {
        assert!(SKIP_RESULT_ONLY_TOOLS.contains(&"store_memory"));
        assert!(SKIP_RESULT_ONLY_TOOLS.contains(&"report_intent"));
        assert!(SKIP_RESULT_ONLY_TOOLS.contains(&"task"));
    }
}
