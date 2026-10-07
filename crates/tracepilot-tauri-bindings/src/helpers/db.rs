//! Index database access helpers.

use crate::error::BindingsError;
use std::path::Path;
use tracing::warn;

use super::OpenIndexDb;

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
        if let Err(e) = remove_file_with_retry(&path) {
            let err: BindingsError = e.into();
            tracing::warn!(path = %path.display(), error = %err, "Failed to remove index database file");
            return Err(err);
        }
    }

    Ok(())
}

/// Remove a file, tolerating absence and retrying briefly while another
/// handle has it open. On Windows a short-lived read-only connection (e.g. a
/// Settings or analytics query) makes deletion fail with a sharing violation
/// until it closes; readers hold connections for milliseconds.
fn remove_file_with_retry(path: &Path) -> std::io::Result<()> {
    const ATTEMPTS: u32 = 20;
    const DELAY: std::time::Duration = std::time::Duration::from_millis(100);
    let mut attempt = 0;
    loop {
        match std::fs::remove_file(path) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) if attempt + 1 < ATTEMPTS && is_transient_lock_error(&e) => {
                attempt += 1;
                std::thread::sleep(DELAY);
            }
            Err(e) => return Err(e),
        }
    }
}

fn is_transient_lock_error(e: &std::io::Error) -> bool {
    // ERROR_SHARING_VIOLATION (32) / ERROR_LOCK_VIOLATION (33) on Windows.
    matches!(e.raw_os_error(), Some(32 | 33)) || e.kind() == std::io::ErrorKind::PermissionDenied
}
