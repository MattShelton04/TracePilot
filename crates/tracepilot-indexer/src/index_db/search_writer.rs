//! Deep FTS content extraction and writing.
//!
//! Extracts searchable content from session events into `search_content` rows.
//! Each row represents one searchable chunk (a message, tool call, error, etc.)
//! with a content type, turn number, and event index for deep-linking.

use crate::Result;
use rusqlite::params;
use std::path::Path;

use tracepilot_core::parsing::events::{TypedEvent, TypedEventData};
use tracepilot_core::utils::truncate_utf8;

use super::IndexDb;

/// Bump when extraction logic changes (new content types, field mapping, etc.)
/// to force re-indexing even when events.jsonl hasn't changed.
pub const CURRENT_EXTRACTOR_VERSION: i64 = 2;

/// Maximum bytes for individual content fields.
const MAX_TOOL_CALL_BYTES: usize = 2_000;
const MAX_TOOL_RESULT_BYTES: usize = 800;
const MAX_TOOL_ERROR_BYTES: usize = 2_000;
const MAX_ERROR_BYTES: usize = 2_000;
const MAX_COMPACTION_BYTES: usize = 3_000;
const MAX_SYSTEM_MESSAGE_BYTES: usize = 3_000;
const MAX_ASSISTANT_MESSAGE_BYTES: usize = 5_000;
const MAX_REASONING_BYTES: usize = 4_000;

/// Per-extractor internal limits for tool result fields.
const EXTRACT_VIEW_CONTENT: usize = 400;
const EXTRACT_VIEW_PATH_PLUS: usize = 500;
const EXTRACT_SHELL_OUTPUT: usize = 400;
const EXTRACT_SHELL_FALLBACK: usize = 500;
const EXTRACT_SHELL_STDERR: usize = 600;
const EXTRACT_GREP_BYTES: usize = 2000;
const EXTRACT_EDIT_CONTENT: usize = 300;
const EXTRACT_EDIT_FALLBACK: usize = 400;
const EXTRACT_GENERIC_BYTES: usize = 400;

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

    /// Bulk-write search content for multiple sessions, bypassing per-row FTS triggers.
    ///
    /// Instead of firing FTS5 insert/delete triggers on every row (the normal path),
    /// this method:
    /// 1. Drops FTS sync triggers
    /// 2. Deletes + inserts all content rows into `search_content` (fast without FTS overhead)
    /// 3. Rebuilds the FTS5 index in a single pass
    /// 4. Recreates the triggers
    ///
    /// This is dramatically faster for bulk operations (e.g., first-time indexing)
    /// because FTS5 rebuild is O(N) vs O(N log N) for per-row trigger updates.
    ///
    /// **Not suitable for single-session updates** — use `upsert_search_content` for that.
    pub fn bulk_write_search_content(
        &self,
        session_rows: &[(String, Vec<SearchContentRow>)],
    ) -> Result<usize> {
        let total_start = std::time::Instant::now();
        self.conn.execute_batch("BEGIN")?;

        let result = (|| -> Result<usize> {
            // Step 1: Drop FTS triggers to avoid per-row index updates
            self.conn.execute_batch(
                "DROP TRIGGER IF EXISTS search_content_ai;
                 DROP TRIGGER IF EXISTS search_content_ad;
                 DROP TRIGGER IF EXISTS search_content_au;",
            )?;

            // Step 2: Delete + insert content rows (no FTS overhead)
            let mut stmt = self.conn.prepare(
                "INSERT INTO search_content
                    (session_id, content_type, turn_number, event_index,
                     timestamp_unix, tool_name, content, metadata_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;

            let now = chrono::Utc::now().to_rfc3339();
            let mut total_inserted = 0;

            for (session_id, rows) in session_rows {
                // Delete existing content for this session
                self.conn.execute(
                    "DELETE FROM search_content WHERE session_id = ?1",
                    [session_id.as_str()],
                )?;

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
                    total_inserted += 1;
                }

                // Mark session as indexed
                self.conn.execute(
                    "UPDATE sessions SET search_indexed_at = ?1, search_extractor_version = ?2
                     WHERE id = ?3",
                    params![now, CURRENT_EXTRACTOR_VERSION, session_id.as_str()],
                )?;
            }

            // Step 3: Rebuild FTS index in a single pass
            self.conn.execute_batch(
                "INSERT INTO search_fts(search_fts) VALUES('rebuild');",
            )?;

            // Step 4: Recreate triggers
            self.conn.execute_batch(
                "CREATE TRIGGER search_content_ai AFTER INSERT ON search_content BEGIN
                    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                 END;
                 CREATE TRIGGER search_content_ad AFTER DELETE ON search_content BEGIN
                    INSERT INTO search_fts(search_fts, rowid, content)
                        VALUES ('delete', old.id, old.content);
                 END;
                 CREATE TRIGGER search_content_au AFTER UPDATE ON search_content BEGIN
                    INSERT INTO search_fts(search_fts, rowid, content)
                        VALUES ('delete', old.id, old.content);
                    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                 END;",
            )?;

            Ok(total_inserted)
        })();

        match result {
            Ok(count) => {
                self.conn.execute_batch("COMMIT")?;
                tracing::debug!(
                    inserted = count,
                    sessions = session_rows.len(),
                    elapsed_ms = total_start.elapsed().as_millis(),
                    "Bulk search content write complete"
                );
                Ok(count)
            }
            Err(e) => {
                // Rollback, then ensure triggers are restored
                let _ = self.conn.execute_batch("ROLLBACK");
                let _ = self.conn.execute_batch(
                    "CREATE TRIGGER IF NOT EXISTS search_content_ai AFTER INSERT ON search_content BEGIN
                        INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                     END;
                     CREATE TRIGGER IF NOT EXISTS search_content_ad AFTER DELETE ON search_content BEGIN
                        INSERT INTO search_fts(search_fts, rowid, content)
                            VALUES ('delete', old.id, old.content);
                     END;
                     CREATE TRIGGER IF NOT EXISTS search_content_au AFTER UPDATE ON search_content BEGIN
                        INSERT INTO search_fts(search_fts, rowid, content)
                            VALUES ('delete', old.id, old.content);
                        INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                     END;",
                );
                Err(e)
            }
        }
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
    // Track turn number to match frontend's turnIndex (0-based, increments on UserMessage)
    let mut current_turn: i64 = 0;
    let mut has_seen_user_message = false;
    // Map tool_call_id → tool_name for carrying names to completion events
    let mut tool_names: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for (event_index, event) in events.iter().enumerate() {
        let ts_unix = event.raw.timestamp.map(|t| t.timestamp());
        let idx = event_index as i64;

        match &event.typed_data {
            // TurnStart (AssistantTurnStart) does NOT increment — frontend
            // assigns turnIndex on UserMessage, not TurnStart.
            TypedEventData::TurnStart(_) => {}

            TypedEventData::UserMessage(d) => {
                // Mirror frontend: first UserMessage = turn 0, subsequent ones increment
                if has_seen_user_message {
                    current_turn += 1;
                }
                has_seen_user_message = true;
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
                }
                // Also index reasoning text if present
                if let Some(ref reasoning) = d.reasoning_text {
                    if !reasoning.is_empty() {
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
            }

            TypedEventData::AssistantReasoning(d) => {
                if let Some(ref content) = d.content {
                    if !content.is_empty() {
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
                let tool_name = d
                    .tool_call_id
                    .as_ref()
                    .and_then(|id| tool_names.get(id))
                    .cloned();
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
                            turn_number: Some(current_turn),
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
                            turn_number: Some(current_turn),
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

/// Flatten a serde_json::Value preserving keys as "key: value" pairs.
fn flatten_json_with_keys(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Null => String::new(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .map(flatten_json_with_keys)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        serde_json::Value::Object(map) => map
            .iter()
            .filter_map(|(k, v)| {
                let val = flatten_json_with_keys(v);
                if val.is_empty() {
                    None
                } else {
                    Some(format!("{}: {}", k, val))
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
    }
}

/// Split camelCase/PascalCase identifiers into space-separated words.
/// Returns ONLY the expansion terms (not the original text).
/// Expand camelCase and PascalCase identifiers into space-separated words.
/// Kept for potential future use in search enrichment.
#[cfg(test)]
fn expand_camel_case(text: &str) -> String {
    let mut expansions = Vec::new();

    for word in text.split(|c: char| !c.is_alphanumeric() && c != '_') {
        if word.len() < 4 {
            continue;
        }
        let chars: Vec<char> = word.chars().collect();
        let mut parts = Vec::new();
        let mut start = 0;

        for i in 1..chars.len() {
            let split = chars[i].is_uppercase()
                && (chars[i - 1].is_lowercase()
                    || (i + 1 < chars.len() && chars[i + 1].is_lowercase()));
            if split {
                let part: String = chars[start..i].iter().collect();
                if part.len() >= 2 {
                    parts.push(part.to_lowercase());
                }
                start = i;
            }
        }
        let last: String = chars[start..].iter().collect();
        if last.len() >= 2 {
            parts.push(last.to_lowercase());
        }

        if parts.len() >= 2 {
            expansions.push(parts.join(" "));
        }
    }

    expansions.join(" ")
}

/// Extract the most searchable content from a tool result, using tool-specific extractors.
fn extract_tool_result(tool_name_lower: &str, result: &serde_json::Value) -> String {
    match tool_name_lower {
        "view" | "github-mcp-server-get_file_contents" => {
            // Extract path + abbreviated content
            let mut parts = Vec::new();
            if let Some(path) = result.get("path").and_then(|v| v.as_str()) {
                parts.push(path.to_string());
            }
            if let Some(content) = result.get("content").and_then(|v| v.as_str()) {
                let t = truncate_utf8(content, EXTRACT_VIEW_CONTENT);
                parts.push(t.to_string());
            }
            let joined = parts.join("\n");
            if joined.is_empty() {
                let full = flatten_json_with_keys(result);
                truncate_utf8(&full, EXTRACT_VIEW_PATH_PLUS).to_string()
            } else {
                joined
            }
        }
        "edit" | "create" => {
            let mut parts = Vec::new();
            if let Some(path) = result.get("path").and_then(|v| v.as_str()) {
                parts.push(path.to_string());
            }
            if let Some(new_str) = result.get("new_str").and_then(|v| v.as_str()) {
                let t = truncate_utf8(new_str, EXTRACT_EDIT_CONTENT);
                parts.push(t.to_string());
            }
            let joined = parts.join("\n");
            if joined.is_empty() {
                let full = flatten_json_with_keys(result);
                truncate_utf8(&full, EXTRACT_EDIT_FALLBACK).to_string()
            } else {
                joined
            }
        }
        "powershell" | "bash" | "shell" => {
            if let Some(output) = result.get("output").and_then(|v| v.as_str()) {
                let t = truncate_utf8(output, EXTRACT_SHELL_OUTPUT);
                return t.to_string();
            }
            if let Some(stderr) = result.get("stderr").and_then(|v| v.as_str()) {
                if !stderr.is_empty() {
                    let t = truncate_utf8(stderr, EXTRACT_SHELL_STDERR);
                    return t.to_string();
                }
            }
            let full = flatten_json_with_keys(result);
            truncate_utf8(&full, EXTRACT_SHELL_FALLBACK).to_string()
        }
        "grep" | "glob" | "github-mcp-server-search_code" => {
            let full = flatten_json_with_keys(result);
            truncate_utf8(&full, EXTRACT_GREP_BYTES).to_string()
        }
        _ => {
            let full = flatten_json_with_keys(result);
            truncate_utf8(&full, EXTRACT_GENERIC_BYTES).to_string()
        }
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

    // ── expand_camel_case tests ─────────────────────────────────

    #[test]
    fn test_expand_camel_case_simple() {
        assert_eq!(expand_camel_case("parseJSON"), "parse json");
    }

    #[test]
    fn test_expand_camel_case_http_client() {
        assert_eq!(expand_camel_case("getHTTPClient"), "get http client");
    }

    #[test]
    fn test_expand_camel_case_basic() {
        assert_eq!(expand_camel_case("camelCase"), "camel case");
    }

    #[test]
    fn test_expand_camel_case_multi() {
        assert_eq!(expand_camel_case("searchContentType"), "search content type");
    }

    #[test]
    fn test_expand_camel_case_leading_acronym() {
        assert_eq!(expand_camel_case("XMLParser"), "xml parser");
    }

    #[test]
    fn test_expand_camel_case_short_words_skipped() {
        // Words < 4 chars are skipped entirely
        assert_eq!(expand_camel_case("the"), "");
        assert_eq!(expand_camel_case("is"), "");
    }

    #[test]
    fn test_expand_camel_case_no_splits() {
        // Words that are all lowercase or all uppercase produce < 2 parts → empty
        assert_eq!(expand_camel_case("lowercase"), "");
        assert_eq!(expand_camel_case("ALLCAPS"), "");
    }

    #[test]
    fn test_expand_camel_case_snake_case_passthrough() {
        // Snake case splits on _ but produces single-part words → empty
        assert_eq!(expand_camel_case("already_snake"), "");
    }

    #[test]
    fn test_expand_camel_case_mixed_identifiers() {
        let result = expand_camel_case("parseJSON getHTTPClient");
        assert!(result.contains("parse json"));
        assert!(result.contains("get http client"));
    }

    #[test]
    fn test_expand_camel_case_open_url() {
        assert_eq!(expand_camel_case("openURL"), "open url");
    }

    // ── extract_tool_result tests ───────────────────────────────

    #[test]
    fn test_extract_tool_result_view() {
        let result = serde_json::json!({
            "path": "/src/main.rs",
            "content": "fn main() {\n    println!(\"hello\");\n}"
        });
        let extracted = extract_tool_result("view", &result);
        assert!(extracted.contains("/src/main.rs"));
        assert!(extracted.contains("fn main()"));
    }

    #[test]
    fn test_extract_tool_result_edit() {
        let result = serde_json::json!({
            "path": "/src/lib.rs",
            "old_str": "old code",
            "new_str": "new code"
        });
        let extracted = extract_tool_result("edit", &result);
        assert!(extracted.contains("/src/lib.rs"));
    }

    #[test]
    fn test_extract_tool_result_shell() {
        let result = serde_json::json!({
            "stdout": "test passed\nall good",
            "stderr": "",
            "exit_code": 0
        });
        let extracted = extract_tool_result("powershell", &result);
        assert!(extracted.contains("test passed"));
    }

    #[test]
    fn test_extract_tool_result_grep() {
        let result = serde_json::json!({
            "matches": "src/main.rs:10:fn main() {}\nsrc/lib.rs:5:pub fn init()"
        });
        let extracted = extract_tool_result("grep", &result);
        assert!(!extracted.is_empty());
    }

    #[test]
    fn test_extract_tool_result_generic_fallback() {
        let result = serde_json::json!({"data": "some value", "count": 42});
        let extracted = extract_tool_result("unknown_tool", &result);
        assert!(extracted.contains("some value"));
    }

    // ── SKIP_TOOLS tests ────────────────────────────────────────

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

    // ── truncate_utf8 tests ─────────────────────────────────────

    #[test]
    fn test_truncate_utf8_short() {
        assert_eq!(truncate_utf8("hello", 10), "hello");
    }

    #[test]
    fn test_truncate_utf8_exact() {
        assert_eq!(truncate_utf8("hello", 5), "hello");
    }

    #[test]
    fn test_truncate_utf8_cuts() {
        assert_eq!(truncate_utf8("hello world", 5), "hello");
    }

    #[test]
    fn test_truncate_utf8_unicode() {
        // Multi-byte chars should not be split mid-character
        let text = "héllo wörld";
        let result = truncate_utf8(text, 6);
        assert!(result.len() <= 6);
        assert!(result.is_char_boundary(result.len()));
    }

    // ── flatten_json_with_keys tests ────────────────────────────

    #[test]
    fn test_flatten_json_with_keys_simple() {
        let v = serde_json::json!({"path": "/src/main.rs", "content": "fn main() {}"});
        let text = flatten_json_with_keys(&v);
        assert!(text.contains("path: /src/main.rs"));
        assert!(text.contains("content: fn main() {}"));
    }

    #[test]
    fn test_flatten_json_with_keys_string() {
        let v = serde_json::json!("just a string");
        assert_eq!(flatten_json_with_keys(&v), "just a string");
    }

    #[test]
    fn test_flatten_json_with_keys_null() {
        let v = serde_json::Value::Null;
        assert_eq!(flatten_json_with_keys(&v), "");
    }
}
