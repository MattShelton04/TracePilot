//! Session write operations: upsert, reindex detection, pruning.

use anyhow::{Context, Result};
use rusqlite::params;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use tracepilot_core::models::event_types::SessionEventType;
use tracepilot_core::parsing::events::TypedEventData;
use tracepilot_core::utils::truncate_utf8;

use super::types::*;
use super::IndexDb;

/// Extract tool_call_id from a typed event (only for tool.execution_complete events).
fn extract_tool_call_id(event_type: &SessionEventType, data: &TypedEventData) -> Option<String> {
    if matches!(event_type, SessionEventType::ToolExecutionComplete) {
        if let TypedEventData::ToolExecutionComplete(d) = data {
            return d.tool_call_id.clone();
        }
    }
    None
}

impl IndexDb {
    /// Insert or update a session in the index, computing analytics from events.
    pub fn upsert_session(&self, session_path: &Path) -> Result<SessionIndexInfo> {
        // Single parse pass: parse events.jsonl with byte offsets.
        // The offset data is used for the lean cache; the typed events are
        // fed into load_session_summary to avoid a second parse of the same file.
        let events_path = session_path.join("events.jsonl");
        let offset_parse = if events_path.exists() {
            tracepilot_core::parsing::events::parse_typed_events_with_offsets(&events_path).ok()
        } else {
            None
        };

        // Build the session summary. If we have pre-parsed events, hand them
        // to the summary builder so it doesn't re-read events.jsonl.
        let load_result = if let Some(ref parsed) = offset_parse {
            let typed_events: Vec<tracepilot_core::parsing::events::TypedEvent> =
                parsed.events.iter().map(|ewo| ewo.event.clone()).collect();
            tracepilot_core::summary::load_session_summary_with_preparsed(
                session_path,
                typed_events,
                parsed.diagnostics.clone(),
            )
        } else {
            tracepilot_core::summary::load_session_summary_with_events(session_path)
        }
        .with_context(|| {
            format!(
                "Failed to load session summary: {}",
                session_path.display()
            )
        })?;

        let summary = load_result.summary;
        let diagnostics = load_result.diagnostics;
        let typed_events_for_analytics = load_result.typed_events;

        let file_meta = SessionFileMeta::from_session_path(session_path);

        let analytics = extract_session_analytics(
            &summary,
            &typed_events_for_analytics,
            diagnostics.as_ref(),
            &file_meta,
        );

        let index_info = SessionIndexInfo {
            repository: summary.repository.clone(),
            branch: summary.branch.clone(),
            current_model: analytics.current_model.clone(),
            total_tokens: analytics.total_tokens.max(0) as u64,
            event_count: summary.event_count.unwrap_or(0),
            turn_count: summary.turn_count.unwrap_or(0),
        };

        let session_id = summary.id.clone();

        // ── Write everything in a SAVEPOINT transaction ──────────────
        self.conn.execute_batch("SAVEPOINT upsert_session")?;

        let result = (|| -> Result<()> {
            // Delete child table rows first (including event/turn cache)
            self.conn.execute(
                "DELETE FROM session_model_metrics WHERE session_id = ?1",
                [&session_id],
            )?;
            self.conn.execute(
                "DELETE FROM session_tool_calls WHERE session_id = ?1",
                [&session_id],
            )?;
            self.conn.execute(
                "DELETE FROM session_modified_files WHERE session_id = ?1",
                [&session_id],
            )?;
            self.conn.execute(
                "DELETE FROM session_activity WHERE session_id = ?1",
                [&session_id],
            )?;
            self.conn.execute(
                "DELETE FROM conversation_fts WHERE session_id = ?1",
                [&session_id],
            )?;
            self.conn.execute(
                "DELETE FROM session_incidents WHERE session_id = ?1",
                [&session_id],
            )?;
            self.conn.execute(
                "DELETE FROM tool_result_offsets WHERE session_id = ?1",
                [&session_id],
            )?;
            // Reset cache marker immediately so stale flag doesn't persist
            // if the parse below fails or is skipped.
            self.conn.execute(
                "UPDATE sessions SET tool_offsets_cached = 0 WHERE id = ?1",
                [&session_id],
            )?;

            // UPSERT the session row
            self.conn.execute(
                "INSERT INTO sessions (
                    id, path, summary, repository, branch, cwd, host_type,
                    created_at, updated_at, event_count, turn_count,
                    has_plan, has_checkpoints, checkpoint_count,
                    shutdown_type, current_model, total_premium_requests, total_api_duration_ms,
                    workspace_mtime,
                    total_tokens, total_cost, tool_call_count, lines_added, lines_removed,
                    duration_ms, health_score, events_mtime, events_size, analytics_version,
                    error_count, rate_limit_count, warning_count, compaction_count, truncation_count,
                    last_error_type, last_error_message, total_compaction_input_tokens, total_compaction_output_tokens,
                    indexed_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                    ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29,
                    ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38,
                    datetime('now')
                )
                ON CONFLICT(id) DO UPDATE SET
                    path=excluded.path, summary=excluded.summary, repository=excluded.repository,
                    branch=excluded.branch, cwd=excluded.cwd, host_type=excluded.host_type,
                    created_at=excluded.created_at, updated_at=excluded.updated_at,
                    event_count=excluded.event_count, turn_count=excluded.turn_count,
                    has_plan=excluded.has_plan, has_checkpoints=excluded.has_checkpoints,
                    checkpoint_count=excluded.checkpoint_count, shutdown_type=excluded.shutdown_type,
                    current_model=excluded.current_model,
                    total_premium_requests=excluded.total_premium_requests,
                    total_api_duration_ms=excluded.total_api_duration_ms,
                    workspace_mtime=excluded.workspace_mtime,
                    total_tokens=excluded.total_tokens, total_cost=excluded.total_cost,
                    tool_call_count=excluded.tool_call_count,
                    lines_added=excluded.lines_added, lines_removed=excluded.lines_removed,
                    duration_ms=excluded.duration_ms, health_score=excluded.health_score,
                    events_mtime=excluded.events_mtime, events_size=excluded.events_size,
                    analytics_version=excluded.analytics_version,
                    error_count=excluded.error_count, rate_limit_count=excluded.rate_limit_count,
                    warning_count=excluded.warning_count, compaction_count=excluded.compaction_count,
                    truncation_count=excluded.truncation_count,
                    last_error_type=excluded.last_error_type, last_error_message=excluded.last_error_message,
                    total_compaction_input_tokens=excluded.total_compaction_input_tokens,
                    total_compaction_output_tokens=excluded.total_compaction_output_tokens,
                    indexed_at=excluded.indexed_at",
                params![
                    summary.id,
                    session_path.to_string_lossy().to_string(),
                    summary.summary,
                    summary.repository,
                    summary.branch,
                    summary.cwd,
                    summary.host_type,
                    summary.created_at.map(|d| d.to_rfc3339()),
                    summary.updated_at.map(|d| d.to_rfc3339()),
                    summary.event_count.map(|c| c as i64),
                    summary.turn_count.map(|c| c as i64),
                    summary.has_plan as i32,
                    summary.has_checkpoints as i32,
                    summary.checkpoint_count.map(|c| c as i64),
                    analytics.shutdown_type,
                    analytics.current_model,
                    analytics.total_premium_requests,
                    analytics.total_api_duration_ms,
                    analytics.workspace_mtime,
                    analytics.total_tokens,
                    analytics.total_cost,
                    analytics.tool_call_count,
                    analytics.lines_added,
                    analytics.lines_removed,
                    analytics.duration_ms,
                    analytics.health_score,
                    analytics.events_mtime,
                    analytics.events_size,
                    CURRENT_ANALYTICS_VERSION,
                    analytics.error_count,
                    analytics.rate_limit_count,
                    analytics.warning_count,
                    analytics.compaction_count,
                    analytics.truncation_count,
                    analytics.last_error_type,
                    analytics.last_error_message,
                    analytics.total_compaction_input,
                    analytics.total_compaction_output,
                ],
            )?;

            // INSERT child rows: model metrics
            for row in &analytics.model_rows {
                self.conn.execute(
                    "INSERT INTO session_model_metrics
                        (session_id, model_name, input_tokens, output_tokens,
                         cache_read_tokens, cache_write_tokens, cost, request_count)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        session_id,
                        row.model,
                        row.input_tokens,
                        row.output_tokens,
                        row.cache_read_tokens,
                        row.cache_write_tokens,
                        row.cost,
                        row.premium_requests
                    ],
                )?;
            }

            // INSERT child rows: tool calls
            for row in &analytics.tool_call_rows {
                self.conn.execute(
                    "INSERT INTO session_tool_calls
                        (session_id, tool_name, call_count, success_count, failure_count, total_duration_ms, calls_with_duration)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        session_id,
                        row.name,
                        row.calls,
                        row.success,
                        row.failure,
                        row.duration_ms,
                        row.calls_with_duration
                    ],
                )?;
            }

            // INSERT child rows: modified files
            for row in &analytics.modified_file_rows {
                self.conn.execute(
                    "INSERT OR IGNORE INTO session_modified_files (session_id, file_path, extension)
                     VALUES (?1, ?2, ?3)",
                    params![session_id, row.file_path, row.extension],
                )?;
            }

            // INSERT child rows: activity heatmap
            for row in &analytics.activity_rows {
                self.conn.execute(
                    "INSERT INTO session_activity (session_id, day_of_week, hour, tool_call_count)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![session_id, row.day_of_week, row.hour, row.tool_call_count],
                )?;
            }

            // INSERT conversation FTS content
            if !analytics.fts_content.is_empty() {
                let truncated = truncate_utf8(&analytics.fts_content, FTS_CONTENT_MAX_BYTES);
                self.conn.execute(
                    "INSERT INTO conversation_fts (session_id, content) VALUES (?1, ?2)",
                    params![session_id, truncated],
                )?;
            }

            // INSERT child rows: incidents
            {
                let mut stmt = self.conn.prepare(
                    "INSERT INTO session_incidents
                        (session_id, event_type, source_event_type, timestamp, severity, summary, detail_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )?;
                for inc in &analytics.incidents {
                    stmt.execute(params![
                        session_id,
                        inc.event_type,
                        inc.source_event_type,
                        inc.timestamp,
                        inc.severity,
                        inc.summary,
                        inc.detail_json
                    ])?;
                }
            }

            // ── Cache tool result offsets + shutdown data ─────────────
            if let Some(ref parsed) = offset_parse {
                self.cache_tool_offsets(&session_id, &parsed.events)?;
            }

            // Cache shutdown data
            if let Some(ref events) = typed_events_for_analytics {
                if let Some((shutdown_data, count)) =
                    tracepilot_core::parsing::events::extract_combined_shutdown_data(events)
                {
                    self.cache_shutdown_data(&session_id, &shutdown_data, count)?;
                }
            }

            Ok(())
        })();

        match result {
            Ok(()) => {
                self.conn.execute_batch("RELEASE upsert_session")?;
                Ok(index_info)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK TO upsert_session");
                let _ = self.conn.execute_batch("RELEASE upsert_session");
                Err(e)
            }
        }
    }

    // ── Tool result offset cache ────────────────────────────────────────

    /// Determine whether the session should be re-indexed.
    ///
    /// Checks workspace.yaml mtime, events.jsonl mtime+size, and analytics_version.
    pub fn needs_reindex(&self, session_id: &str, session_path: &Path) -> bool {
        let current_ws_mtime = get_workspace_mtime(session_path);
        let current_events = get_events_mtime_and_size(session_path);

        let stored: Option<(Option<String>, Option<String>, Option<i64>, Option<i64>)> = self
            .conn
            .query_row(
                "SELECT workspace_mtime, events_mtime, events_size, analytics_version
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

        let Some((stored_ws_mtime, stored_ev_mtime, stored_ev_size, stored_av)) = stored else {
            return true; // Not indexed yet
        };

        if stored_av.unwrap_or(0) < CURRENT_ANALYTICS_VERSION {
            return true;
        }

        if stored_ws_mtime.as_deref() != current_ws_mtime.as_deref() {
            return true;
        }

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

        false
    }

    // ── Event cache methods ──────────────────────────────────────────────

    /// Determine how to reindex a session: Skip or FullReindex.
    ///
    /// Returns `FullReindex` when workspace/events changed or analytics version
    /// is outdated. Returns `Skip` when nothing changed.
    pub fn reindex_decision(&self, session_id: &str, session_path: &Path) -> ReindexDecision {
        if self.needs_reindex(session_id, session_path) {
            ReindexDecision::FullReindex
        } else {
            ReindexDecision::Skip
        }
    }

    /// Store tool result byte offsets for O(1) lookups from conversation view.
    ///
    /// Only caches `tool.execution_complete` events that have a `tool_call_id`.
    /// Replaces all existing offsets for the session and sets `tool_offsets_cached = 1`.
    pub fn cache_tool_offsets(
        &self,
        session_id: &str,
        events: &[tracepilot_core::parsing::events::TypedEventWithOffset],
    ) -> Result<()> {
        // Clear existing offsets
        self.conn.execute(
            "DELETE FROM tool_result_offsets WHERE session_id = ?1",
            [session_id],
        )?;

        let mut stmt = self.conn.prepare(
            "INSERT OR REPLACE INTO tool_result_offsets (session_id, tool_call_id, byte_offset, line_length)
             VALUES (?1, ?2, ?3, ?4)",
        )?;

        for ewo in events {
            if let Some(ref tool_call_id) =
                extract_tool_call_id(&ewo.event.event_type, &ewo.event.typed_data)
            {
                stmt.execute(params![
                    session_id,
                    tool_call_id,
                    ewo.byte_offset as i64,
                    ewo.line_length as i64,
                ])?;
            }
        }

        // Set cache flag
        self.conn.execute(
            "UPDATE sessions SET tool_offsets_cached = 1 WHERE id = ?1",
            [session_id],
        )?;

        Ok(())
    }

    /// Store serialized ShutdownData JSON for fast retrieval.
    ///
    /// Stores a JSON object wrapping the ShutdownData and shutdown_count,
    /// enabling full-fidelity ShutdownMetrics reconstruction from cache.
    pub fn cache_shutdown_data(
        &self,
        session_id: &str,
        shutdown_data: &tracepilot_core::models::event_types::ShutdownData,
        shutdown_count: u32,
    ) -> Result<()> {
        let wrapper = serde_json::json!({
            "data": shutdown_data,
            "shutdown_count": shutdown_count,
        });
        let json = serde_json::to_string(&wrapper)
            .with_context(|| "Failed to serialize ShutdownData wrapper")?;
        self.conn.execute(
            "UPDATE sessions SET shutdown_data_json = ?1 WHERE id = ?2",
            params![json, session_id],
        )?;
        Ok(())
    }

    /// Remove sessions from the index whose IDs are not in the given set of live IDs.
    ///
    /// Uses a batch DELETE with temp table to avoid exceeding SQLITE_MAX_VARIABLE_NUMBER.
    /// Child tables cascade via foreign keys.
    pub fn prune_deleted(&self, live_ids: &HashSet<String>) -> Result<usize> {
        let indexed_ids = self.all_indexed_ids()?;
        let stale: Vec<&String> = indexed_ids
            .iter()
            .filter(|id| !live_ids.contains(*id))
            .collect();
        let count = stale.len();
        if count == 0 {
            return Ok(0);
        }

        self.conn.execute_batch("BEGIN")?;
        let result = (|| -> Result<()> {
            self.conn.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS _live_ids (id TEXT PRIMARY KEY)",
            )?;
            self.conn.execute_batch("DELETE FROM _live_ids")?;

            let mut stmt = self
                .conn
                .prepare("INSERT OR IGNORE INTO _live_ids (id) VALUES (?1)")?;
            for id in live_ids {
                stmt.execute([id])?;
            }

            self.conn.execute_batch(
                "DELETE FROM sessions WHERE id NOT IN (SELECT id FROM _live_ids)",
            )?;
            self.conn.execute_batch(
                "DELETE FROM conversation_fts WHERE session_id NOT IN (SELECT id FROM _live_ids)",
            )?;
            self.conn
                .execute_batch("DROP TABLE IF EXISTS _live_ids")?;
            Ok(())
        })();

        match result {
            Ok(()) => {
                self.conn.execute_batch("COMMIT")?;
                Ok(count)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }
}

// ── Pure analytics extraction ──────────────────────────────────────────

/// Extract all analytics from a session's summary and events without any
/// database interaction. This is the core computation that powers
/// `upsert_session`, extracted as a pure function for testability.
pub(super) fn extract_session_analytics(
    summary: &tracepilot_core::SessionSummary,
    typed_events: &Option<Vec<tracepilot_core::parsing::events::TypedEvent>>,
    diagnostics: Option<&tracepilot_core::parsing::diagnostics::ParseDiagnostics>,
    file_meta: &SessionFileMeta,
) -> SessionAnalytics {
    let mut total_tokens: i64 = 0;
    let mut total_cost: f64 = 0.0;
    let mut lines_added: Option<i64> = None;
    let mut lines_removed: Option<i64> = None;
    let mut duration_ms: Option<i64> = None;
    let mut model_rows: Vec<ModelMetricsRow> = Vec::new();

    let shutdown_type = summary
        .shutdown_metrics
        .as_ref()
        .and_then(|m| m.shutdown_type.clone());
    let current_model = summary
        .shutdown_metrics
        .as_ref()
        .and_then(|m| m.current_model.clone());
    let total_premium_requests = summary
        .shutdown_metrics
        .as_ref()
        .and_then(|m| m.total_premium_requests);
    let total_api_duration_ms = summary
        .shutdown_metrics
        .as_ref()
        .and_then(|m| m.total_api_duration_ms.map(|v| v as i64));

    if let Some(ref metrics) = summary.shutdown_metrics {
        if let (Some(start_time), Some(updated)) =
            (metrics.session_start_time, summary.updated_at)
        {
            let end_ms = updated.timestamp_millis() as u64;
            if end_ms > start_time {
                duration_ms = Some((end_ms - start_time) as i64);
            }
        }

        for (model_name, detail) in &metrics.model_metrics {
            let (input_t, output_t, cache_read, cache_write) =
                if let Some(ref usage) = detail.usage {
                    (
                        usage.input_tokens.unwrap_or(0) as i64,
                        usage.output_tokens.unwrap_or(0) as i64,
                        usage.cache_read_tokens.unwrap_or(0) as i64,
                        usage.cache_write_tokens.unwrap_or(0) as i64,
                    )
                } else {
                    (0, 0, 0, 0)
                };
            let model_tokens = input_t + output_t;
            total_tokens += model_tokens;

            let cost = detail
                .requests
                .as_ref()
                .and_then(|r| r.cost)
                .unwrap_or(0.0);
            total_cost += cost;

            let req_count = detail
                .requests
                .as_ref()
                .and_then(|r| r.count)
                .unwrap_or(0) as i64;

            model_rows.push(ModelMetricsRow {
                model: model_name.clone(),
                input_tokens: input_t,
                output_tokens: output_t,
                cache_read_tokens: cache_read,
                cache_write_tokens: cache_write,
                cost,
                premium_requests: req_count,
            });
        }

        if let Some(ref cc) = metrics.code_changes {
            lines_added = cc.lines_added.map(|v| v as i64);
            lines_removed = cc.lines_removed.map(|v| v as i64);
        }
    }

    // ── Extract event-level analytics (single pass) ────────────
    let mut tool_call_rows: Vec<ToolCallRow> = Vec::new();
    let mut activity_rows: Vec<ActivityRow> = Vec::new();
    let mut modified_file_rows: Vec<ModifiedFileRow> = Vec::new();
    let mut fts_content = String::with_capacity(
        typed_events.as_ref().map_or(0, |e| e.len().min(2000) * 50),
    );
    let fts_limit: usize = FTS_CONTENT_MAX_BYTES;
    let mut actual_tool_call_count: i64 = 0;

    let mut error_count: i64 = 0;
    let mut rate_limit_count: i64 = 0;
    let mut warning_count: i64 = 0;
    let mut compaction_count: i64 = 0;
    let mut truncation_count: i64 = 0;
    let mut last_error_type: Option<String> = None;
    let mut last_error_message: Option<String> = None;
    let mut total_compaction_input: i64 = 0;
    let mut total_compaction_output: i64 = 0;
    let mut incidents: Vec<IncidentRow> = Vec::new();

    if let Some(events) = typed_events {
        let mut tool_starts: HashMap<String, (String, Option<chrono::DateTime<chrono::Utc>>)> =
            HashMap::new();
        let mut tool_accum: HashMap<String, (i64, i64, i64, i64, i64)> = HashMap::new();
        let mut heatmap_accum: HashMap<(i64, i64), i64> = HashMap::new();

        for event in events {
            match &event.typed_data {
                TypedEventData::UserMessage(d) => {
                    if fts_content.len() < fts_limit {
                        if let Some(content) = &d.content {
                            if !fts_content.is_empty() {
                                fts_content.push('\n');
                            }
                            fts_content.push_str(content);
                        }
                    }
                }
                TypedEventData::AssistantMessage(d) => {
                    if fts_content.len() < fts_limit {
                        if let Some(content) = &d.content {
                            if !fts_content.is_empty() {
                                fts_content.push('\n');
                            }
                            fts_content.push_str(content);
                        }
                    }
                }
                TypedEventData::ToolExecutionStart(d) => {
                    if let Some(ref tool_call_id) = d.tool_call_id {
                        let name = d.tool_name.clone().unwrap_or_else(|| "unknown".into());
                        tool_starts
                            .insert(tool_call_id.clone(), (name, event.raw.timestamp));
                    }
                }
                TypedEventData::ToolExecutionComplete(d) => {
                    actual_tool_call_count += 1;
                    if let Some(ref tool_call_id) = d.tool_call_id {
                        if let Some((tool_name, start_ts)) =
                            tool_starts.remove(tool_call_id)
                        {
                            let acc = tool_accum
                                .entry(tool_name.clone())
                                .or_insert((0, 0, 0, 0, 0));
                            acc.0 += 1;

                            match d.success {
                                Some(true) => acc.1 += 1,
                                Some(false) => acc.2 += 1,
                                None => {}
                            }

                            if let (Some(start), Some(end)) =
                                (start_ts, event.raw.timestamp)
                            {
                                let dur = (end - start).num_milliseconds().max(0);
                                acc.3 += dur;
                                acc.4 += 1;
                            }

                            if let Some(ts) = start_ts {
                                use chrono::{Datelike, Timelike};
                                let day = ts.weekday().num_days_from_monday() as i64;
                                let hour = ts.hour() as i64;
                                *heatmap_accum.entry((day, hour)).or_insert(0) += 1;
                            }
                        }
                    }
                }
                TypedEventData::SessionError(d) => {
                    error_count += 1;
                    let is_rate_limit = d.error_type.as_deref() == Some("rate_limit");
                    if is_rate_limit {
                        rate_limit_count += 1;
                    }
                    last_error_type = d.error_type.clone();
                    last_error_message = d.message.clone();
                    if incidents.len() < MAX_INCIDENTS_PER_SESSION {
                        let summary = if is_rate_limit {
                            "Rate limit hit".into()
                        } else {
                            d.message.clone().unwrap_or_default()
                        };
                        incidents.push(IncidentRow {
                            event_type: "error".into(),
                            source_event_type: "session.error".into(),
                            timestamp: event
                                .raw
                                .timestamp
                                .as_ref()
                                .map(|t| t.to_rfc3339()),
                            severity: "error".into(),
                            summary,
                            detail_json: serde_json::to_string(&event.raw.data).ok(),
                        });
                    }
                }
                TypedEventData::SessionWarning(d) => {
                    warning_count += 1;
                    if incidents.len() < MAX_INCIDENTS_PER_SESSION {
                        incidents.push(IncidentRow {
                            event_type: "warning".into(),
                            source_event_type: "session.warning".into(),
                            timestamp: event
                                .raw
                                .timestamp
                                .as_ref()
                                .map(|t| t.to_rfc3339()),
                            severity: "warning".into(),
                            summary: d.message.clone().unwrap_or_default(),
                            detail_json: serde_json::to_string(&event.raw.data).ok(),
                        });
                    }
                }
                TypedEventData::CompactionComplete(d) => {
                    compaction_count += 1;
                    if let Some(usage) = &d.compaction_tokens_used {
                        total_compaction_input += usage.input.unwrap_or(0) as i64;
                        total_compaction_output += usage.output.unwrap_or(0) as i64;
                    }
                    if incidents.len() < MAX_INCIDENTS_PER_SESSION {
                        incidents.push(IncidentRow {
                            event_type: "compaction".into(),
                            source_event_type: "session.compaction_complete".into(),
                            timestamp: event
                                .raw
                                .timestamp
                                .as_ref()
                                .map(|t| t.to_rfc3339()),
                            severity: if d.success == Some(true) {
                                "info"
                            } else {
                                "warning"
                            }
                            .into(),
                            summary: format!(
                                "Compaction {} (checkpoint #{}): {} tokens before compaction",
                                if d.success == Some(true) {
                                    "succeeded"
                                } else {
                                    "failed"
                                },
                                d.checkpoint_number.unwrap_or(0),
                                d.pre_compaction_tokens.unwrap_or(0),
                            ),
                            detail_json: serde_json::to_string(&event.raw.data).ok(),
                        });
                    }
                }
                TypedEventData::SessionTruncation(d) => {
                    truncation_count += 1;
                    if incidents.len() < MAX_INCIDENTS_PER_SESSION {
                        incidents.push(IncidentRow {
                            event_type: "truncation".into(),
                            source_event_type: "session.truncation".into(),
                            timestamp: event
                                .raw
                                .timestamp
                                .as_ref()
                                .map(|t| t.to_rfc3339()),
                            severity: "warning".into(),
                            summary: format!(
                                "Truncated {} tokens ({} messages) by {}",
                                d.tokens_removed_during_truncation.unwrap_or(0),
                                d.messages_removed_during_truncation.unwrap_or(0),
                                d.performed_by.as_deref().unwrap_or("unknown"),
                            ),
                            detail_json: serde_json::to_string(&event.raw.data).ok(),
                        });
                    }
                }
                _ => {}
            }
        }

        for (name, (calls, success, failure, dur, dur_count)) in &tool_accum {
            tool_call_rows.push(ToolCallRow {
                name: name.clone(),
                calls: *calls,
                success: *success,
                failure: *failure,
                duration_ms: *dur,
                calls_with_duration: *dur_count,
            });
        }
        for ((day, hour), count) in &heatmap_accum {
            activity_rows.push(ActivityRow {
                day_of_week: *day,
                hour: *hour,
                tool_call_count: *count,
            });
        }
    }

    let final_tool_call_count = if actual_tool_call_count > 0 {
        Some(actual_tool_call_count)
    } else {
        None
    };

    // Modified files from shutdown metrics
    if let Some(ref metrics) = summary.shutdown_metrics {
        if let Some(ref cc) = metrics.code_changes {
            if let Some(ref files) = cc.files_modified {
                for file in files {
                    let ext = std::path::Path::new(file)
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|s| s.to_string());
                    modified_file_rows.push(ModifiedFileRow {
                        file_path: file.clone(),
                        extension: ext,
                    });
                }
            }
        }
    }

    // Health score
    let incident_counts = tracepilot_core::health::SessionIncidentCounts {
        error_count: error_count as usize,
        rate_limit_count: rate_limit_count as usize,
        warning_count: warning_count as usize,
        compaction_count: compaction_count as usize,
        truncation_count: truncation_count as usize,
    };
    let health = tracepilot_core::health::compute_health(
        summary.event_count,
        summary.shutdown_metrics.as_ref(),
        diagnostics,
        Some(&incident_counts),
    );

    SessionAnalytics {
        total_tokens,
        total_cost,
        lines_added,
        lines_removed,
        duration_ms,
        health_score: health.score,
        tool_call_count: final_tool_call_count,
        shutdown_type,
        current_model,
        total_premium_requests,
        total_api_duration_ms,
        workspace_mtime: file_meta.workspace_mtime.clone(),
        events_mtime: file_meta.events_mtime.clone(),
        events_size: file_meta.events_size,
        model_rows,
        tool_call_rows,
        activity_rows,
        modified_file_rows,
        fts_content,
        error_count,
        rate_limit_count,
        warning_count,
        compaction_count,
        truncation_count,
        last_error_type,
        last_error_message,
        total_compaction_input,
        total_compaction_output,
        incidents,
    }
}
