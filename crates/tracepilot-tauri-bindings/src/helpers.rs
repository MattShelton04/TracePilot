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
/// 1. Validate that `session_id` is a well-formed UUID
/// 2. Read `session_state_dir` from shared config
/// 3. Spawn a blocking task to resolve the session path on disk
/// 4. Execute command-specific logic with the resolved `PathBuf`
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
    crate::validators::validate_session_id(&session_id)?;

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

/// Validate that an existing path resides within `dir`.
///
/// Returns the canonicalized path on success so callers can use the resolved
/// path for subsequent operations, reducing TOCTOU risk.
pub(crate) fn validate_path_within(path: &str, dir: &std::path::Path) -> CmdResult<PathBuf> {
    if path.is_empty() {
        return Err(BindingsError::Validation("Path must not be empty".into()));
    }
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Err(BindingsError::Validation(format!(
            "Path does not exist: {}",
            path
        )));
    }
    let canonical = p.canonicalize()?;
    let canonical_dir = dir.canonicalize().map_err(|e| {
        BindingsError::Validation(format!("Cannot resolve allowed directory: {e}"))
    })?;
    if !canonical.starts_with(&canonical_dir) {
        return Err(BindingsError::Validation(
            "Path is outside the allowed directory".into(),
        ));
    }
    Ok(canonical)
}

/// Validate a write-target path whose file may not yet exist.
///
/// Checks that the parent directory exists and is within `dir`. If the target
/// file already exists (e.g. overwrite or symlink), the full canonical path is
/// verified to prevent symlink escapes. Returns the resolved path so callers
/// can use it directly, reducing TOCTOU risk.
pub(crate) fn validate_write_path_within(
    path: &str,
    dir: &std::path::Path,
) -> CmdResult<PathBuf> {
    if path.is_empty() {
        return Err(BindingsError::Validation("Path must not be empty".into()));
    }
    let p = std::path::Path::new(path);
    let file_name = p
        .file_name()
        .filter(|n| !n.is_empty())
        .ok_or_else(|| BindingsError::Validation("Path has no filename".into()))?;
    let parent = p
        .parent()
        .filter(|par| !par.as_os_str().is_empty())
        .ok_or_else(|| BindingsError::Validation("Path has no parent directory".into()))?;
    if !parent.is_dir() {
        return Err(BindingsError::Validation(format!(
            "Parent directory does not exist: {}",
            parent.display()
        )));
    }
    let canonical_dir = dir.canonicalize().map_err(|e| {
        BindingsError::Validation(format!("Cannot resolve allowed directory: {e}"))
    })?;

    // If the target already exists (overwrite or symlink), canonicalize the full
    // path to ensure symlinks don't escape the allowed directory.
    if p.exists() {
        let canonical_full = p.canonicalize()?;
        if !canonical_full.starts_with(&canonical_dir) {
            return Err(BindingsError::Validation(
                "Path is outside the allowed directory".into(),
            ));
        }
        return Ok(canonical_full);
    }

    // File doesn't exist yet — validate parent only.
    let canonical_parent = parent.canonicalize()?;
    if !canonical_parent.starts_with(&canonical_dir) {
        return Err(BindingsError::Validation(
            "Path is outside the allowed directory".into(),
        ));
    }
    Ok(canonical_parent.join(file_name))
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
    use std::sync::{Arc, RwLock};
    use tempfile::tempdir;

    fn make_shared_config(session_state_dir: &str) -> SharedConfig {
        Arc::new(RwLock::new(Some(crate::config::TracePilotConfig {
            paths: crate::config::PathsConfig {
                session_state_dir: session_state_dir.to_string(),
                index_db_path: String::new(),
            },
            ..Default::default()
        })))
    }

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

    #[tokio::test]
    async fn with_session_path_rejects_invalid_session_id() {
        let dir = tempfile::tempdir().unwrap();
        let state = make_shared_config(dir.path().to_str().unwrap());

        let result = with_session_path(&state, "nonexistent-session-id".into(), |_path| {
            Ok("should not reach here".to_string())
        })
        .await;

        assert!(result.is_err(), "invalid UUID should produce an error");
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Invalid session ID format"),
            "error should be a validation error: {err_msg}"
        );
    }

    #[tokio::test]
    async fn with_session_path_propagates_missing_session_error() {
        let dir = tempfile::tempdir().unwrap();
        let state = make_shared_config(dir.path().to_str().unwrap());

        // Valid UUID that doesn't exist on disk
        let result = with_session_path(&state, "00000000-0000-0000-0000-000000000000".into(), |_path| {
            Ok("should not reach here".to_string())
        })
        .await;

        assert!(result.is_err(), "missing session should produce an error");
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("00000000-0000-0000-0000-000000000000"),
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

    // ── validate_path_within tests ──────────────────────────────────────

    #[test]
    fn validate_path_within_accepts_file_inside_dir() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("test.txt");
        fs::write(&file, b"data").unwrap();

        let result = validate_path_within(file.to_str().unwrap(), dir.path());
        assert!(result.is_ok());
        // Returned path should be canonical and end with the filename.
        let canonical = result.unwrap();
        assert!(canonical.ends_with("test.txt"));
    }

    #[test]
    fn validate_path_within_accepts_file_in_subdirectory() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let file = sub.join("nested.txt");
        fs::write(&file, b"data").unwrap();

        let result = validate_path_within(file.to_str().unwrap(), dir.path());
        assert!(result.is_ok());
    }

    #[test]
    fn validate_path_within_rejects_empty_path() {
        let dir = tempdir().unwrap();
        let result = validate_path_within("", dir.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("must not be empty"));
    }

    #[test]
    fn validate_path_within_rejects_nonexistent_path() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("nope.txt");

        let result = validate_path_within(missing.to_str().unwrap(), dir.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("does not exist"));
    }

    #[test]
    fn validate_path_within_rejects_path_outside_dir() {
        let allowed = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let file = outside.path().join("escape.txt");
        fs::write(&file, b"data").unwrap();

        let result = validate_path_within(file.to_str().unwrap(), allowed.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("outside"));
    }

    #[test]
    fn validate_path_within_rejects_traversal_via_dotdot() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        // File is actually in the parent (dir), referred to via sub/../file.txt
        let file = dir.path().join("file.txt");
        fs::write(&file, b"data").unwrap();
        let traversal = sub.join("..").join("file.txt");

        // validate_path_within should canonicalize and see the file is NOT inside sub
        let result = validate_path_within(traversal.to_str().unwrap(), &sub);
        assert!(result.is_err());
    }

    #[test]
    fn validate_path_within_errors_when_allowed_dir_missing() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("test.txt");
        fs::write(&file, b"data").unwrap();

        let missing_dir = dir.path().join("does_not_exist");
        let result = validate_path_within(file.to_str().unwrap(), &missing_dir);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Cannot resolve"));
    }

    // ── validate_write_path_within tests ────────────────────────────────

    #[test]
    fn validate_write_path_within_accepts_new_file_in_dir() {
        let dir = tempdir().unwrap();
        let new_file = dir.path().join("new.txt");
        // File does NOT exist yet — only the parent directory matters.

        let result = validate_write_path_within(new_file.to_str().unwrap(), dir.path());
        assert!(result.is_ok());
        let resolved = result.unwrap();
        assert!(resolved.ends_with("new.txt"));
    }

    #[test]
    fn validate_write_path_within_accepts_new_file_in_subdirectory() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let new_file = sub.join("new.txt");

        let result = validate_write_path_within(new_file.to_str().unwrap(), dir.path());
        assert!(result.is_ok());
    }

    #[test]
    fn validate_write_path_within_rejects_empty_path() {
        let dir = tempdir().unwrap();
        let result = validate_write_path_within("", dir.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("must not be empty"));
    }

    #[test]
    fn validate_write_path_within_rejects_path_outside_dir() {
        let allowed = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let new_file = outside.path().join("escape.txt");

        let result = validate_write_path_within(new_file.to_str().unwrap(), allowed.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("outside"));
    }

    #[test]
    fn validate_write_path_within_rejects_missing_parent() {
        let dir = tempdir().unwrap();
        let deep = dir.path().join("no_such_dir").join("file.txt");

        let result = validate_write_path_within(deep.to_str().unwrap(), dir.path());
        assert!(result.is_err());
        assert!(
            result.unwrap_err().to_string().contains("Parent directory does not exist"),
        );
    }

    #[test]
    fn validate_write_path_within_rejects_bare_filename() {
        let dir = tempdir().unwrap();
        let result = validate_write_path_within("just_a_name.txt", dir.path());
        assert!(result.is_err());
    }

    #[test]
    fn validate_write_path_within_rejects_traversal_via_dotdot() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        // Try to escape sub via ../new.txt — parent would resolve to dir, outside sub
        let traversal = sub.join("..").join("new.txt");

        let result = validate_write_path_within(traversal.to_str().unwrap(), &sub);
        assert!(result.is_err());
    }

    #[test]
    fn validate_write_path_within_errors_when_allowed_dir_missing() {
        let dir = tempdir().unwrap();
        let new_file = dir.path().join("test.txt");

        let missing_dir = dir.path().join("does_not_exist");
        let result = validate_write_path_within(new_file.to_str().unwrap(), &missing_dir);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Cannot resolve"));
    }

    #[cfg(unix)]
    #[test]
    fn validate_path_within_rejects_symlink_escaping_dir() {
        let allowed = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let target = outside.path().join("secret.txt");
        fs::write(&target, b"secret").unwrap();
        let link = allowed.path().join("link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let result = validate_path_within(link.to_str().unwrap(), allowed.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("outside"));
    }

    #[cfg(unix)]
    #[test]
    fn validate_write_path_within_rejects_existing_symlink_escaping_dir() {
        let allowed = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let target = outside.path().join("escape.txt");
        fs::write(&target, b"data").unwrap();
        // Create a symlink inside allowed that points outside
        let link = allowed.path().join("link.txt");
        std::os::unix::fs::symlink(&target, &link).unwrap();

        let result = validate_write_path_within(link.to_str().unwrap(), allowed.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("outside"));
    }

    #[test]
    fn validate_write_path_within_rejects_parent_is_file() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("not_a_dir");
        fs::write(&file, b"data").unwrap();
        // Try to use a file as the parent directory
        let bad_path = file.join("child.txt");

        let result = validate_write_path_within(bad_path.to_str().unwrap(), dir.path());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Parent directory does not exist"));
    }

    #[test]
    fn validate_write_path_within_accepts_overwrite_within_dir() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("existing.txt");
        fs::write(&file, b"data").unwrap();

        let result = validate_write_path_within(file.to_str().unwrap(), dir.path());
        assert!(result.is_ok());
    }
}
