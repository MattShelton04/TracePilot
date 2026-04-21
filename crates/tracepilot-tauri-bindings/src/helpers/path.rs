//! Filesystem path validation & copilot-home resolution.

use crate::error::{BindingsError, CmdResult};
use std::path::PathBuf;

pub(crate) fn copilot_home() -> CmdResult<std::path::PathBuf> {
    Ok(tracepilot_orchestrator::launcher::copilot_home()?)
}

/// Strip the `\\?\` extended-length path prefix that `std::fs::canonicalize`
/// adds on Windows for drive-rooted paths (e.g. `\\?\C:\...` → `C:\...`).
///
/// UNC share paths (`\\?\UNC\server\share`) are left untouched because
/// stripping their prefix would produce an invalid path.
fn normalize_canonicalized(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            // Drive-rooted: second byte is ':' (e.g. "C:\...").
            if rest.len() >= 2 && rest.as_bytes()[1] == b':' {
                return PathBuf::from(rest.to_string());
            }
        }
    }
    p
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
    let canonical = normalize_canonicalized(p.canonicalize()?);
    let canonical_dir = normalize_canonicalized(
        dir.canonicalize()
            .map_err(|e| BindingsError::Validation(format!("Cannot resolve allowed directory: {e}")))?,
    );
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
pub(crate) fn validate_write_path_within(path: &str, dir: &std::path::Path) -> CmdResult<PathBuf> {
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
    let canonical_dir = normalize_canonicalized(
        dir.canonicalize()
            .map_err(|e| BindingsError::Validation(format!("Cannot resolve allowed directory: {e}")))?,
    );

    // If the target already exists (overwrite or symlink), canonicalize the full
    // path to ensure symlinks don't escape the allowed directory.
    if p.exists() {
        let canonical_full = normalize_canonicalized(p.canonicalize()?);
        if !canonical_full.starts_with(&canonical_dir) {
            return Err(BindingsError::Validation(
                "Path is outside the allowed directory".into(),
            ));
        }
        return Ok(canonical_full);
    }

    // File doesn't exist yet — validate parent only.
    let canonical_parent = normalize_canonicalized(parent.canonicalize()?);
    if !canonical_parent.starts_with(&canonical_dir) {
        return Err(BindingsError::Validation(
            "Path is outside the allowed directory".into(),
        ));
    }
    Ok(canonical_parent.join(file_name))
}
