//! Deep FTS content extraction and writing.
//!
//! Extracts searchable content from session events into `search_content` rows.
//! Each row represents one searchable chunk (a message, tool call, error, etc.)
//! with a content type, turn number, and event index for deep-linking.

use anyhow::Result;
use rusqlite::params;
use std::path::Path;

use tracepilot_core::parsing::events::{TypedEvent, TypedEventData};
use tracepilot_core::utils::truncate_utf8;

use super::IndexDb;

/// Bump when extraction logic changes (new content types, field mapping, etc.)
/// to force re-indexing even when events.jsonl hasn't changed.
pub const CURRENT_EXTRACTOR_VERSION: i64 = 1;

/// Maximum bytes for individual content fields.
const MAX_TOOL_CALL_BYTES: usize = 10_000;
const MAX_TOOL_ERROR_BYTES: usize = 5_000;
const MAX_ERROR_BYTES: usize = 5_000;
const MAX_COMPACTION_BYTES: usize = 10_000;
const MAX_SYSTEM_MESSAGE_BYTES: usize = 10_000;

/// A single row to be inserted into `search_content`.
#[derive(Debug)]
pub struct SearchContentRow {
    pub session_id: String,
    pub content_type: &'static str,
    pub turn_number: Option<i64>,
    pub event_index: i64,
    pub timestamp_unix: Option<i64>,
    pub tool_name: Option<String>,
    pub content: String,
    pub metadata_json: Option<String>,
}

impl IndexDb {
    /// Check whether a session needs its search content re-indexed.
    pub fn needs_search_reindex(&self, session_id: &str, session_path: &Path) -> bool {
        let current_events = super::types::get_events_mtime_and_size(session_path);

        let stored: Option<(Option<String>, Option<String>, Option<i64>, Option<i64>)> = self
            .conn
            .query_row(
                "SELECT search_indexed_at, events_mtime, events_size, search_extractor_version
                 FROM sessions WHERE id = ?1",
                [session_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .ok();

        let Some((search_indexed_at, stored_ev_mtime, stored_ev_size, extractor_ver)) = stored
        else {
            return true; // not in DB at all
        };

        // Never indexed
        if search_indexed_at.is_none() {
            return true;
        }

        // Extractor version changed
        if extractor_ver.unwrap_or(0) < CURRENT_EXTRACTOR_VERSION {
            return true;
        }

        // Events file changed (mtime or size)
        match (&current_events, &stored_ev_mtime) {
            (Some((cur_mtime, cur_size)), Some(st_mtime)) => {
                if cur_mtime != st_mtime || Some(*cur_size as i64) != stored_ev_size {
                    return true;
                }
            }
            (Some(_), None) => return true,
            (None, Some(_)) => return true,
            (None, None) => {}
        }

        // Compare search_indexed_at < events_mtime
        if let (Some(sia), Some(em)) = (&search_indexed_at, &stored_ev_mtime) {
            if sia < em {
                return true;
            }
        }

        false
    }

    /// Index search content for a single session.
    /// Deletes existing content and inserts new rows, all within a transaction.
    pub fn upsert_search_content(
        &self,
        session_id: &str,
        rows: &[SearchContentRow],
    ) -> Result<usize> {
        self.conn.execute_batch("SAVEPOINT upsert_search")?;

        let result = (|| -> Result<usize> {
            // Delete existing search content for this session
            self.conn.execute(
                "DELETE FROM search_content WHERE session_id = ?1",
                [session_id],
            )?;

            // Batch insert new content
            let mut stmt = self.conn.prepare(
                "INSERT INTO search_content
                    (session_id, content_type, turn_number, event_index,
                     timestamp_unix, tool_name, content, metadata_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;

            let mut inserted = 0;
            for row in rows {
                if row.content.is_empty() {
                    continue;
                }
                stmt.execute(params![
                    row.session_id,
                    row.content_type,
                    row.turn_number,
                    row.event_index,
                    row.timestamp_unix,
                    row.tool_name,
                    row.content,
                    row.metadata_json,
                ])?;
                inserted += 1;
            }

            // Update search indexing timestamp and extractor version
            let now = chrono::Utc::now().to_rfc3339();
            self.conn.execute(
                "UPDATE sessions SET search_indexed_at = ?1, search_extractor_version = ?2
                 WHERE id = ?3",
                params![now, CURRENT_EXTRACTOR_VERSION, session_id],
            )?;

            Ok(inserted)
        })();

        match result {
            Ok(count) => {
                self.conn.execute_batch("RELEASE upsert_search")?;
                Ok(count)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK TO upsert_search");
                let _ = self.conn.execute_batch("RELEASE upsert_search");
                Err(e)
            }
        }
    }

    /// Clear all search content and reset search_indexed_at for all sessions.
    pub fn clear_search_content(&self) -> Result<()> {
        self.conn.execute_batch(
            "BEGIN;
             DELETE FROM search_content;
             UPDATE sessions SET search_indexed_at = NULL, search_extractor_version = 0;
             COMMIT;",
        )?;
        Ok(())
    }
}

/// Extract searchable content rows from a session's typed events.
/// This is a pure function with no database interaction — safe to call
/// outside of a transaction to avoid holding locks during CPU work.
pub fn extract_search_content(
    session_id: &str,
    events: &[TypedEvent],
) -> Vec<SearchContentRow> {
    let mut rows = Vec::with_capacity(events.len() / 2);
    let mut current_turn: i64 = 0;
    // Map tool_call_id → tool_name for carrying names to completion events
    let mut tool_names: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for (event_index, event) in events.iter().enumerate() {
        let ts_unix = event.raw.timestamp.map(|t| t.timestamp());
        let idx = event_index as i64;

        match &event.typed_data {
            TypedEventData::TurnStart(_) => {
                current_turn += 1;
            }

            TypedEventData::UserMessage(d) => {
                if let Some(ref content) = d.content {
                    if !content.is_empty() {
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
            }

            TypedEventData::AssistantMessage(d) => {
                if let Some(ref content) = d.content {
                    if !content.is_empty() {
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "assistant_message",
                            turn_number: Some(current_turn),
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: None,
                            content: content.clone(),
                            metadata_json: None,
                        });
                    }
                }
                // Also index reasoning text if present
                if let Some(ref reasoning) = d.reasoning_text {
                    if !reasoning.is_empty() {
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "reasoning",
                            turn_number: Some(current_turn),
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: None,
                            content: reasoning.clone(),
                            metadata_json: None,
                        });
                    }
                }
            }

            TypedEventData::AssistantReasoning(d) => {
                if let Some(ref content) = d.content {
                    if !content.is_empty() {
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "reasoning",
                            turn_number: Some(current_turn),
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: None,
                            content: content.clone(),
                            metadata_json: None,
                        });
                    }
                }
            }

            TypedEventData::ToolExecutionStart(d) => {
                let name = d
                    .tool_name
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string());

                // Remember tool name for completion events
                if let Some(ref id) = d.tool_call_id {
                    tool_names.insert(id.clone(), name.clone());
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
                // Index tool errors
                if let Some(ref error) = d.error {
                    let error_text = flatten_json_value(error);
                    if !error_text.is_empty() {
                        let tool_name = d
                            .tool_call_id
                            .as_ref()
                            .and_then(|id| tool_names.get(id))
                            .cloned();
                        let truncated = truncate_utf8(&error_text, MAX_TOOL_ERROR_BYTES);
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "tool_error",
                            turn_number: Some(current_turn),
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name,
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
                    rows.push(SearchContentRow {
                        session_id: session_id.to_string(),
                        content_type: "error",
                        turn_number: Some(current_turn),
                        event_index: idx,
                        timestamp_unix: ts_unix,
                        tool_name: None,
                        content: truncated.to_string(),
                        metadata_json: None,
                    });
                }
            }

            TypedEventData::CompactionComplete(d) => {
                if let Some(ref summary) = d.summary_content {
                    if !summary.is_empty() {
                        let truncated = truncate_utf8(summary, MAX_COMPACTION_BYTES);
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "compaction_summary",
                            turn_number: Some(current_turn),
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: None,
                            content: truncated.to_string(),
                            metadata_json: d
                                .checkpoint_number
                                .map(|n| serde_json::json!({"checkpoint": n}).to_string()),
                        });
                    }
                }
            }

            TypedEventData::SystemMessage(d) => {
                if let Some(ref content) = d.content {
                    if !content.is_empty() {
                        let truncated = truncate_utf8(content, MAX_SYSTEM_MESSAGE_BYTES);
                        rows.push(SearchContentRow {
                            session_id: session_id.to_string(),
                            content_type: "system_message",
                            turn_number: Some(current_turn),
                            event_index: idx,
                            timestamp_unix: ts_unix,
                            tool_name: None,
                            content: truncated.to_string(),
                            metadata_json: d.role.as_ref().map(|r| {
                                serde_json::json!({"role": r}).to_string()
                            }),
                        });
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
                if let Some(ref desc) = d.agent_description {
                    parts.push(desc.clone());
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

            // All other event types are not indexed for FTS
            _ => {}
        }
    }

    rows
}

/// Flatten a serde_json::Value into a searchable text string.
/// Objects have their values concatenated, arrays are joined, etc.
fn flatten_json_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Null => String::new(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .map(flatten_json_value)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        serde_json::Value::Object(map) => map
            .values()
            .map(flatten_json_value)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_flatten_json_string() {
        let v = serde_json::json!("hello world");
        assert_eq!(flatten_json_value(&v), "hello world");
    }

    #[test]
    fn test_flatten_json_object() {
        let v = serde_json::json!({"path": "/src/main.rs", "content": "fn main() {}"});
        let text = flatten_json_value(&v);
        assert!(text.contains("/src/main.rs"));
        assert!(text.contains("fn main() {}"));
    }

    #[test]
    fn test_flatten_json_nested() {
        let v = serde_json::json!({"args": {"file": "test.rs"}, "extra": null});
        let text = flatten_json_value(&v);
        assert!(text.contains("test.rs"));
        assert!(!text.contains("null"));
    }

    #[test]
    fn test_flatten_json_null() {
        let v = serde_json::Value::Null;
        assert_eq!(flatten_json_value(&v), "");
    }
}
