//! Session/index database access helpers.

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use std::path::{Path, PathBuf};
use tracepilot_core::ids::SessionId;
use tracing::warn;

use super::{OpenIndexDb, cache::read_config};

/// Resolve a session directory path and run a blocking closure with it.
///
/// Encapsulates the standard pattern used by most single-session commands:
/// 1. Accept a pre-validated [`SessionId`] (callers obtain this via
///    `crate::validators::validate_session_id`)
/// 2. Read `session_state_dir` from shared config
/// 3. Spawn a blocking task to resolve the session path on disk
/// 4. Execute command-specific logic with the resolved `PathBuf`
///
/// Unlike earlier revisions, this helper no longer re-validates the
/// session id internally — the [`SessionId`] newtype carries that
/// invariant in its type. This eliminates repeated boilerplate across
/// session, export, and state commands.  For the analytics equivalent,
/// see
/// [`analytics_executor::execute_analytics_query`](crate::commands::analytics_executor::execute_analytics_query).
pub(crate) async fn with_session_path<T, F>(
    state: &SharedConfig,
    session_id: SessionId,
    f: F,
) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(PathBuf) -> Result<T, BindingsError> + Send + 'static,
{
    let session_state_dir = read_config(state).session_state_dir();

    tokio::task::spawn_blocking(move || {
        let path = tracepilot_core::session::discovery::resolve_session_path_direct(
            session_id.as_str(),
            &session_state_dir,
        )?;
        f(path)
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
