//! Shared helper functions used by multiple command modules.

use crate::config::{SharedConfig, TracePilotConfig};
use crate::error::{BindingsError, CmdResult};
use crate::types::{IndexingProgressPayload, SessionListItem};
use std::path::{Path, PathBuf};
use tauri::Emitter;

pub(crate) const MAX_CHECKPOINT_CONTENT_BYTES: usize = 50 * 1024;

/// Resolve a session directory path and run a blocking closure with it.
///
/// Encapsulates the standard pattern used by most single-session commands:
/// 1. Read `session_state_dir` from shared config
/// 2. Spawn a blocking task to resolve the session path on disk
/// 3. Execute command-specific logic with the resolved `PathBuf`
///
/// This eliminates repeated boilerplate across session, export, and state
/// commands.  For the analytics equivalent, see
/// [`analytics_executor::execute_analytics_query`](super::commands::analytics_executor::execute_analytics_query).
pub(crate) async fn with_session_path<T, F>(
    state: &SharedConfig,
    session_id: String,
    f: F,
) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(PathBuf) -> Result<T, BindingsError> + Send + 'static,
{
    let session_state_dir = read_config(state).session_state_dir();

    tokio::task::spawn_blocking(move || {
        let path = tracepilot_core::session::discovery::resolve_session_path_in(
            &session_id,
            &session_state_dir,
        )?;
        f(path)
    })
    .await?
}

/// Convert an `IndexingProgress` from the indexer into our Tauri event payload and emit it.
pub(crate) fn emit_indexing_progress(
    app: &tauri::AppHandle,
    progress: &tracepilot_indexer::IndexingProgress,
) {
    let session = progress.session_info.as_ref();
    let payload = IndexingProgressPayload {
        current: progress.current,
        total: progress.total,
        session_repo: session.and_then(|s| s.repository.clone()),
        session_branch: session.and_then(|s| s.branch.clone()),
        session_model: session.and_then(|s| s.current_model.clone()),
        session_tokens: session.map(|s| s.total_tokens).unwrap_or(0),
        session_events: session.map(|s| s.event_count).unwrap_or(0),
        session_turns: session.map(|s| s.turn_count).unwrap_or(0),
        total_tokens: progress.running_tokens,
        total_events: progress.running_events,
        total_repos: progress.running_repos,
    };
    let _ = app.emit("indexing-progress", payload);
}

/// Read config from shared state, falling back to defaults.
pub(crate) fn read_config(state: &SharedConfig) -> TracePilotConfig {
    match state.read() {
        Ok(guard) => guard.clone().unwrap_or_default(),
        Err(poisoned) => {
            tracing::error!("Config RwLock poisoned — recovering inner value");
            poisoned.into_inner().clone().unwrap_or_default()
        }
    }
}

pub(crate) fn summary_to_list_item(
    summary: tracepilot_core::SessionSummary,
    session_path: &Path,
) -> SessionListItem {
    let is_running = tracepilot_core::session::discovery::has_lock_file(session_path);
    SessionListItem {
        id: summary.id,
        summary: summary.summary,
        repository: summary.repository,
        branch: summary.branch,
        host_type: summary.host_type,
        created_at: summary.created_at.map(|d| d.to_rfc3339()),
        updated_at: summary.updated_at.map(|d| d.to_rfc3339()),
        event_count: summary.event_count,
        turn_count: summary.turn_count,
        current_model: summary
            .shutdown_metrics
            .as_ref()
            .and_then(|metrics| metrics.current_model.clone()),
        is_running,
        error_count: None,
        rate_limit_count: None,
        compaction_count: None,
        truncation_count: None,
    }
}

pub(crate) fn load_summary_list_item(session_path: &Path) -> CmdResult<SessionListItem> {
    let summary = tracepilot_core::summary::load_session_summary(session_path)?;
    Ok(summary_to_list_item(summary, session_path))
}

pub(crate) fn open_index_db(
    index_path: &std::path::Path,
) -> Option<tracepilot_indexer::index_db::IndexDb> {
    if !index_path.exists() {
        return None;
    }
    let db = tracepilot_indexer::index_db::IndexDb::open_readonly(index_path).ok()?;
    if db.session_count().unwrap_or(0) == 0 {
        return None;
    }
    Some(db)
}

pub(crate) fn copilot_home() -> CmdResult<std::path::PathBuf> {
    Ok(tracepilot_orchestrator::launcher::copilot_home()?)
}

pub(crate) fn validate_path_within(path: &str, dir: &std::path::Path) -> CmdResult<()> {
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Err(BindingsError::Validation(format!(
            "Path does not exist: {}",
            path
        )));
    }
    let canonical = p.canonicalize()?;
    let canonical_dir = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    if !canonical.starts_with(&canonical_dir) {
        return Err(BindingsError::Validation(
            "Path is outside the allowed directory".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, RwLock};

    fn make_shared_config(session_state_dir: &str) -> SharedConfig {
        Arc::new(RwLock::new(Some(crate::config::TracePilotConfig {
            paths: crate::config::PathsConfig {
                session_state_dir: session_state_dir.to_string(),
                index_db_path: String::new(),
            },
            ..Default::default()
        })))
    }

    #[tokio::test]
    async fn with_session_path_propagates_missing_session_error() {
        let dir = tempfile::tempdir().unwrap();
        let state = make_shared_config(dir.path().to_str().unwrap());

        let result = with_session_path(&state, "nonexistent-session-id".into(), |_path| {
            Ok("should not reach here".to_string())
        })
        .await;

        assert!(result.is_err(), "missing session should produce an error");
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("nonexistent-session-id"),
            "error should reference the session id: {err_msg}"
        );
    }

    #[tokio::test]
    async fn with_session_path_runs_closure_on_resolved_path() {
        // Session directories must be valid UUIDs (discover_sessions filters by uuid::Uuid::parse_str)
        let dir = tempfile::tempdir().unwrap();
        let session_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let session_dir = dir.path().join(session_id);
        std::fs::create_dir_all(&session_dir).unwrap();

        let state = make_shared_config(dir.path().to_str().unwrap());

        let result = with_session_path(&state, session_id.into(), |path| {
            Ok(path.to_string_lossy().to_string())
        })
        .await;

        assert!(result.is_ok(), "valid session should succeed: {:?}", result.err());
        let resolved = result.unwrap();
        assert!(
            resolved.contains(session_id),
            "resolved path should contain session id: {resolved}"
        );
    }

    #[tokio::test]
    async fn with_session_path_propagates_closure_error() {
        let dir = tempfile::tempdir().unwrap();
        let session_id = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
        let session_dir = dir.path().join(session_id);
        std::fs::create_dir_all(&session_dir).unwrap();

        let state = make_shared_config(dir.path().to_str().unwrap());

        let result: CmdResult<()> = with_session_path(&state, session_id.into(), |_path| {
            Err(BindingsError::Validation("deliberate test error".into()))
        })
        .await;

        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert_eq!(err_msg, "deliberate test error");
    }
}
