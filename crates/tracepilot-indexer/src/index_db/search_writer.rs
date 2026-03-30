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
pub const CURRENT_EXTRACTOR_VERSION: i64 = 3;

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

        let stored: Option<super::types::StalenessRow> = self
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
            // Session row doesn't exist in `sessions` table (Phase 1 didn't index it,
            // e.g. missing workspace.yaml in old Copilot CLI sessions). Don't attempt
            // search indexing — the FK constraint on search_content would fail.
            return false;
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
        if let (Some(sia), Some(em)) = (&search_indexed_at, &stored_ev_mtime)
            && sia < em {
                return true;
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

        // Helper: restore FTS triggers (idempotent via IF NOT EXISTS)
        let restore_triggers = |conn: &rusqlite::Connection| {
            let _ = conn.execute_batch(
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
        };

        match result {
            Ok(count) => {
                // COMMIT can fail (SQLITE_BUSY, SQLITE_FULL, SQLITE_IOERR).
                // If it does, ROLLBACK and restore triggers before returning the error —
                // otherwise the dangling transaction would silently eat any fallback writes.
                if let Err(commit_err) = self.conn.execute_batch("COMMIT") {
                    let _ = self.conn.execute_batch("ROLLBACK");
                    restore_triggers(&self.conn);
                    return Err(commit_err.into());
                }
                tracing::debug!(
                    inserted = count,
                    sessions = session_rows.len(),
                    elapsed_ms = total_start.elapsed().as_millis(),
                    "Bulk search content write complete"
                );
                Ok(count)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                restore_triggers(&self.conn);
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
            if let Some(stderr) = result.get("stderr").and_then(|v| v.as_str())
                && !stderr.is_empty() {
                    let t = truncate_utf8(stderr, EXTRACT_SHELL_STDERR);
                    return t.to_string();
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

    // ── Turn numbering tests ────────────────────────────────────
    // These verify that extract_search_content assigns turn_number values
    // matching the ConversationTurn.turn_index from reconstruct_turns.

    use tracepilot_core::models::event_types::{
        AbortData, AssistantMessageData, AssistantReasoningData, SessionErrorData,
        SessionEventType, ToolExecCompleteData, ToolExecStartData, TurnEndData, TurnStartData,
        UserMessageData,
    };
    use tracepilot_core::parsing::events::{RawEvent, TypedEvent, TypedEventData};

    /// Helper: build a TypedEvent from its components.
    fn evt(
        event_type: SessionEventType,
        typed_data: TypedEventData,
    ) -> TypedEvent {
        TypedEvent {
            raw: RawEvent {
                event_type: String::new(),
                data: serde_json::Value::Null,
                id: None,
                timestamp: None,
                parent_id: None,
            },
            event_type,
            typed_data,
        }
    }

    fn user_message(content: &str) -> TypedEvent {
        evt(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some(content.to_string()),
                transformed_content: None,
                attachments: None,
                interaction_id: None,
                source: None,
                agent_mode: None,
            }),
        )
    }

    fn assistant_turn_start() -> TypedEvent {
        evt(
            SessionEventType::AssistantTurnStart,
            TypedEventData::TurnStart(TurnStartData {
                turn_id: None,
                interaction_id: None,
            }),
        )
    }

    fn assistant_turn_end() -> TypedEvent {
        evt(
            SessionEventType::AssistantTurnEnd,
            TypedEventData::TurnEnd(TurnEndData { turn_id: None }),
        )
    }

    fn assistant_message(content: &str) -> TypedEvent {
        evt(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: None,
                content: Some(content.to_string()),
                interaction_id: None,
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
            }),
        )
    }

    fn tool_exec_start(name: &str, call_id: &str) -> TypedEvent {
        evt(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_name: Some(name.to_string()),
                tool_call_id: Some(call_id.to_string()),
                arguments: Some(serde_json::json!({"path": "test.rs"})),
                parent_tool_call_id: None,
                mcp_server_name: None,
                mcp_tool_name: None,
            }),
        )
    }

    fn reasoning(content: &str) -> TypedEvent {
        evt(
            SessionEventType::AssistantReasoning,
            TypedEventData::AssistantReasoning(AssistantReasoningData {
                reasoning_id: None,
                content: Some(content.to_string()),
            }),
        )
    }

    fn abort() -> TypedEvent {
        evt(
            SessionEventType::Abort,
            TypedEventData::Abort(AbortData { reason: None }),
        )
    }

    /// Collect (turn_number, content_type) pairs from extracted rows.
    fn turn_map(rows: &[SearchContentRow]) -> Vec<(Option<i64>, &str)> {
        rows.iter()
            .map(|r| (r.turn_number, r.content_type))
            .collect()
    }

    #[test]
    fn turn_numbers_single_user_message_turn() {
        // UserMessage → TurnStart → AssistantMsg → TurnEnd = 1 turn (turn 0)
        let events = vec![
            user_message("Hello"),
            assistant_turn_start(),
            assistant_message("Hi there!"),
            assistant_turn_end(),
        ];
        let rows = extract_search_content("s1", &events);
        assert!(!rows.is_empty());
        for row in &rows {
            assert_eq!(row.turn_number, Some(0), "all rows in single turn should be turn 0");
        }
    }

    #[test]
    fn turn_numbers_multiple_assistant_cycles() {
        // UserMessage → TurnStart → AssistantMsg → ToolExec → TurnEnd
        //             → TurnStart → AssistantMsg → TurnEnd
        // = 3 turns: turn 0 (user+first cycle), turn 1 (second cycle), turn 2 (third cycle won't exist here)
        // Actually: turn 0 starts at UserMessage, TurnEnd closes it,
        // next TurnStart opens turn 1.
        let events = vec![
            user_message("Do a task"),                // turn 0 opens
            assistant_turn_start(),                    // noop (turn 0 already open)
            assistant_message("Let me look..."),       // turn 0
            tool_exec_start("view", "tc-1"),           // turn 0
            assistant_turn_end(),                      // turn 0 closes
            assistant_turn_start(),                    // turn 1 opens (ensure_turn)
            assistant_message("Found it, editing..."), // turn 1
            tool_exec_start("edit", "tc-2"),           // turn 1
            assistant_turn_end(),                      // turn 1 closes
            assistant_turn_start(),                    // turn 2 opens
            assistant_message("All done!"),            // turn 2
            assistant_turn_end(),                      // turn 2 closes
        ];
        let rows = extract_search_content("s1", &events);
        let map = turn_map(&rows);

        // First cycle: user_message + assistant_message + tool_call = turn 0
        assert_eq!(map[0], (Some(0), "user_message"));
        assert_eq!(map[1], (Some(0), "assistant_message"));
        assert_eq!(map[2], (Some(0), "tool_call"));

        // Second cycle: assistant_message + tool_call = turn 1
        assert_eq!(map[3], (Some(1), "assistant_message"));
        assert_eq!(map[4], (Some(1), "tool_call"));

        // Third cycle: assistant_message = turn 2
        assert_eq!(map[5], (Some(2), "assistant_message"));
    }

    #[test]
    fn turn_numbers_synthetic_turn_before_user_message() {
        // TurnStart before any UserMessage creates turn 0 (synthetic),
        // then UserMessage opens turn 1.
        let events = vec![
            assistant_turn_start(),           // turn 0 (synthetic)
            assistant_message("Resuming..."), // turn 0
            assistant_turn_end(),             // turn 0 closes
            user_message("Now do this"),      // turn 1 opens
            assistant_turn_start(),           // noop
            assistant_message("OK!"),         // turn 1
            assistant_turn_end(),             // turn 1 closes
        ];
        let rows = extract_search_content("s1", &events);
        let map = turn_map(&rows);

        assert_eq!(map[0], (Some(0), "assistant_message")); // synthetic turn 0
        assert_eq!(map[1], (Some(1), "user_message"));      // user turn 1
        assert_eq!(map[2], (Some(1), "assistant_message"));  // same turn 1
    }

    #[test]
    fn turn_numbers_abort_closes_turn() {
        // Abort should close the current turn, next events open a new one.
        let events = vec![
            user_message("Start"),              // turn 0
            assistant_turn_start(),             // noop
            assistant_message("Working..."),    // turn 0
            abort(),                            // closes turn 0
            assistant_turn_start(),             // turn 1 opens
            assistant_message("Recovered"),     // turn 1
            assistant_turn_end(),               // turn 1 closes
        ];
        let rows = extract_search_content("s1", &events);
        let map = turn_map(&rows);

        assert_eq!(map[0], (Some(0), "user_message"));
        assert_eq!(map[1], (Some(0), "assistant_message")); // before abort
        assert_eq!(map[2], (Some(1), "assistant_message")); // after abort, new turn
    }

    #[test]
    fn turn_numbers_user_message_after_turn_end() {
        // TurnEnd → UserMessage: user message opens a new turn
        let events = vec![
            user_message("First"),                    // turn 0
            assistant_turn_start(),
            assistant_message("Response 1"),           // turn 0
            assistant_turn_end(),                      // closes turn 0
            user_message("Second"),                    // turn 1
            assistant_turn_start(),
            assistant_message("Response 2"),           // turn 1
            assistant_turn_end(),                      // closes turn 1
        ];
        let rows = extract_search_content("s1", &events);
        let map = turn_map(&rows);

        assert_eq!(map[0], (Some(0), "user_message"));
        assert_eq!(map[1], (Some(0), "assistant_message"));
        assert_eq!(map[2], (Some(1), "user_message"));
        assert_eq!(map[3], (Some(1), "assistant_message"));
    }

    #[test]
    fn turn_numbers_many_cycles_produces_high_turn_numbers() {
        // Simulate a session with 1 user message but many assistant cycles.
        // This is the core scenario the fix addresses.
        let mut events = vec![user_message("Do a complex task")];
        let num_cycles = 50;
        for i in 0..num_cycles {
            events.push(assistant_turn_start());
            events.push(assistant_message(&format!("Cycle {i}")));
            events.push(tool_exec_start("view", &format!("tc-{i}")));
            events.push(assistant_turn_end());
        }

        let rows = extract_search_content("s1", &events);

        // User message is turn 0
        assert_eq!(rows[0].turn_number, Some(0));
        assert_eq!(rows[0].content_type, "user_message");

        // First cycle's assistant_message + tool_call = turn 0 (same as user msg)
        assert_eq!(rows[1].turn_number, Some(0));
        assert_eq!(rows[2].turn_number, Some(0));

        // Second cycle = turn 1
        assert_eq!(rows[3].turn_number, Some(1));
        assert_eq!(rows[4].turn_number, Some(1));

        // Last cycle = turn 49
        let last_idx = rows.len() - 1;
        assert_eq!(rows[last_idx].turn_number, Some(49));

        // Verify we have high turn numbers (the whole point of the fix)
        let max_turn = rows.iter().filter_map(|r| r.turn_number).max().unwrap();
        assert_eq!(max_turn, 49, "50 cycles should produce turn numbers up to 49");
    }

    #[test]
    fn turn_numbers_reasoning_opens_turn() {
        // Reasoning event should also open a turn if none is open.
        let events = vec![
            user_message("Think about this"),
            assistant_turn_start(),
            reasoning("Let me consider..."),
            assistant_message("Here's my analysis"),
            assistant_turn_end(),
            reasoning("More thinking after turn end"), // opens turn 1
        ];
        let rows = extract_search_content("s1", &events);
        let map = turn_map(&rows);

        assert_eq!(map[0], (Some(0), "user_message"));
        assert_eq!(map[1], (Some(0), "reasoning"));
        assert_eq!(map[2], (Some(0), "assistant_message"));
        assert_eq!(map[3], (Some(1), "reasoning")); // new turn after TurnEnd
    }

    #[test]
    fn turn_numbers_match_reconstructor() {
        // Cross-validate: extract_search_content turn_number should match
        // reconstruct_turns turn_index for the same event sequence.
        use tracepilot_core::turns::reconstruct_turns;

        let events = vec![
            user_message("First"),
            assistant_turn_start(),
            assistant_message("Response 1"),
            tool_exec_start("view", "tc-1"),
            assistant_turn_end(),
            assistant_turn_start(),
            assistant_message("Follow-up 1"),
            assistant_turn_end(),
            user_message("Second"),
            assistant_turn_start(),
            assistant_message("Response 2"),
            assistant_turn_end(),
        ];

        let turns = reconstruct_turns(&events);
        let rows = extract_search_content("s1", &events);

        // The reconstructor should produce 3 turns: [0, 1, 2]
        assert_eq!(turns.len(), 3);
        assert_eq!(turns[0].turn_index, 0);
        assert_eq!(turns[1].turn_index, 1);
        assert_eq!(turns[2].turn_index, 2);

        // FTS rows should have matching turn numbers
        // Turn 0: user_message + assistant_message + tool_call
        assert_eq!(rows[0].turn_number, Some(0)); // user_message "First"
        assert_eq!(rows[1].turn_number, Some(0)); // assistant_message "Response 1"
        assert_eq!(rows[2].turn_number, Some(0)); // tool_call "view"

        // Turn 1: assistant_message (after TurnEnd→TurnStart)
        assert_eq!(rows[3].turn_number, Some(1)); // assistant_message "Follow-up 1"

        // Turn 2: user_message + assistant_message
        assert_eq!(rows[4].turn_number, Some(2)); // user_message "Second"
        assert_eq!(rows[5].turn_number, Some(2)); // assistant_message "Response 2"
    }

    #[test]
    fn turn_numbers_consecutive_user_messages() {
        // Two user messages in a row: each opens a new turn.
        let events = vec![
            user_message("First"),
            user_message("Second"),
            assistant_turn_start(),
            assistant_message("Response"),
            assistant_turn_end(),
        ];
        let rows = extract_search_content("s1", &events);
        let map = turn_map(&rows);

        assert_eq!(map[0], (Some(0), "user_message"));
        assert_eq!(map[1], (Some(1), "user_message"));
        assert_eq!(map[2], (Some(1), "assistant_message"));
    }

    fn tool_exec_complete(call_id: &str, result_text: &str) -> TypedEvent {
        evt(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some(call_id.to_string()),
                parent_tool_call_id: None,
                model: None,
                interaction_id: None,
                success: Some(true),
                result: Some(serde_json::json!(result_text)),
                error: None,
                tool_telemetry: None,
                is_user_requested: None,
            }),
        )
    }

    fn session_error(msg: &str) -> TypedEvent {
        evt(
            SessionEventType::SessionError,
            TypedEventData::SessionError(SessionErrorData {
                error_type: Some("TestError".to_string()),
                message: Some(msg.to_string()),
                stack: None,
                status_code: None,
                provider_call_id: None,
                url: None,
            }),
        )
    }

    #[test]
    fn turn_numbers_tool_complete_uses_start_turn() {
        // ToolExecutionComplete should use the turn from its matching
        // ToolExecutionStart, not the ambient current_turn.
        let events = vec![
            user_message("Do it"),                   // turn 0
            assistant_turn_start(),                   // noop
            tool_exec_start("view", "tc-1"),          // turn 0
            assistant_turn_end(),                     // closes turn 0
            assistant_turn_start(),                   // turn 1 opens
            tool_exec_complete("tc-1", "file contents"), // should be turn 0
            assistant_message("Done"),                // turn 1
            assistant_turn_end(),
        ];
        let rows = extract_search_content("s1", &events);
        let map = turn_map(&rows);

        assert_eq!(map[0], (Some(0), "user_message"));
        assert_eq!(map[1], (Some(0), "tool_call"));
        // tool_result for tc-1 should be turn 0 (where the start was)
        assert_eq!(map[2], (Some(0), "tool_result"));
        assert_eq!(map[3], (Some(1), "assistant_message"));
    }

    #[test]
    fn session_error_between_turns_assigned_to_next_turn() {
        // Session errors between turns should be buffered and assigned to
        // the next turn that opens (mirroring reconstructor's pending_session_events).
        let events = vec![
            user_message("Start"),                  // turn 0
            assistant_turn_start(),
            assistant_message("Working..."),         // turn 0
            assistant_turn_end(),                    // closes turn 0
            session_error("rate limit hit"),         // between turns → pending
            assistant_turn_start(),                  // turn 1 opens → flush pending
            assistant_message("Retrying..."),        // turn 1
            assistant_turn_end(),
        ];
        let rows = extract_search_content("s1", &events);
        let map = turn_map(&rows);

        assert_eq!(map[0], (Some(0), "user_message"));
        assert_eq!(map[1], (Some(0), "assistant_message"));
        // The session error between turns should be flushed to turn 1
        assert_eq!(map[2], (Some(1), "error"));
        assert_eq!(map[3], (Some(1), "assistant_message"));
    }

    #[test]
    fn session_error_within_turn_assigned_to_current_turn() {
        // Session errors within an active turn should use that turn.
        let events = vec![
            user_message("Start"),
            assistant_turn_start(),
            session_error("transient error"),       // within turn 0
            assistant_message("Continuing..."),
            assistant_turn_end(),
        ];
        let rows = extract_search_content("s1", &events);
        let map = turn_map(&rows);

        assert_eq!(map[0], (Some(0), "user_message"));
        assert_eq!(map[1], (Some(0), "error"));
        assert_eq!(map[2], (Some(0), "assistant_message"));
    }

    #[test]
    fn session_error_before_any_turn_gets_none() {
        // Session errors before any turn has opened should have turn_number: None
        // until a turn opens.
        let events = vec![
            session_error("early error"),           // no turn yet → pending
            user_message("Start"),                  // turn 0 → flushes pending
            assistant_turn_start(),
            assistant_message("OK"),
            assistant_turn_end(),
        ];
        let rows = extract_search_content("s1", &events);
        let map = turn_map(&rows);

        // The early error should be flushed to turn 0 (when user message opens it)
        assert_eq!(map[0], (Some(0), "error"));
        assert_eq!(map[1], (Some(0), "user_message"));
        assert_eq!(map[2], (Some(0), "assistant_message"));
    }

    #[test]
    fn trailing_session_error_after_last_turn_gets_none() {
        // Session errors after the last turn has closed, with no more turns,
        // should get turn_number: None.
        let events = vec![
            user_message("Start"),
            assistant_turn_start(),
            assistant_message("Done"),
            assistant_turn_end(),
            session_error("final error"),           // after last turn, no more turns
        ];
        let rows = extract_search_content("s1", &events);

        // user_message + assistant_message = turn 0
        assert_eq!(rows[0].turn_number, Some(0));
        assert_eq!(rows[1].turn_number, Some(0));
        // trailing error has no turn to attach to
        assert_eq!(rows[2].turn_number, None);
        assert_eq!(rows[2].content_type, "error");
    }
}
