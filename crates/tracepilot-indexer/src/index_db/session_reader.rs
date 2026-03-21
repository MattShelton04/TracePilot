//! Read-only session query methods.

use anyhow::Result;
use rusqlite::{params_from_iter, types::ToSql};
use std::collections::HashSet;
use std::path::PathBuf;

use super::types::*;
use super::IndexDb;

impl IndexDb {
    /// List indexed sessions with optional filters.
    pub fn list_sessions(
        &self,
        limit: Option<usize>,
        filter_repo: Option<&str>,
        filter_branch: Option<&str>,
        hide_empty: bool,
    ) -> Result<Vec<IndexedSession>> {
        let mut sql = String::from(
            "SELECT id, path, summary, repository, branch, cwd, host_type, created_at, updated_at, event_count, turn_count, current_model, error_count, rate_limit_count, compaction_count, truncation_count FROM sessions WHERE 1=1",
        );
        let mut query_params: Vec<Box<dyn ToSql>> = Vec::new();

        if hide_empty {
            sql.push_str(" AND turn_count IS NOT NULL AND turn_count > 0");
        }

        if let Some(repo) = filter_repo {
            sql.push_str(" AND repository = ?");
            query_params.push(Box::new(repo.to_string()));
        }
        if let Some(branch) = filter_branch {
            sql.push_str(" AND branch = ?");
            query_params.push(Box::new(branch.to_string()));
        }

        sql.push_str(" ORDER BY updated_at DESC");
        if let Some(limit) = limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let refs: Vec<&dyn ToSql> = query_params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_from_iter(refs), |row| {
            Ok(IndexedSession {
                id: row.get(0)?,
                path: row.get(1)?,
                summary: row.get(2)?,
                repository: row.get(3)?,
                branch: row.get(4)?,
                cwd: row.get(5)?,
                host_type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                event_count: row.get(9)?,
                turn_count: row.get(10)?,
                current_model: row.get(11)?,
                error_count: row.get(12)?,
                rate_limit_count: row.get(13)?,
                compaction_count: row.get(14)?,
                truncation_count: row.get(15)?,
            })
        })?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(sessions)
    }

    /// Return the total number of indexed sessions (fast `SELECT COUNT(*)`).
    pub fn session_count(&self) -> Result<usize> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))?;
        Ok(count as usize)
    }

    /// Return the set of all session IDs currently in the index.
    pub fn all_indexed_ids(&self) -> Result<HashSet<String>> {
        let mut stmt = self.conn.prepare("SELECT id FROM sessions")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut ids = HashSet::new();
        for row in rows {
            ids.insert(row?);
        }
        Ok(ids)
    }

    /// Get a session's filesystem path from the index.
    pub fn get_session_path(&self, session_id: &str) -> Result<Option<PathBuf>> {
        let path: Option<String> = self
            .conn
            .query_row(
                "SELECT path FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .ok();
        Ok(path.map(PathBuf::from))
    }

    /// Full-text search across session metadata and conversation content.
    pub fn search(&self, query: &str) -> Result<Vec<String>> {
        let mut results = HashSet::new();

        let mut stmt = self
            .conn
            .prepare("SELECT id FROM sessions_fts WHERE sessions_fts MATCH ?1")?;
        let ids = stmt.query_map([query], |row| row.get::<_, String>(0))?;
        for id in ids.flatten() {
            results.insert(id);
        }

        let mut stmt = self
            .conn
            .prepare("SELECT session_id FROM conversation_fts WHERE conversation_fts MATCH ?1")?;
        let ids = stmt.query_map([query], |row| row.get::<_, String>(0))?;
        for id in ids.flatten() {
            results.insert(id);
        }

        Ok(results.into_iter().collect())
    }

    /// Get distinct CWD paths from all indexed sessions (for repo discovery).
    pub fn distinct_session_cwds(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL AND cwd != ''",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut cwds = Vec::new();
        for row in rows {
            cwds.push(row?);
        }
        Ok(cwds)
    }

    /// Query incidents for a specific session.
    pub fn get_session_incidents(&self, session_id: &str) -> Result<Vec<IndexedIncident>> {
        let mut stmt = self.conn.prepare(
            "SELECT event_type, source_event_type, timestamp, severity, summary, detail_json
             FROM session_incidents WHERE session_id = ?1 ORDER BY timestamp",
        )?;
        let rows = stmt.query_map([session_id], |row| {
            Ok(IndexedIncident {
                event_type: row.get(0)?,
                source_event_type: row.get(1)?,
                timestamp: row.get(2)?,
                severity: row.get(3)?,
                summary: row.get(4)?,
                detail_json: row.get(5)?,
            })
        })?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }

    // ── Event cache readers ───────────────────────────────────────────

    /// Query the indexed events file metadata (mtime, size) for freshness checks.
    ///
    /// Used to verify cached byte offsets are still valid before using them.
    pub fn query_events_file_meta(
        &self,
        session_id: &str,
    ) -> Result<Option<(Option<String>, Option<i64>)>> {
        let result = self.conn.query_row(
            "SELECT events_mtime, events_size FROM sessions WHERE id = ?1",
            [session_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<i64>>(1)?)),
        );
        match result {
            Ok(meta) => Ok(Some(meta)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Check if the event cache is populated for a session.
    ///
    /// Uses the `events_cached` flag column, which is set to 1 after successful
    /// caching. This correctly handles empty sessions (0 events, byte_offset = 0).
    pub fn has_cached_events(&self, session_id: &str) -> bool {
        self.conn
            .query_row(
                "SELECT events_cached FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .ok()
            .flatten()
            .unwrap_or(0)
            == 1
    }

    /// Read cached events with keyset pagination (metadata only, no payload).
    ///
    /// Returns `(events, total_count, has_more)`. Uses `event_index >= start_index`
    /// for efficient deep pagination (avoids SQL OFFSET).
    pub fn get_cached_events(
        &self,
        session_id: &str,
        start_index: usize,
        limit: usize,
    ) -> Result<(Vec<CachedEvent>, usize, bool)> {
        // Get total count from the sessions row (fast, no COUNT(*) scan)
        let total_count: usize = self
            .conn
            .query_row(
                "SELECT COALESCE(events_line_count, 0) FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0) as usize;

        // Fetch one extra row to determine has_more
        let fetch_limit = limit + 1;
        let mut stmt = self.conn.prepare(
            "SELECT event_index, event_type, event_id, timestamp, parent_id,
                    byte_offset, line_length, tool_call_id
             FROM session_events
             WHERE session_id = ?1 AND event_index >= ?2
             ORDER BY event_index ASC
             LIMIT ?3",
        )?;

        let rows = stmt.query_map(
            rusqlite::params![session_id, start_index as i64, fetch_limit as i64],
            |row| {
                Ok(CachedEvent {
                    event_index: row.get::<_, i64>(0)? as usize,
                    event_type: row.get(1)?,
                    event_id: row.get(2)?,
                    timestamp: row.get(3)?,
                    parent_id: row.get(4)?,
                    byte_offset: row.get::<_, i64>(5)? as u64,
                    line_length: row.get::<_, i64>(6)? as u64,
                    tool_call_id: row.get(7)?,
                })
            },
        )?;

        let mut events: Vec<CachedEvent> = Vec::new();
        for row in rows {
            events.push(row?);
        }

        let has_more = events.len() > limit;
        if has_more {
            events.truncate(limit);
        }

        Ok((events, total_count, has_more))
    }

    /// Get the byte offset and line length for a specific event.
    ///
    /// Used for on-demand event data reads: seek to `byte_offset` in events.jsonl,
    /// read `line_length` bytes, parse the JSON line.
    pub fn get_event_data_offset(
        &self,
        session_id: &str,
        event_index: usize,
    ) -> Result<Option<(u64, u64)>> {
        let result = self
            .conn
            .query_row(
                "SELECT byte_offset, line_length FROM session_events
                 WHERE session_id = ?1 AND event_index = ?2",
                rusqlite::params![session_id, event_index as i64],
                |row| {
                    Ok((row.get::<_, i64>(0)? as u64, row.get::<_, i64>(1)? as u64))
                },
            );

        match result {
            Ok(offset) => Ok(Some(offset)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Find the byte offset of a tool.execution_complete event by tool_call_id.
    ///
    /// Returns `(byte_offset, line_length)` for the matching event (last match wins),
    /// which can be used to seek directly to the event's JSON line in events.jsonl.
    pub fn get_tool_result_offset(
        &self,
        session_id: &str,
        tool_call_id: &str,
    ) -> Result<Option<(u64, u64)>> {
        let result = self
            .conn
            .query_row(
                "SELECT byte_offset, line_length FROM session_events
                 WHERE session_id = ?1 AND tool_call_id = ?2
                 ORDER BY event_index DESC
                 LIMIT 1",
                rusqlite::params![session_id, tool_call_id],
                |row| {
                    Ok((row.get::<_, i64>(0)? as u64, row.get::<_, i64>(1)? as u64))
                },
            );

        match result {
            Ok(offset) => Ok(Some(offset)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Read cached ShutdownData + shutdown count for a session.
    ///
    /// Returns `None` if the session has no cached shutdown data (either not
    /// cached yet, or the session has no shutdown event).
    pub fn get_cached_shutdown_data(
        &self,
        session_id: &str,
    ) -> Result<Option<(tracepilot_core::models::event_types::ShutdownData, u32)>> {
        let json: Option<String> = self
            .conn
            .query_row(
                "SELECT shutdown_data_json FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .ok()
            .flatten();

        match json {
            Some(j) if !j.is_empty() => {
                let wrapper: serde_json::Value = serde_json::from_str(&j)
                    .map_err(|e| anyhow::anyhow!("Failed to deserialize shutdown data: {}", e))?;
                let data: tracepilot_core::models::event_types::ShutdownData =
                    serde_json::from_value(wrapper.get("data").cloned().unwrap_or_default())
                        .map_err(|e| {
                            anyhow::anyhow!("Failed to deserialize ShutdownData: {}", e)
                        })?;
                let count = wrapper
                    .get("shutdown_count")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(1) as u32;
                Ok(Some((data, count)))
            }
            _ => Ok(None),
        }
    }

    /// Get a session's indexed data suitable for constructing a SessionSummary.
    ///
    /// Returns key fields from the sessions table. The caller must do cheap
    /// file-existence checks for `has_session_db`, `has_plan`, `has_checkpoints`
    /// etc., as these are dynamic state, not cached.
    pub fn get_session_indexed_data(
        &self,
        session_id: &str,
    ) -> Result<Option<SessionIndexedData>> {
        let result = self.conn.query_row(
            "SELECT id, path, summary, repository, branch, cwd, host_type,
                    created_at, updated_at, event_count, turn_count,
                    has_plan, has_checkpoints, checkpoint_count,
                    shutdown_type, current_model, total_premium_requests,
                    total_api_duration_ms, total_tokens, total_cost,
                    tool_call_count, lines_added, lines_removed, duration_ms,
                    health_score, shutdown_data_json
             FROM sessions WHERE id = ?1",
            [session_id],
            |row| {
                Ok(SessionIndexedData {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    summary: row.get(2)?,
                    repository: row.get(3)?,
                    branch: row.get(4)?,
                    cwd: row.get(5)?,
                    host_type: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    event_count: row.get(9)?,
                    turn_count: row.get(10)?,
                    has_plan: row.get(11)?,
                    has_checkpoints: row.get(12)?,
                    checkpoint_count: row.get(13)?,
                    shutdown_type: row.get(14)?,
                    current_model: row.get(15)?,
                    total_premium_requests: row.get(16)?,
                    total_api_duration_ms: row.get(17)?,
                    total_tokens: row.get(18)?,
                    total_cost: row.get(19)?,
                    tool_call_count: row.get(20)?,
                    lines_added: row.get(21)?,
                    lines_removed: row.get(22)?,
                    duration_ms: row.get(23)?,
                    health_score: row.get(24)?,
                    shutdown_data_json: row.get(25)?,
                })
            },
        );

        match result {
            Ok(data) => Ok(Some(data)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Find byte offset for a tool.execution_complete event by tool_call_id.
    ///
    /// Returns `(byte_offset, line_length)` for seeking directly to the event's
    /// JSON line in events.jsonl. Returns `None` if no match is cached.
    pub fn get_cached_tool_result(
        &self,
        session_id: &str,
        tool_call_id: &str,
    ) -> Result<Option<(u64, u64)>> {
        self.get_tool_result_offset(session_id, tool_call_id)
    }
}
