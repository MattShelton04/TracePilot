//! Session/index/task database access helpers.

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use std::path::{Path, PathBuf};
use tracing::warn;

use super::{OpenIndexDb, cache::read_config, mutex_poisoned};

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
/// [`analytics_executor::execute_analytics_query`](crate::commands::analytics_executor::execute_analytics_query).
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

/// Get or initialize the shared TaskDb.
///
/// Lazily opens the database on first call using the default path
/// (`~/.copilot/tracepilot/tasks.db`). Returns a clone of the Arc
/// for use inside `spawn_blocking`.
pub(crate) fn get_or_init_task_db(
    state: &crate::types::SharedTaskDb,
) -> Result<crate::types::SharedTaskDb, BindingsError> {
    let mut guard = state
        .lock()
        .map_err(|_| BindingsError::Internal("TaskDb mutex poisoned".into()))?;
    if guard.is_none() {
        let path = tracepilot_orchestrator::task_db::TaskDb::default_path()
            .map_err(|e| BindingsError::Validation(format!("Cannot resolve task DB path: {e}")))?;
        let db = tracepilot_orchestrator::task_db::TaskDb::open_or_create(&path)
            .map_err(|e| BindingsError::Validation(format!("Failed to open task DB: {e}")))?;
        db.startup_maintenance()
            .map_err(|e| BindingsError::Validation(format!("Task DB maintenance failed: {e}")))?;
        tracing::info!(path = %path.display(), "Task DB initialized");
        *guard = Some(db);
    }
    drop(guard);
    Ok(state.clone())
}

/// Initialise the task DB (if needed), acquire the mutex, and run a
/// blocking closure with the underlying `TaskDb`.
///
/// This encapsulates the `get_or_init_task_db → spawn_blocking → lock →
/// unwrap Option` boilerplate shared by most task CRUD commands.
pub(crate) async fn with_task_db<T, F>(state: &crate::types::SharedTaskDb, f: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&tracepilot_orchestrator::task_db::TaskDb) -> Result<T, BindingsError>
        + Send
        + 'static,
{
    let db = get_or_init_task_db(state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| mutex_poisoned())?;
        let db = guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        f(db)
    })
    .await?
}

pub(crate) fn open_index_db(index_path: &std::path::Path) -> Option<OpenIndexDb> {
    if !index_path.exists() {
        return None;
    }

    let db = match tracepilot_indexer::index_db::IndexDb::open_readonly(index_path) {
        Ok(db) => db,
        Err(e) => {
            warn!(
                path = %index_path.display(),
                error = %e,
                "Failed to open index database; falling back to session scan"
            );
            return None;
        }
    };

    let session_count = match db.session_count() {
        Ok(count) => count,
        Err(e) => {
            warn!(
                path = %index_path.display(),
                error = %e,
                "Failed to read session count from index database; falling back to session scan"
            );
            return None;
        }
    };

    if session_count == 0 {
        return None;
    }

    Some(OpenIndexDb { db, session_count })
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
