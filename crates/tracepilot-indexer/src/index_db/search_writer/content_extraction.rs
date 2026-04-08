//! Pure content extraction from session events into searchable rows.
//!
//! `extract_search_content` converts a sequence of typed session events into
//! `SearchContentRow` entries suitable for FTS indexing. This is a pure function
//! with no database interaction — safe to call outside of a transaction.

use super::SearchContentRow;
use super::tool_extraction::{extract_tool_result, flatten_json_value};
use tracepilot_core::parsing::events::{TypedEvent, TypedEventData};
use tracepilot_core::utils::truncate_utf8;

/// Builder for SearchContentRow that captures common fields and reduces boilerplate.
///
/// The builder pattern eliminates repetitive struct construction across 25+ call sites,
/// making the code more maintainable and reducing the risk of errors when adding new fields.
///
/// # Lifetime Parameter
///
/// The `'a` lifetime parameter allows borrowing `session_id` without allocation during
/// builder construction. The string is only cloned once in the terminal method.
#[must_use = "SearchContentRowBuilder does nothing unless consumed by a terminal method"]
struct SearchContentRowBuilder<'a> {
    session_id: &'a str,
    turn_number: Option<i64>,
    event_index: i64,
    timestamp_unix: Option<i64>,
}

impl<'a> SearchContentRowBuilder<'a> {
    /// Create a new builder with common fields that are the same for all rows in a turn.
    #[inline]
    fn new(
        session_id: &'a str,
        turn_number: Option<i64>,
        event_index: i64,
        timestamp_unix: Option<i64>,
    ) -> Self {
        Self {
            session_id,
            turn_number,
            event_index,
            timestamp_unix,
        }
    }

    /// Build a row with content only (no tool name, no metadata).
    #[inline]
    fn with_content(self, content_type: &'static str, content: String) -> SearchContentRow {
        SearchContentRow {
            session_id: self.session_id.to_string(),
            content_type,
            turn_number: self.turn_number,
            event_index: self.event_index,
            timestamp_unix: self.timestamp_unix,
            tool_name: None,
            content,
            metadata_json: None,
        }
    }

    /// Build a row with tool name and content (no metadata).
    #[inline]
    fn with_tool_content(
        self,
        content_type: &'static str,
        tool_name: Option<String>,
        content: String,
    ) -> SearchContentRow {
        SearchContentRow {
            session_id: self.session_id.to_string(),
            content_type,
            turn_number: self.turn_number,
            event_index: self.event_index,
            timestamp_unix: self.timestamp_unix,
            tool_name,
            content,
            metadata_json: None,
        }
    }

    /// Build a row with content and optional metadata (no tool name).
    #[inline]
    fn with_metadata(
        self,
        content_type: &'static str,
        content: String,
        metadata_json: Option<String>,
    ) -> SearchContentRow {
        SearchContentRow {
            session_id: self.session_id.to_string(),
            content_type,
            turn_number: self.turn_number,
            event_index: self.event_index,
            timestamp_unix: self.timestamp_unix,
            tool_name: None,
            content,
            metadata_json,
        }
    }
}

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
const SKIP_RESULT_ONLY_TOOLS: &[&str] = &["store_memory", "report_intent", "task"];

/// Extract searchable content rows from a session's typed events.
/// This is a pure function with no database interaction — safe to call
/// outside of a transaction to avoid holding locks during CPU work.
pub fn extract_search_content(session_id: &str, events: &[TypedEvent]) -> Vec<SearchContentRow> {
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
                    && !content.is_empty()
                {
                    let row =
                        SearchContentRowBuilder::new(session_id, Some(current_turn), idx, ts_unix)
                            .with_content("user_message", content.clone());
                    rows.push(row);
                }
            }

            TypedEventData::AssistantMessage(d) => {
                if ensure_turn(&mut current_turn, &mut turn_is_open) {
                    flush_pending(&mut pending_session_rows, &mut rows, current_turn);
                }
                if let Some(ref content) = d.content
                    && !content.is_empty()
                {
                    let truncated = truncate_utf8(content, MAX_ASSISTANT_MESSAGE_BYTES);
                    let row =
                        SearchContentRowBuilder::new(session_id, Some(current_turn), idx, ts_unix)
                            .with_content("assistant_message", truncated.to_string());
                    rows.push(row);
                }
                // Also index reasoning text if present
                if let Some(ref reasoning) = d.reasoning_text
                    && !reasoning.is_empty()
                {
                    let truncated = truncate_utf8(reasoning, MAX_REASONING_BYTES);
                    let row =
                        SearchContentRowBuilder::new(session_id, Some(current_turn), idx, ts_unix)
                            .with_content("reasoning", truncated.to_string());
                    rows.push(row);
                }
            }

            TypedEventData::AssistantReasoning(d) => {
                if ensure_turn(&mut current_turn, &mut turn_is_open) {
                    flush_pending(&mut pending_session_rows, &mut rows, current_turn);
                }
                if let Some(ref content) = d.content
                    && !content.is_empty()
                {
                    let truncated = truncate_utf8(content, MAX_REASONING_BYTES);
                    let row =
                        SearchContentRowBuilder::new(session_id, Some(current_turn), idx, ts_unix)
                            .with_content("reasoning", truncated.to_string());
                    rows.push(row);
                }
            }

            TypedEventData::ToolExecutionStart(d) => {
                if ensure_turn(&mut current_turn, &mut turn_is_open) {
                    flush_pending(&mut pending_session_rows, &mut rows, current_turn);
                }
                let name = d.tool_name.clone().unwrap_or_else(|| "unknown".to_string());

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
                        let row = SearchContentRowBuilder::new(
                            session_id,
                            Some(current_turn),
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
                let info = d.tool_call_id.as_ref().and_then(|id| tool_info.get(id));
                let tool_name = info.map(|(name, _)| name.clone());
                let completion_turn = info.map(|(_, t)| *t).unwrap_or(current_turn);
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
                    let turn = if turn_is_open && current_turn >= 0 {
                        Some(current_turn)
                    } else {
                        None
                    };
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_content("error", truncated.to_string());
                    if turn_is_open {
                        rows.push(row);
                    } else {
                        pending_session_rows.push(row);
                    }
                }
            }

            TypedEventData::CompactionComplete(d) => {
                if let Some(ref summary) = d.summary_content
                    && !summary.is_empty()
                {
                    let truncated = truncate_utf8(summary, MAX_COMPACTION_BYTES);
                    let turn = if turn_is_open && current_turn >= 0 {
                        Some(current_turn)
                    } else {
                        None
                    };
                    let metadata = d
                        .checkpoint_number
                        .map(|n| serde_json::json!({"checkpoint": n}).to_string());
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_metadata("compaction_summary", truncated.to_string(), metadata);
                    if turn_is_open {
                        rows.push(row);
                    } else {
                        pending_session_rows.push(row);
                    }
                }
            }

            TypedEventData::SystemMessage(d) => {
                if let Some(ref content) = d.content
                    && !content.is_empty()
                {
                    let truncated = truncate_utf8(content, MAX_SYSTEM_MESSAGE_BYTES);
                    let turn = if turn_is_open && current_turn >= 0 {
                        Some(current_turn)
                    } else {
                        None
                    };
                    let metadata = d
                        .role
                        .as_ref()
                        .map(|r| serde_json::json!({"role": r}).to_string());
                    let row = SearchContentRowBuilder::new(session_id, turn, idx, ts_unix)
                        .with_metadata("system_message", truncated.to_string(), metadata);
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
                    let row =
                        SearchContentRowBuilder::new(session_id, Some(current_turn), idx, ts_unix)
                            .with_content("subagent", content);
                    rows.push(row);
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

    #[test]
    fn builder_constructs_row_with_content_only() {
        let builder = SearchContentRowBuilder::new("sess-1", Some(0), 5, Some(123456789));
        let row = builder.with_content("user_message", "Hello".to_string());

        assert_eq!(row.session_id, "sess-1");
        assert_eq!(row.content_type, "user_message");
        assert_eq!(row.turn_number, Some(0));
        assert_eq!(row.event_index, 5);
        assert_eq!(row.timestamp_unix, Some(123456789));
        assert_eq!(row.tool_name, None);
        assert_eq!(row.content, "Hello");
        assert_eq!(row.metadata_json, None);
    }

    #[test]
    fn builder_constructs_row_with_tool_content() {
        let builder = SearchContentRowBuilder::new("sess-2", Some(1), 10, None);
        let row =
            builder.with_tool_content("tool_call", Some("view".to_string()), "file.rs".to_string());

        assert_eq!(row.session_id, "sess-2");
        assert_eq!(row.content_type, "tool_call");
        assert_eq!(row.turn_number, Some(1));
        assert_eq!(row.event_index, 10);
        assert_eq!(row.timestamp_unix, None);
        assert_eq!(row.tool_name, Some("view".to_string()));
        assert_eq!(row.content, "file.rs");
        assert_eq!(row.metadata_json, None);
    }

    #[test]
    fn builder_constructs_row_with_metadata() {
        let builder = SearchContentRowBuilder::new("sess-3", None, 15, Some(987654321));
        let row = builder.with_metadata(
            "compaction_summary",
            "Compacted 50 messages".to_string(),
            Some(r#"{"checkpoint":3}"#.to_string()),
        );

        assert_eq!(row.session_id, "sess-3");
        assert_eq!(row.content_type, "compaction_summary");
        assert_eq!(row.turn_number, None);
        assert_eq!(row.event_index, 15);
        assert_eq!(row.timestamp_unix, Some(987654321));
        assert_eq!(row.tool_name, None);
        assert_eq!(row.content, "Compacted 50 messages");
        assert_eq!(row.metadata_json, Some(r#"{"checkpoint":3}"#.to_string()));
    }

    #[test]
    fn builder_handles_none_optional_fields() {
        let builder = SearchContentRowBuilder::new("sess-4", None, 20, None);
        let row = builder.with_tool_content("tool_error", None, "error message".to_string());

        assert_eq!(row.turn_number, None);
        assert_eq!(row.timestamp_unix, None);
        assert_eq!(row.tool_name, None);
    }
}
