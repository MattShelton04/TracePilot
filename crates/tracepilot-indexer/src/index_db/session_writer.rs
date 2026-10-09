//! Session write operations: upsert, reindex detection, pruning.

use crate::Result;
use crate::error::IndexerError;
use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use std::sync::Arc;

use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::{
    CopilotProvider, ProviderSnapshot, SessionLocator, SessionProvider, SessionRole, SessionSource,
    SourceFingerprint,
};

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
/// Produced by [`prepare_snapshot`] (pure, no DB access — safe to run in parallel),
/// consumed by [`IndexDb::write_prepared_session`] (requires DB — must run sequentially).
pub(crate) struct PreparedSessionData {
    pub provider: Arc<dyn SessionProvider>,
    pub locator: SessionLocator,
    pub summary: tracepilot_core::SessionSummary,
    pub analytics: SessionAnalytics,
    pub index_info: SessionIndexInfo,
    pub fingerprint: SourceFingerprint,
    pub identity: SessionIdentity,
}

/// Which source wrote a session and where it sits in its family.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SessionIdentity {
    pub source: SessionSource,
    pub parent_session_id: Option<String>,
    pub role: SessionRole,
    /// The source's own format or tool version, when it records one.
    pub source_format_version: Option<String>,
}

impl SessionIdentity {
    pub(crate) fn from_locator(locator: &SessionLocator) -> Self {
        Self {
            source: locator.source,
            parent_session_id: locator.parent_id.as_ref().map(|id| id.as_str().to_string()),
            role: locator.role,
            source_format_version: None,
        }
    }
}

impl PreparedSessionData {
    /// Compute analytics for a loaded snapshot without any database interaction.
    pub(crate) fn from_snapshot(
        provider: Arc<dyn SessionProvider>,
        locator: SessionLocator,
        snapshot: ProviderSnapshot,
        identity: SessionIdentity,
    ) -> Self {
        let ProviderSnapshot {
            summary,
            events,
            turns,
            metrics,
            diagnostics,
            fingerprint,
            ..
        } = snapshot;
        let file_meta = SessionFileMeta::from_fingerprint(&fingerprint, &locator.primary_path);
        let mut analytics = extract_session_analytics(
            &summary,
            &events,
            turns.as_deref(),
            metrics.as_ref(),
            diagnostics.as_ref(),
            &file_meta,
        );
        if identity.source == SessionSource::ClaudeCode {
            analytics.total_cost = None;
            // No metrics means no recorded usage: it costs nothing, rather
            // than counting as unpriced.
            if metrics.is_none() {
                analytics.total_cost_usd = Some(0.0);
            }
        }
        let index_info = SessionIndexInfo {
            repository: summary.repository.clone(),
            branch: summary.branch.clone(),
            current_model: analytics.current_model.clone(),
            total_tokens: analytics.total_tokens.max(0) as u64,
            event_count: summary.event_count.unwrap_or(0),
            turn_count: summary.turn_count.unwrap_or(0),
        };
        Self {
            provider,
            locator,
            summary,
            analytics,
            index_info,
            fingerprint,
            identity,
        }
    }
}

/// Strictly load and analyze one session: the CPU/IO-bound part of indexing,
/// safe to run in parallel because it never touches the database.
pub(crate) fn prepare_snapshot(
    provider: &Arc<dyn SessionProvider>,
    locator: &SessionLocator,
    is_cancelled: &dyn Fn() -> bool,
) -> Result<PreparedSessionData> {
    let snapshot = provider.load_snapshot(locator, true, is_cancelled)?;
    Ok(PreparedSessionData::from_snapshot(
        Arc::clone(provider),
        locator.clone(),
        snapshot,
        SessionIdentity::from_locator(locator),
    ))
}

/// A Copilot session directory outside any registry (`upsert_session`).
pub(crate) fn copilot_session(session_path: &Path) -> (Arc<dyn SessionProvider>, SessionLocator) {
    let root = session_path.parent().unwrap_or(session_path);
    (
        Arc::new(CopilotProvider::new(root)),
        CopilotProvider::session_at(session_path),
    )
}

pub(crate) fn prepare_session_data(session_path: &Path) -> Result<PreparedSessionData> {
    let (provider, locator) = copilot_session(session_path);
    prepare_snapshot(&provider, &locator, &|| false)
}

/// Refuse to overwrite a row another source wrote. Ids are native UUIDs, so a
/// clash means two sources claim one id; the row already indexed is kept and
/// the clash is logged.
pub(crate) fn ensure_same_source(
    conn: &Connection,
    session_id: &str,
    incoming: SessionSource,
) -> Result<()> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT source FROM sessions WHERE id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()?;
    match existing {
        Some(existing) if existing != incoming.as_str() => {
            tracing::warn!(
                session_id,
                existing = %existing,
                incoming = incoming.as_str(),
                "Session id already indexed from another source; keeping the existing row"
            );
            Err(IndexerError::SourceConflict {
                session_id: session_id.to_string(),
                existing,
                incoming: incoming.as_str().to_string(),
            })
        }
        _ => Ok(()),
    }
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
        let session_path = &prepared.locator.primary_path;
        tracepilot_core::parsing::snapshot::ensure_unchanged(
            &prepared.fingerprint,
            &prepared.provider.fingerprint(&prepared.locator)?,
            session_path,
        )?;
        let source_fingerprint = prepared
            .provider
            .stored_fingerprint(&prepared.fingerprint)?;
        let summary = &prepared.summary;
        let analytics = &prepared.analytics;

        let identity = &prepared.identity;
        let index_info = prepared.index_info.clone();
        let session_id = summary.id.clone();

        // ── Write everything in a SAVEPOINT transaction ──────────────
        self.conn.execute_batch("SAVEPOINT upsert_session")?;

        let result = (|| -> Result<()> {
            ensure_same_source(&self.conn, &session_id, identity.source)?;
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
                    source_fingerprint, source, parent_session_id, role, hidden,
                    source_format_version, cost_usd, indexed_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                    ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20,
                    ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
                    ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38,
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
                    parent_session_id=excluded.parent_session_id,
                    role=excluded.role, hidden=excluded.hidden,
                    source_format_version=excluded.source_format_version,
                    cost_usd=excluded.cost_usd,
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
                    analytics_version(identity.source),
                    analytics.error_count,
                    analytics.rate_limit_count,
                    analytics.compaction_count,
                    analytics.truncation_count,
                    analytics.total_compaction_input,
                    analytics.total_compaction_output,
                    source_fingerprint,
                    identity.source.as_str(),
                    identity.parent_session_id,
                    identity.role.as_str(),
                    identity.role.hidden_by_default(),
                    identity.source_format_version,
                    analytics.total_cost_usd,
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

    /// Determine whether the Copilot session at `session_path` should be re-indexed.
    ///
    /// Accepts a validated [`SessionId`] so callers cannot accidentally pass a
    /// task/job ID or some other opaque string.
    pub fn needs_reindex(&self, session_id: &SessionId, session_path: &Path) -> bool {
        let (provider, mut locator) = copilot_session(session_path);
        locator.id = session_id.clone();
        self.session_is_stale(provider.as_ref(), &locator)
    }

    /// Whether the source fingerprint changed since the session was indexed,
    /// or the analytics version was bumped.
    pub(crate) fn session_is_stale(
        &self,
        provider: &dyn SessionProvider,
        locator: &SessionLocator,
    ) -> bool {
        let Ok(current) = provider
            .fingerprint(locator)
            .and_then(|fingerprint| provider.stored_fingerprint(&fingerprint))
        else {
            return true;
        };
        self.conn
            .query_row(
                "SELECT source_fingerprint, analytics_version FROM sessions WHERE id = ?1",
                [locator.id.as_str()],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<i64>>(1)?,
                    ))
                },
            )
            .map_or(true, |(source, version)| {
                source.as_deref() != Some(current.as_str())
                    || version.unwrap_or(0) < analytics_version(locator.source)
            })
    }
}

fn analytics_version(source: SessionSource) -> i64 {
    match source {
        SessionSource::ClaudeCode => CLAUDE_CODE_ANALYTICS_VERSION.max(CURRENT_ANALYTICS_VERSION),
        SessionSource::Copilot => CURRENT_ANALYTICS_VERSION,
    }
}
