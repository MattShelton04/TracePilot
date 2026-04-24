//! Atomic staging + rename primitive used by every skill importer.
//!
//! NOTE(w81 audit): Evaluated for promotion to `tracepilot_core::utils::atomic`
//! and **deliberately left in place**. All four callers (`local`, `github`,
//! `file`, tests) live under `skills/import/`, so the helper is still
//! single-module-scope. Promotion would require either genericising over the
//! error type (awkward given the domain-specific [`SkillsError::DuplicateSkill`]
//! variant) or leaking `SkillsError` into core. Revisit if a second module
//! ever needs an atomic directory install.

use crate::skills::error::SkillsError;
use std::path::{Path, PathBuf};

/// Stage skill files in a temporary directory, then atomically move to the
/// final destination. On failure the staging directory is removed so no
/// partial state is left on disk (best-effort cleanup — a process crash
/// between `create_dir` and the cleanup path may leave a `.tmp-import-*`
/// directory that is harmless and can be removed manually).
///
/// The closure receives the staging directory path and returns an arbitrary
/// value `T` on success (e.g. file count, warnings) which is forwarded to
/// the caller alongside the final installed path.
///
/// # Platform notes
///
/// `std::fs::rename` is atomic for directories on the same filesystem
/// (POSIX `rename(2)`). The staging directory is always created as a sibling
/// of the final destination, guaranteeing same-filesystem operation. On
/// Windows, `MoveFileExW` is used — it is not strictly atomic but is safe
/// for a just-created staging directory that no other process references.
pub(super) fn atomic_dir_install<T, F>(
    dest_parent: &Path,
    skill_name: &str,
    populate: F,
) -> Result<(PathBuf, T), SkillsError>
where
    F: FnOnce(&Path) -> Result<T, SkillsError>,
{
    let final_dir = dest_parent.join(skill_name);
    if final_dir.exists() {
        return Err(SkillsError::DuplicateSkill(skill_name.to_string()));
    }

    // Build a unique staging name using a UUID to prevent collisions
    // across concurrent imports within the same process.
    let staging_name = format!(".tmp-import-{}", uuid::Uuid::new_v4());
    let staging_dir = dest_parent.join(&staging_name);

    std::fs::create_dir_all(dest_parent).map_err(|e| {
        SkillsError::io_ctx(
            format!("Failed to create destination parent for '{skill_name}'"),
            e,
        )
    })?;

    // Use create_dir (not create_dir_all) so a collision is detected as
    // an error rather than silently sharing a directory.
    std::fs::create_dir(&staging_dir).map_err(|e| {
        SkillsError::io_ctx(
            format!("Failed to create staging directory for '{skill_name}'"),
            e,
        )
    })?;

    match populate(&staging_dir) {
        Ok(value) => {
            std::fs::rename(&staging_dir, &final_dir).map_err(|e| {
                // Best-effort cleanup of the staging directory; the primary error propagates.
                let _: std::io::Result<()> = std::fs::remove_dir_all(&staging_dir);
                // If the final directory appeared between our exists() check
                // and the rename (TOCTOU race), report as duplicate.
                if final_dir.exists() {
                    SkillsError::DuplicateSkill(skill_name.to_string())
                } else {
                    SkillsError::io_ctx(format!("Failed to finalize import of '{skill_name}'"), e)
                }
            })?;
            Ok((final_dir, value))
        }
        Err(e) => {
            // Best-effort cleanup of the staging directory on populate failure.
            let _: std::io::Result<()> = std::fs::remove_dir_all(&staging_dir);
            Err(e)
        }
    }
}
