//! Session write operations: upsert, reindex detection, pruning.

use crate::Result;
use rusqlite::params;
use std::path::Path;

use tracepilot_core::ids::SessionId;

use super::IndexDb;
use super::types::*;

mod analytics;
mod child_rows;
mod prune;

pub(crate) use analytics::extract_session_analytics;

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
            child_rows::delete_child_rows(&self.conn, &session_id)?;
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
                    duration_ms, events_mtime, events_size, analytics_version,
                    error_count, rate_limit_count, warning_count, compaction_count, truncation_count,
                    last_error_type, last_error_message, total_compaction_input_tokens, total_compaction_output_tokens,
                    indexed_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                    ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28,
                    ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37,
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
                    duration_ms=excluded.duration_ms,
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

            child_rows::write_child_rows(&self.conn, &session_id, analytics)?;

            Ok(())
        })();

        match result {
            Ok(()) => {
                self.conn.execute_batch("RELEASE upsert_session")?;
                Ok(index_info)
            }
            Err(e) => {
                // best-effort rollback/release: the primary error `e` is propagated regardless.
                if let Err(rb_err) = self.conn.execute_batch("ROLLBACK TO upsert_session") {
                    tracing::warn!(error = %rb_err, "ROLLBACK TO upsert_session failed");
                }
                if let Err(rel_err) = self.conn.execute_batch("RELEASE upsert_session") {
                    tracing::warn!(error = %rel_err, "RELEASE upsert_session failed");
                }
                Err(e)
            }
        }
    }

    /// Determine whether the session should be re-indexed.
    ///
    /// Checks workspace.yaml mtime, events.jsonl mtime+size, and analytics_version.
    ///
    /// Accepts a validated [`SessionId`] so callers cannot accidentally pass a
    /// task/job ID or some other opaque string.
    pub fn needs_reindex(&self, session_id: &SessionId, session_path: &Path) -> bool {
        let session_id = session_id.as_str();
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
}
