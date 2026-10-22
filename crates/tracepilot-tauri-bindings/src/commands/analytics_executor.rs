//! Generic analytics query executor with SQL fast-path and disk scan fallback.
//!
//! This module provides a reusable pattern for analytics commands that:
//! 1. Try to fetch from the SQLite index (fast path)
//! 2. Fall back to disk scan if the index can't answer and the scan covers
//!    the requested sources; otherwise report why, with the next step
//!
//! This eliminates ~40% code duplication across the three analytics commands.

use crate::commands::search::ensure_index_ready;
use crate::concurrency::IndexingSemaphores;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{open_index_db, read_config};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tracepilot_core::provider::SessionSource;
use tracepilot_indexer::index_db::IndexDb;

/// The next step when the session index can't answer and nothing stands in.
const REBUILD_HINT: &str = "Rebuild analytics in Settings to recreate the session index.";

/// Result type alias for analytics operations.
///
/// This is a convenience alias for operations that can fail with domain-specific errors
/// (e.g., IndexerError, CoreError) that are automatically converted to BindingsError.
pub type Result<T> = std::result::Result<T, BindingsError>;

/// Parameters for an analytics query.
///
/// These are the standard filter parameters that all analytics queries accept.
#[derive(Debug, Clone)]
pub struct AnalyticsQueryParams {
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub repo: Option<String>,
    pub hide_empty: bool,
    /// `None` covers every source.
    pub source: Option<SessionSource>,
}

impl AnalyticsQueryParams {
    /// Create params from the raw optional values passed to Tauri commands.
    pub fn from_options(
        from_date: Option<String>,
        to_date: Option<String>,
        repo: Option<String>,
        hide_empty: Option<bool>,
        source: Option<SessionSource>,
    ) -> Self {
        Self {
            from_date,
            to_date,
            repo,
            hide_empty: hide_empty.unwrap_or(false),
            source,
        }
    }

    /// The disk scan reads only Copilot session files, so it can stand in
    /// for the index only when the request covers Copilot sessions alone, or
    /// every source while Copilot is the only one enabled.
    fn disk_scan_covers_source(&self, copilot_only: bool) -> bool {
        match self.source {
            Some(SessionSource::Copilot) => true,
            None => copilot_only,
            Some(_) => false,
        }
    }

    /// Why the disk scan can't stand in for a missing or unreadable index.
    fn index_unavailable_error(&self) -> BindingsError {
        let scope = match self.source {
            Some(SessionSource::ClaudeCode) => "Claude Code sessions",
            Some(SessionSource::Copilot) => "Copilot sessions",
            None => "all sources",
        };
        BindingsError::Internal(format!(
            "Analytics for {scope} need the session index, which couldn't be opened. \
             {REBUILD_HINT}"
        ))
    }

    /// Convert to references for passing to SQL query functions.
    pub fn as_refs(
        &self,
    ) -> (
        Option<&str>,
        Option<&str>,
        Option<&str>,
        bool,
        Option<SessionSource>,
    ) {
        (
            self.from_date.as_deref(),
            self.to_date.as_deref(),
            self.repo.as_deref(),
            self.hide_empty,
            self.source,
        )
    }
}

/// Context extracted from SharedConfig for analytics queries.
///
/// This avoids passing the full SharedConfig into the spawn_blocking closure.
#[derive(Clone)]
pub struct AnalyticsContext {
    pub index_path: PathBuf,
    pub session_state_dir: PathBuf,
    /// Copilot is the only enabled source, so the Copilot-only disk scan
    /// covers a request for every source.
    pub copilot_only: bool,
    /// Serialises disk-scan fallbacks. `None` in unit tests.
    pub gates: Option<Arc<IndexingSemaphores>>,
}

impl AnalyticsContext {
    /// Make sure the index is ready (building it once, shared by all
    /// concurrent callers), then extract the query context.
    pub async fn prepare(
        state: &tauri::State<'_, SharedConfig>,
        gates: &tauri::State<'_, Arc<IndexingSemaphores>>,
        app: &tauri::AppHandle,
    ) -> Self {
        ensure_index_ready(state, gates.inner(), app).await;
        let cfg = read_config(state);
        Self {
            index_path: cfg.index_db_path(),
            session_state_dir: cfg.session_state_dir(),
            copilot_only: crate::providers::claude_code_root(&cfg).is_none(),
            gates: Some(Arc::clone(gates.inner())),
        }
    }
}

/// Execute an analytics query with SQL fast-path and disk scan fallback.
///
/// This generic function encapsulates the two-phase pattern used by all analytics commands:
/// 1. If the index database has sessions, run the SQL query (fast path).
/// 2. If the index is missing, unreadable or empty, or the query fails, fall
///    back to loading from disk and computing. The disk scan sees only Copilot
///    sessions, so it answers only a request it covers: Copilot sessions, or
///    every source while Copilot is the only one enabled. It also answers every
///    source in place of an empty index, which holds no other source's rows
///    either. Otherwise an empty index answers, and a missing or unreadable
///    index or a failed query is an error carrying its cause and the next step.
///
/// # Type Parameters
///
/// - `T`: The return type of the analytics query
/// - `SqlFn`: Function that executes the SQL query against the index database
/// - `FallbackFn`: Function that loads data from disk and computes the result
///
/// # Arguments
///
/// - `ctx`: Analytics context with index and session paths
/// - `params`: Query filter parameters
/// - `query_name`: Name of the query (for logging)
/// - `sql_fn`: Function to execute SQL query: `fn(&IndexDb, params) -> Result<T>`
/// - `fallback_fn`: Function to compute from disk: `fn(&PathBuf, params) -> Result<T>`
///
/// # Example
///
/// ```ignore
/// let result = execute_analytics_query(
///     ctx,
///     params,
///     "analytics",
///     |db, p| {
///         let (from, to, repo, hide, source) = p.as_refs();
///         db.query_analytics(from, to, repo, hide, source)
///     },
///     |session_dir, p| {
///         let (from, to, repo, hide, _) = p.as_refs();
///         let inputs = load_full_sessions_filtered(session_dir, from, to, repo, hide)?;
///         Ok(compute_analytics_in_range(&inputs, from, to))
///     },
/// ).await?;
/// ```
pub async fn execute_analytics_query<T, SqlFn, FallbackFn>(
    ctx: AnalyticsContext,
    params: AnalyticsQueryParams,
    query_name: &str,
    sql_fn: SqlFn,
    fallback_fn: FallbackFn,
) -> CmdResult<T>
where
    T: Send + 'static,
    SqlFn: FnOnce(&IndexDb, &AnalyticsQueryParams) -> Result<T> + Send + 'static,
    FallbackFn: FnOnce(&PathBuf, &AnalyticsQueryParams) -> Result<T> + Send + 'static,
{
    let disk_scan_covers = params.disk_scan_covers_source(ctx.copilot_only);
    let sql_params = params.clone();
    let query_name = query_name.to_string();
    let index_path = ctx.index_path.clone();

    // Phase 1: SQL fast path. Normally the only path: `AnalyticsContext::prepare`
    // has already built the index if it was missing.
    let sql = tokio::task::spawn_blocking(move || {
        let db = match open_index_db(&index_path) {
            Some(opened) => opened.db,
            None if disk_scan_covers => return Ok(None),
            // The scan would miss other sources' sessions, unless the index
            // opens but holds no sessions: it has none of theirs either, so
            // the scan is at least as complete for every source. A request
            // for another source alone answers from the empty index.
            None => match open_empty_index(&index_path) {
                Some(_) if sql_params.source.is_none() => return Ok(None),
                Some(db) => db,
                None => return Err(sql_params.index_unavailable_error()),
            },
        };
        match sql_fn(&db, &sql_params) {
            Ok(result) => Ok(Some(result)),
            Err(e) if disk_scan_covers => {
                tracing::warn!(
                    "{query_name} query against the session index failed, \
                     falling back to disk scan: {e}"
                );
                Ok(None)
            }
            Err(e) => {
                tracing::warn!("{query_name} query against the session index failed: {e}");
                Err(with_rebuild_hint(e))
            }
        }
    })
    .await??;
    if let Some(result) = sql {
        return Ok(result);
    }

    // Phase 2: disk-scan fallback, one at a time — each scan parses the whole
    // corpus and concurrent scans multiply peak memory.
    let _scan = match &ctx.gates {
        Some(gates) => Some(gates.acquire_disk_scan().await),
        None => None,
    };
    tokio::task::spawn_blocking(move || fallback_fn(&ctx.session_state_dir, &params)).await?
}

/// A failed query's indexer error with the next step appended, keeping its
/// INDEXER code. Any other error passes through with its own code.
fn with_rebuild_hint(error: BindingsError) -> BindingsError {
    let BindingsError::Indexer(cause) = error else {
        return error;
    };
    let cause = cause.to_string();
    let cause = cause.trim_end();
    let separator = if cause.ends_with('.') { " " } else { ". " };
    BindingsError::Indexer(tracepilot_indexer::IndexerError::Io(std::io::Error::other(
        format!("{cause}{separator}{REBUILD_HINT}"),
    )))
}

/// The index at `path` when it opens and holds no sessions, which
/// [`open_index_db`] treats the same as a missing one.
fn open_empty_index(path: &Path) -> Option<IndexDb> {
    if !path.exists() {
        return None;
    }
    let db = IndexDb::open_readonly(path).ok()?;
    (db.session_count().ok()? == 0).then_some(db)
}

#[cfg(test)]
#[path = "analytics_executor_tests.rs"]
mod tests;
