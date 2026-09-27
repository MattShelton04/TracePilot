//! Session write operations: upsert, reindex detection, pruning.

use crate::Result;
use rusqlite::params;
use std::path::Path;

use tracepilot_core::ids::SessionId;

use super::IndexDb;
use super::types::*;

mod agent_runs;
mod analytics;
mod child_rows;
mod prompt_cache;
mod prune;
mod skill_invocations;

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
    pub fingerprint: tracepilot_core::summary::SessionFingerprint,
}

/// Parse and compute analytics for a session without any database interaction.
///
/// This is the CPU/IO-bound portion of indexing that can be safely parallelized
/// with Rayon since it only reads files and runs pure computation.
pub(crate) fn prepare_session_data(session_path: &Path) -> Result<PreparedSessionData> {
    let (load_result, fingerprint) =
        tracepilot_core::summary::load_session_snapshot(session_path, &|| false)?;
    let summary = load_result.summary;
    let typed_events = load_result.typed_events;
    let diagnostics = load_result.diagnostics;

    let file_meta = SessionFileMeta::from_fingerprint(&fingerprint);

    let analytics = extract_session_analytics(
        &summary,
        &typed_events,
        load_result.turns.as_deref(),
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

    Ok(PreparedSessionData {
        session_path: session_path.to_path_buf(),
        summary,
        analytics,
        index_info,
        fingerprint,
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
        tracepilot_core::parsing::snapshot::ensure_unchanged(
            &prepared.fingerprint,
            &tracepilot_core::summary::SessionFingerprint::read(&prepared.session_path)?,
            &prepared.session_path,
        )?;
        let source_fingerprint = serde_json::to_string(&prepared.fingerprint)?;
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
                    current_model, copilot_version, total_premium_requests, total_api_duration_ms,
                    total_nano_aiu,
                    workspace_mtime,
                    total_tokens, total_cost, tool_call_count, lines_added, lines_removed,
                    events_mtime, events_size, analytics_version,
                    error_count, rate_limit_count, compaction_count, truncation_count,
                    total_compaction_input_tokens, total_compaction_output_tokens,
                    source_fingerprint, indexed_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
                    ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
                    ?31, ?32,
                    datetime('now')
                )
                ON CONFLICT(id) DO UPDATE SET
                    path=excluded.path, summary=excluded.summary, repository=excluded.repository,
                    branch=excluded.branch, cwd=excluded.cwd, host_type=excluded.host_type,
                    created_at=excluded.created_at, updated_at=excluded.updated_at,
                    event_count=excluded.event_count, turn_count=excluded.turn_count,
                    current_model=excluded.current_model,
                    copilot_version=excluded.copilot_version,
                    total_premium_requests=excluded.total_premium_requests,
                    total_api_duration_ms=excluded.total_api_duration_ms,
                    total_nano_aiu=excluded.total_nano_aiu,
                    workspace_mtime=excluded.workspace_mtime,
                    total_tokens=excluded.total_tokens, total_cost=excluded.total_cost,
                    tool_call_count=excluded.tool_call_count,
                    lines_added=excluded.lines_added, lines_removed=excluded.lines_removed,
                    events_mtime=excluded.events_mtime, events_size=excluded.events_size,
                    analytics_version=excluded.analytics_version,
                    error_count=excluded.error_count, rate_limit_count=excluded.rate_limit_count,
                    compaction_count=excluded.compaction_count,
                    truncation_count=excluded.truncation_count,
                    total_compaction_input_tokens=excluded.total_compaction_input_tokens,
                    total_compaction_output_tokens=excluded.total_compaction_output_tokens,
                    source_fingerprint=excluded.source_fingerprint,
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
                    analytics.current_model,
                    analytics.copilot_version,
                    analytics.total_premium_requests,
                    analytics.total_api_duration_ms,
                    analytics.total_nano_aiu,
                    analytics.workspace_mtime,
                    analytics.total_tokens,
                    analytics.total_cost,
                    analytics.tool_call_count,
                    analytics.lines_added,
                    analytics.lines_removed,
                    analytics.events_mtime,
                    analytics.events_size,
                    CURRENT_ANALYTICS_VERSION,
                    analytics.error_count,
                    analytics.rate_limit_count,
                    analytics.compaction_count,
                    analytics.truncation_count,
                    analytics.total_compaction_input,
                    analytics.total_compaction_output,
                    source_fingerprint,
                ],
            )?;

            child_rows::write_child_rows(&self.conn, &session_id, analytics)?;
            agent_runs::write_agent_rows(&self.conn, &session_id, &analytics.agent_runs)?;
            skill_invocations::write_skill_invocation_rows(
                &self.conn,
                &session_id,
                &analytics.skill_invocations,
            )?;

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
        let Ok(current) = tracepilot_core::summary::SessionFingerprint::read(session_path) else {
            return true;
        };
        let Ok(current) = serde_json::to_string(&current) else {
            return true;
        };
        self.conn
            .query_row(
                "SELECT source_fingerprint, analytics_version FROM sessions WHERE id = ?1",
                [session_id.as_str()],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                    ))
                },
            )
            .map_or(true, |(source, version)| {
                source.as_deref() != Some(current.as_str())
                    || version.unwrap_or(0) < CURRENT_ANALYTICS_VERSION
            })
    }
}
