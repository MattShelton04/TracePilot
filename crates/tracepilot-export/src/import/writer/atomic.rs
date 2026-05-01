use std::fs;
use std::path::{Path, PathBuf};

use crate::document::{PortableSession, SessionArchive};
use crate::error::{ExportError, Result};

use super::sections::write_session_files;

/// Write a single session from an archive to a target directory.
///
/// The `target_parent` is the session-state directory (e.g., `~/.copilot/session-state/`).
/// A subdirectory named after the session ID will be created within it.
///
/// Uses atomic staging: writes to `{target_parent}/.import-staging-{id}` first,
/// then renames to `{target_parent}/{id}`.
pub fn write_session(
    session: &PortableSession,
    archive: &SessionArchive,
    target_parent: &Path,
) -> Result<PathBuf> {
    write_session_to_id(session, archive, target_parent, &session.metadata.id)
}

pub(crate) fn write_session_to_id(
    session: &PortableSession,
    archive: &SessionArchive,
    target_parent: &Path,
    target_session_id: &str,
) -> Result<PathBuf> {
    let final_dir = target_parent.join(target_session_id);
    let staging_dir = target_parent.join(format!(".import-staging-{}", target_session_id));

    // Clean up any leftover staging directory from a previous failed import
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir).map_err(|e| ExportError::io(&staging_dir, e))?;
    }

    // Create staging directory
    fs::create_dir_all(&staging_dir).map_err(|e| ExportError::io(&staging_dir, e))?;

    // Write all session files into staging
    let write_result = write_session_files(session, archive, &staging_dir, target_session_id);

    if let Err(err) = write_result {
        // Rollback: best-effort cleanup of staging on write failure.
        if let Err(rm_err) = fs::remove_dir_all(&staging_dir) {
            tracing::warn!(path = %staging_dir.display(), error = %rm_err, "Failed to clean up staging dir after import write failure");
        }
        return Err(err);
    }

    // Atomic rename from staging to final location
    // Uses a backup strategy: rename existing → backup, rename staging → final,
    // then delete backup. On failure, restore backup to recover original data.
    if final_dir.exists() {
        let backup_dir = target_parent.join(format!(".import-backup-{}", target_session_id));
        // Clean up any leftover backup from a previous failed attempt
        if backup_dir.exists() {
            // best-effort: stale leftover cleanup.
            let _: std::io::Result<()> = fs::remove_dir_all(&backup_dir);
        }
        // Step 1: move existing aside to backup
        fs::rename(&final_dir, &backup_dir).map_err(|e| ExportError::io(&final_dir, e))?;
        // Step 2: move staging into place
        match fs::rename(&staging_dir, &final_dir) {
            Ok(()) => {
                // Step 3: clean up backup (best-effort; if it fails, a future import will clean it).
                if let Err(rm_err) = fs::remove_dir_all(&backup_dir) {
                    tracing::debug!(path = %backup_dir.display(), error = %rm_err, "Post-import backup cleanup failed");
                }
            }
            Err(e) => {
                // Rollback: restore backup. If restore fails, original data is in `backup_dir` —
                // log loudly so an operator can recover manually.
                if let Err(rb_err) = fs::rename(&backup_dir, &final_dir) {
                    tracing::error!(
                        final_dir = %final_dir.display(),
                        backup_dir = %backup_dir.display(),
                        rollback_error = %rb_err,
                        "Failed to restore backup after staging rename failure — manual recovery may be required"
                    );
                }
                if let Err(rm_err) = fs::remove_dir_all(&staging_dir) {
                    tracing::debug!(path = %staging_dir.display(), error = %rm_err, "Staging cleanup after rollback failed");
                }
                return Err(ExportError::io(&final_dir, e));
            }
        }
    } else {
        fs::rename(&staging_dir, &final_dir).map_err(|e| {
            // best-effort staging cleanup; primary error still propagates.
            let _: std::io::Result<()> = fs::remove_dir_all(&staging_dir);
            ExportError::io(&final_dir, e)
        })?;
    }

    Ok(final_dir)
}

/// Check if a session ID already exists in the target directory.
pub fn session_exists(session_id: &str, target_parent: &Path) -> bool {
    target_parent.join(session_id).exists()
}
