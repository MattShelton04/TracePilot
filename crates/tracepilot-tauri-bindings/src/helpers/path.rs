//! Filesystem path validation.

use crate::error::{BindingsError, CmdResult};
use std::path::PathBuf;

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
    let canonical_dir = normalize_canonicalized(dir.canonicalize().map_err(|e| {
        BindingsError::Validation(format!("Cannot resolve allowed directory: {e}"))
    })?);
    if !canonical.starts_with(&canonical_dir) {
        return Err(BindingsError::Validation(
            "Path is outside the allowed directory".into(),
        ));
    }
    Ok(canonical)
}

/// Validate that an existing path resides within **any** of the supplied
/// allowed root directories.
///
/// Used by callers that accept a path which may legitimately live under one of
/// several trusted roots (e.g. the system "open in explorer" command, where the
/// path may be a session folder, a registered repo, or an app-managed
/// directory).
///
/// Roots that fail to canonicalize (e.g. they don't exist on disk) are silently
/// skipped — the caller is responsible for ensuring at least one root resolves.
/// Returns the canonicalized input path on success.
///
/// Rejects empty paths, non-existent paths, and paths whose canonical form is
/// not contained by any allowed root (covers `..` traversal and symlink
/// escapes).
pub(crate) fn validate_path_within_any(
    path: &str,
    allowed_roots: &[std::path::PathBuf],
) -> CmdResult<PathBuf> {
    if path.is_empty() {
        return Err(BindingsError::Validation("Path must not be empty".into()));
    }
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Err(BindingsError::Validation(format!(
            "Path does not exist: {path}"
        )));
    }
    let canonical = normalize_canonicalized(p.canonicalize()?);

    let mut any_root_resolved = false;
    for root in allowed_roots {
        let Ok(canonical_root) = root.canonicalize() else {
            continue;
        };
        any_root_resolved = true;
        let canonical_root = normalize_canonicalized(canonical_root);
        if canonical.starts_with(&canonical_root) {
            return Ok(canonical);
        }
    }

    if !any_root_resolved {
        return Err(BindingsError::Validation(
            "No allowed directories are accessible".into(),
        ));
    }

    Err(BindingsError::Validation(
        "Path is outside the allowed directories".into(),
    ))
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
    let canonical_dir = normalize_canonicalized(dir.canonicalize().map_err(|e| {
        BindingsError::Validation(format!("Cannot resolve allowed directory: {e}"))
    })?);

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
