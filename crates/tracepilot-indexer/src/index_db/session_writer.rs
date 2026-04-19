//! Session write operations: upsert, reindex detection, pruning.

use crate::Result;
use rusqlite::params;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use tracepilot_core::parsing::events::TypedEventData;

use super::IndexDb;
use super::types::*;

/// Pre-computed session data ready for DB insertion.
///
/// Produced by [`prepare_session_data`] (pure, no DB access — safe to run in parallel),
/// consumed by [`IndexDb::write_prepared_session`] (requires DB — must run sequentially).
pub(crate) struct PreparedSessionData {
    pub session_path: std::path::PathBuf,
    pub summary: tracepilot_core::SessionSummary,
    pub analytics: SessionAnalytics,
    pub index_info: SessionIndexInfo,
}

/// Parse and compute analytics for a session without any database interaction.
///
/// This is the CPU/IO-bound portion of indexing that can be safely parallelized
/// with Rayon since it only reads files and runs pure computation.
pub(crate) fn prepare_session_data(session_path: &Path) -> Result<PreparedSessionData> {
    let load_result = tracepilot_core::summary::load_session_summary_with_events(session_path)?;
    let summary = load_result.summary;
    let typed_events = load_result.typed_events;
    let diagnostics = load_result.diagnostics;

    let file_meta = SessionFileMeta::from_session_path(session_path);

    let analytics =
        extract_session_analytics(&summary, &typed_events, diagnostics.as_ref(), &file_meta);

    let index_info = SessionIndexInfo {
        repository: summary.repository.clone(),
        branch: summary.branch.clone(),
        current_model: analytics.current_model.clone(),
        total_tokens: analytics.total_tokens.max(0) as u64,
        event_count: summary.event_count.unwrap_or(0),
        turn_count: summary.turn_count.unwrap_or(0),
    };

    Ok(PreparedSessionData {
        session_path: session_path.to_path_buf(),
        summary,
        analytics,
        index_info,
    })
}

impl IndexDb {
    /// Insert or update a session in the index, computing analytics from events.
    pub fn upsert_session(&self, session_path: &Path) -> Result<SessionIndexInfo> {
        let prepared = prepare_session_data(session_path)?;
        self.write_prepared_session(&prepared)
    }

    /// Delete rows from all session child tables for a given session_id.
    ///
    /// Consolidates the 6 individual DELETE statements into a single helper.
    /// Table names are hardcoded constants (not dynamic) so there is no SQL
    /// injection risk.
    fn delete_child_rows(&self, session_id: &str) -> Result<()> {
        const DELETE_SQLS: &[&str] = &[
            "DELETE FROM session_model_metrics WHERE session_id = ?1",
            "DELETE FROM session_tool_calls WHERE session_id = ?1",
            "DELETE FROM session_modified_files WHERE session_id = ?1",
            "DELETE FROM session_activity WHERE session_id = ?1",
            "DELETE FROM session_incidents WHERE session_id = ?1",
            "DELETE FROM session_segments WHERE session_id = ?1",
        ];

        for sql in DELETE_SQLS {
            self.conn.execute(sql, [session_id])?;
        }
        Ok(())
    }

    /// Write pre-computed session data to the index database.
    ///
    /// This is the DB-bound portion of indexing that must run sequentially
    /// (rusqlite::Connection is !Send).
    pub(crate) fn write_prepared_session(
        &self,
        prepared: &PreparedSessionData,
    ) -> Result<SessionIndexInfo> {
        let summary = &prepared.summary;
        let analytics = &prepared.analytics;
        let session_path = &prepared.session_path;

        let index_info = prepared.index_info.clone();
        let session_id = summary.id.clone();

        // ── Write everything in a SAVEPOINT transaction ──────────────
        self.conn.execute_batch("SAVEPOINT upsert_session")?;

        let result = (|| -> Result<()> {
            // Delete child table rows first
            self.delete_child_rows(&session_id)?;
            // NOTE: search_content is NOT deleted here — it's managed by Phase 2 (search_writer).
            // Phase 2 may not run immediately (semaphore busy), so deleting here would
            // leave a gap where the session has no search content until the next Phase 2 cycle.
            // The CASCADE FK on sessions.id handles cleanup when sessions are truly removed.

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

            // ──────────────────────────────────────────────────────────────
            // INSERT child rows using multi-row VALUES batching
            // ──────────────────────────────────────────────────────────────
            // Builds INSERT ... VALUES (...),(...),... in chunks of 100,
            // reducing round-trips from N to ceil(N/100).
            // ──────────────────────────────────────────────────────────────
            use super::batch_insert::batched_insert;

            batched_insert(
                &self.conn,
                "INSERT INTO session_model_metrics \
                    (session_id, model_name, input_tokens, output_tokens, \
                     cache_read_tokens, cache_write_tokens, cost, request_count, reasoning_tokens) VALUES",
                9,
                &analytics.model_rows,
                |row, params| {
                    params.push(&session_id as &dyn rusqlite::ToSql);
                    params.push(&row.model);
                    params.push(&row.input_tokens);
                    params.push(&row.output_tokens);
                    params.push(&row.cache_read_tokens);
                    params.push(&row.cache_write_tokens);
                    params.push(&row.cost);
                    params.push(&row.premium_requests);
                    match &row.reasoning_tokens {
                        Some(v) => params.push(v),
                        None => params.push(&rusqlite::types::Null),
                    }
                },
            )?;

            batched_insert(
                &self.conn,
                "INSERT INTO session_tool_calls \
                    (session_id, tool_name, call_count, success_count, \
                     failure_count, total_duration_ms, calls_with_duration) VALUES",
                7,
                &analytics.tool_call_rows,
                |row, params| {
                    params.push(&session_id as &dyn rusqlite::ToSql);
                    params.push(&row.name);
                    params.push(&row.calls);
                    params.push(&row.success);
                    params.push(&row.failure);
                    params.push(&row.duration_ms);
                    params.push(&row.calls_with_duration);
                },
            )?;

            batched_insert(
                &self.conn,
                "INSERT OR IGNORE INTO session_modified_files \
                    (session_id, file_path, extension) VALUES",
                3,
                &analytics.modified_file_rows,
                |row, params| {
                    params.push(&session_id as &dyn rusqlite::ToSql);
                    params.push(&row.file_path);
                    match &row.extension {
                        Some(ext) => params.push(ext),
                        None => params.push(&rusqlite::types::Null),
                    }
                },
            )?;

            batched_insert(
                &self.conn,
                "INSERT INTO session_activity \
                    (session_id, day_of_week, hour, tool_call_count) VALUES",
                4,
                &analytics.activity_rows,
                |row, params| {
                    params.push(&session_id as &dyn rusqlite::ToSql);
                    params.push(&row.day_of_week);
                    params.push(&row.hour);
                    params.push(&row.tool_call_count);
                },
            )?;

            batched_insert(
                &self.conn,
                "INSERT INTO session_segments \
                    (session_id, start_timestamp, end_timestamp, total_tokens, \
                     total_requests, total_premium_requests, total_api_duration_ms, \
                     current_model, model_metrics_json) VALUES",
                9,
                &analytics.session_segment_rows,
                |row, params| {
                    params.push(&session_id as &dyn rusqlite::ToSql);
                    params.push(&row.start_timestamp);
                    params.push(&row.end_timestamp);
                    params.push(&row.tokens);
                    params.push(&row.total_requests);
                    params.push(&row.premium_requests);
                    params.push(&row.api_duration_ms);
                    match &row.current_model {
                        Some(m) => params.push(m),
                        None => params.push(&rusqlite::types::Null),
                    }
                    match &row.model_metrics_json {
                        Some(j) => params.push(j),
                        None => params.push(&rusqlite::types::Null),
                    }
                },
            )?;

            batched_insert(
                &self.conn,
                "INSERT INTO session_incidents \
                    (session_id, event_type, source_event_type, timestamp, \
                     severity, summary, detail_json) VALUES",
                7,
                &analytics.incidents,
                |inc, params| {
                    params.push(&session_id as &dyn rusqlite::ToSql);
                    params.push(&inc.event_type);
                    params.push(&inc.source_event_type);
                    match &inc.timestamp {
                        Some(t) => params.push(t),
                        None => params.push(&rusqlite::types::Null),
                    }
                    params.push(&inc.severity);
                    params.push(&inc.summary);
                    match &inc.detail_json {
                        Some(d) => params.push(d),
                        None => params.push(&rusqlite::types::Null),
                    }
                },
            )?;

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

    /// Determine whether the session should be re-indexed.
    ///
    /// Checks workspace.yaml mtime, events.jsonl mtime+size, and analytics_version.
    pub fn needs_reindex(&self, session_id: &str, session_path: &Path) -> bool {
        let current_ws_mtime = get_workspace_mtime(session_path);
        let current_events = get_events_mtime_and_size(session_path);

        let stored: Option<super::types::StalenessRow> = self
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
            tracing::debug!(session_id, "needs_reindex: not in DB");
            return true;
        };

        if stored_av.unwrap_or(0) < CURRENT_ANALYTICS_VERSION {
            tracing::debug!(
                session_id,
                stored = stored_av.unwrap_or(0),
                current = CURRENT_ANALYTICS_VERSION,
                "needs_reindex: analytics_version"
            );
            return true;
        }

        if stored_ws_mtime.as_deref() != current_ws_mtime.as_deref() {
            tracing::debug!(session_id, "needs_reindex: workspace_mtime changed");
            return true;
        }

        match (&current_events, &stored_ev_mtime) {
            (Some((cur_mtime, cur_size)), Some(st_mtime)) => {
                if cur_mtime != st_mtime || Some(*cur_size as i64) != stored_ev_size {
                    tracing::debug!(session_id, "needs_reindex: events file changed");
                    return true;
                }
            }
            (Some(_), None) => {
                tracing::debug!(session_id, "needs_reindex: events exist but not stored");
                return true;
            }
            (None, Some(_)) => {
                tracing::debug!(session_id, "needs_reindex: events gone");
                return true;
            }
            (None, None) => {}
        }

        false
    }

    /// Remove sessions from the index whose IDs are not in the given set of live IDs.
    ///
    /// Uses a batch DELETE with temp table to avoid exceeding SQLITE_MAX_VARIABLE_NUMBER.
    /// Child tables cascade via foreign keys.
    pub fn prune_deleted(&self, live_ids: &HashSet<&str>) -> Result<usize> {
        let indexed_ids = self.all_indexed_ids()?;
        let stale: Vec<&String> = indexed_ids
            .iter()
            .filter(|id| !live_ids.contains(id.as_str()))
            .collect();
        let count = stale.len();
        if count == 0 {
            return Ok(0);
        }

        self.conn.execute_batch("BEGIN")?;
        let result = (|| -> Result<()> {
            // Use json_each() to pass all live IDs as a single JSON array parameter,
            // avoiding the N individual INSERT statements into a temp table.
            let live_json = serde_json::to_string(&live_ids.iter().collect::<Vec<_>>())
                .expect("string serialization is infallible");

            self.conn.execute(
                "DELETE FROM sessions WHERE id NOT IN (SELECT value FROM json_each(?1))",
                [&live_json],
            )?;
            self.conn.execute(
                "DELETE FROM search_content WHERE session_id NOT IN (SELECT value FROM json_each(?1))",
                [&live_json],
            )?;
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
pub(crate) fn extract_session_analytics(
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
    let mut session_segment_rows: Vec<SessionSegmentRow> = Vec::new();

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
        if let (Some(start_time), Some(updated)) = (metrics.session_start_time, summary.updated_at)
        {
            let end_ms = updated.timestamp_millis() as u64;
            if end_ms > start_time {
                duration_ms = Some((end_ms - start_time) as i64);
            }
        }

        for (model_name, detail) in &metrics.model_metrics {
            let (input_t, output_t, cache_read, cache_write, reasoning) =
                if let Some(ref usage) = detail.usage {
                    (
                        usage.input_tokens.unwrap_or(0) as i64,
                        usage.output_tokens.unwrap_or(0) as i64,
                        usage.cache_read_tokens.unwrap_or(0) as i64,
                        usage.cache_write_tokens.unwrap_or(0) as i64,
                        usage.reasoning_tokens.map(|v| v as i64),
                    )
                } else {
                    (0, 0, 0, 0, None)
                };
            let model_tokens = input_t + output_t;
            total_tokens += model_tokens;

            let cost = detail.requests.as_ref().and_then(|r| r.cost).unwrap_or(0.0);
            total_cost += cost;

            let req_count = detail.requests.as_ref().and_then(|r| r.count).unwrap_or(0) as i64;

            model_rows.push(ModelMetricsRow {
                model: model_name.clone(),
                input_tokens: input_t,
                output_tokens: output_t,
                cache_read_tokens: cache_read,
                cache_write_tokens: cache_write,
                cost,
                premium_requests: req_count,
                reasoning_tokens: reasoning,
            });
        }

        if let Some(ref cc) = metrics.code_changes {
            lines_added = cc.lines_added.map(|v| v as i64);
            lines_removed = cc.lines_removed.map(|v| v as i64);
        }

        if let Some(ref segments) = metrics.session_segments {
            for seg in segments {
                let mut tokens: i64 = 0;
                if let Some(ref mm) = seg.model_metrics {
                    for detail in mm.values() {
                        if let Some(ref usage) = detail.usage {
                            tokens += (usage.input_tokens.unwrap_or(0)
                                + usage.output_tokens.unwrap_or(0))
                                as i64;
                        }
                    }
                }

                let mm_json = seg
                    .model_metrics
                    .as_ref()
                    .and_then(|mm| serde_json::to_string(mm).ok());
                session_segment_rows.push(SessionSegmentRow {
                    start_timestamp: seg.start_timestamp.clone(),
                    end_timestamp: seg.end_timestamp.clone(),
                    tokens,
                    total_requests: seg.total_requests as i64,
                    premium_requests: seg.premium_requests,
                    api_duration_ms: seg.api_duration_ms as i64,
                    current_model: seg.current_model.clone(),
                    model_metrics_json: mm_json,
                });
            }
        }
    }

    // ── Extract event-level analytics (single pass) ────────────
    let mut tool_call_rows: Vec<ToolCallRow> = Vec::new();
    let mut activity_rows: Vec<ActivityRow> = Vec::new();
    let mut modified_file_rows: Vec<ModifiedFileRow> = Vec::new();
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
                TypedEventData::UserMessage(_) => {
                    // FTS content extraction moved to search_writer (Phase 2)
                }
                TypedEventData::AssistantMessage(_) => {
                    // FTS content extraction moved to search_writer (Phase 2)
                }
                TypedEventData::ToolExecutionStart(d) => {
                    if let Some(ref tool_call_id) = d.tool_call_id {
                        let name = d.tool_name.clone().unwrap_or_else(|| "unknown".into());
                        tool_starts.insert(tool_call_id.clone(), (name, event.raw.timestamp));
                    }
                }
                TypedEventData::ToolExecutionComplete(d) => {
                    actual_tool_call_count += 1;
                    if let Some(ref tool_call_id) = d.tool_call_id
                        && let Some((tool_name, start_ts)) = tool_starts.remove(tool_call_id)
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

                        if let (Some(start), Some(end)) = (start_ts, event.raw.timestamp) {
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
                            timestamp: event.raw.timestamp.as_ref().map(|t| t.to_rfc3339()),
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
                            timestamp: event.raw.timestamp.as_ref().map(|t| t.to_rfc3339()),
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
                            timestamp: event.raw.timestamp.as_ref().map(|t| t.to_rfc3339()),
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
                            timestamp: event.raw.timestamp.as_ref().map(|t| t.to_rfc3339()),
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
    if let Some(ref metrics) = summary.shutdown_metrics
        && let Some(ref cc) = metrics.code_changes
        && let Some(ref files) = cc.files_modified
    {
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
        session_segment_rows,
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
