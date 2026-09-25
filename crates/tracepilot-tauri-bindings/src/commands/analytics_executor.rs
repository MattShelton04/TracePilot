//! Generic analytics query executor with SQL fast-path and disk scan fallback.
//!
//! This module provides a reusable pattern for analytics commands that:
//! 1. Try to fetch from the SQLite index (fast path)
//! 2. Fall back to disk scan if index unavailable or query fails
//!
//! This eliminates ~40% code duplication across the three analytics commands.

use crate::commands::search::ensure_index_ready;
use crate::concurrency::IndexingSemaphores;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{open_index_db, read_config};
use std::path::PathBuf;
use std::sync::Arc;
use tracepilot_indexer::index_db::IndexDb;

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
}

impl AnalyticsQueryParams {
    /// Create params from the raw optional values passed to Tauri commands.
    pub fn from_options(
        from_date: Option<String>,
        to_date: Option<String>,
        repo: Option<String>,
        hide_empty: Option<bool>,
    ) -> Self {
        Self {
            from_date,
            to_date,
            repo,
            hide_empty: hide_empty.unwrap_or(false),
        }
    }

    /// Convert to references for passing to SQL query functions.
    pub fn as_refs(&self) -> (Option<&str>, Option<&str>, Option<&str>, bool) {
        (
            self.from_date.as_deref(),
            self.to_date.as_deref(),
            self.repo.as_deref(),
            self.hide_empty,
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
            gates: Some(Arc::clone(gates.inner())),
        }
    }
}

/// Execute an analytics query with SQL fast-path and disk scan fallback.
///
/// This generic function encapsulates the two-phase pattern used by all analytics commands:
/// 1. If the index database is available, try the SQL query (fast path)
/// 2. If unavailable or query fails, fall back to loading from disk and computing
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
///         let (from, to, repo, hide) = p.as_refs();
///         db.query_analytics(from, to, repo, hide)
///     },
///     |session_dir, p| {
///         let (from, to, repo, hide) = p.as_refs();
///         let inputs = load_full_sessions_filtered(session_dir, from, to, repo, hide)?;
///         Ok(compute_analytics(&inputs))
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
    let params_for_fallback = params.clone();
    let query_name = query_name.to_string();
    let index_path = ctx.index_path.clone();

    // Phase 1: SQL fast path. Normally the only path: `AnalyticsContext::prepare`
    // has already built the index if it was missing.
    let sql = tokio::task::spawn_blocking(move || {
        let opened = open_index_db(&index_path)?;
        match sql_fn(&opened.db, &params) {
            Ok(result) => Some(Ok(result)),
            Err(e) => {
                tracing::warn!(
                    "{} SQL fast path failed, falling back to disk scan: {}",
                    query_name,
                    e
                );
                Some(Err(params))
            }
        }
    })
    .await?;
    let params = match sql {
        Some(Ok(result)) => return Ok(result),
        Some(Err(params)) => params,
        None => params_for_fallback,
    };

    // Phase 2: disk-scan fallback, one at a time — each scan parses the whole
    // corpus and concurrent scans multiply peak memory.
    let _scan = match &ctx.gates {
        Some(gates) => Some(gates.acquire_disk_scan().await),
        None => None,
    };
    tokio::task::spawn_blocking(move || fallback_fn(&ctx.session_state_dir, &params)).await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_analytics_query_params_from_options() {
        let params = AnalyticsQueryParams::from_options(
            Some("2026-01-01".to_string()),
            Some("2026-01-31".to_string()),
            Some("myrepo".to_string()),
            Some(true),
        );

        assert_eq!(params.from_date, Some("2026-01-01".to_string()));
        assert_eq!(params.to_date, Some("2026-01-31".to_string()));
        assert_eq!(params.repo, Some("myrepo".to_string()));
        assert!(params.hide_empty);
    }

    #[test]
    fn test_analytics_query_params_defaults() {
        let params = AnalyticsQueryParams::from_options(None, None, None, None);

        assert!(params.from_date.is_none());
        assert!(params.to_date.is_none());
        assert!(params.repo.is_none());
        assert!(!params.hide_empty);
    }

    #[test]
    fn test_analytics_query_params_as_refs() {
        let params = AnalyticsQueryParams {
            from_date: Some("2026-01-01".to_string()),
            to_date: Some("2026-01-31".to_string()),
            repo: Some("myrepo".to_string()),
            hide_empty: true,
        };

        let (from, to, repo, hide) = params.as_refs();

        assert_eq!(from, Some("2026-01-01"));
        assert_eq!(to, Some("2026-01-31"));
        assert_eq!(repo, Some("myrepo"));
        assert!(hide);
    }

    #[test]
    fn test_analytics_context_paths() {
        let ctx = AnalyticsContext {
            index_path: PathBuf::from("/tmp/index.db"),
            session_state_dir: PathBuf::from("/tmp/sessions"),
            gates: None,
        };

        assert_eq!(ctx.index_path, Path::new("/tmp/index.db"));
        assert_eq!(ctx.session_state_dir, Path::new("/tmp/sessions"));
    }
}
