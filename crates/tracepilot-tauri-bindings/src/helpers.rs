//! Shared helper functions used by multiple command modules.

use crate::config::{SharedConfig, TracePilotConfig};
use crate::error::{BindingsError, CmdResult};
use crate::types::{IndexingProgressPayload, SessionListItem};
use std::path::Path;
use tauri::Emitter;

pub(crate) const MAX_CHECKPOINT_CONTENT_BYTES: usize = 50 * 1024;

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

pub(crate) fn truncate_utf8(s: &mut String, max_bytes: usize) {
    let truncated_len = tracepilot_core::utils::truncate_utf8(s.as_str(), max_bytes).len();
    s.truncate(truncated_len);
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

/// Delete the index database and its WAL/SHM sidecar files, surfacing I/O errors.
/// Missing files are silently ignored to avoid TOCTOU races (WAL/SHM are managed
/// dynamically by SQLite and may vanish between checks).
pub(crate) fn remove_index_db_files(index_path: &Path) -> Result<(), BindingsError> {
    let wal = index_path.with_extension("db-wal");
    let shm = index_path.with_extension("db-shm");

    for path in [index_path.to_path_buf(), wal, shm] {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                let err: BindingsError = e.into();
                tracing::warn!(path = %path.display(), error = %err, "Failed to remove index database file");
                return Err(err);
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn remove_index_files_deletes_existing_artifacts() {
        let dir = tempdir().unwrap();
        let index_path = dir.path().join("index.db");
        let wal = index_path.with_extension("db-wal");
        let shm = index_path.with_extension("db-shm");

        fs::write(&index_path, b"db").unwrap();
        fs::write(&wal, b"wal").unwrap();
        fs::write(&shm, b"shm").unwrap();

        remove_index_db_files(&index_path).unwrap();

        assert!(!index_path.exists());
        assert!(!wal.exists());
        assert!(!shm.exists());
    }

    #[test]
    fn remove_index_files_propagates_io_errors() {
        let dir = tempdir().unwrap();
        let index_path = dir.path().join("index.db");

        // Directory in place of the DB file triggers an I/O error on removal.
        fs::create_dir(&index_path).unwrap();

        let err = remove_index_db_files(&index_path).unwrap_err();
        assert!(matches!(err, BindingsError::Io(_)));
        assert!(index_path.exists());
    }

    #[test]
    fn remove_index_files_succeeds_when_no_files_exist() {
        let dir = tempdir().unwrap();
        let index_path = dir.path().join("index.db");

        // None of the files exist — should succeed without error.
        remove_index_db_files(&index_path).unwrap();
    }
}
