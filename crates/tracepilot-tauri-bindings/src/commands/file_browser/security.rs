//! Path-validation and directory-walking helpers for the session file browser.
//!
//! All helpers are sandboxed — they only operate within a canonicalized
//! session directory and reject path-traversal, symlinks, dotfiles, and
//! Windows reserved device names. Listing lives in `walk`.

use crate::error::BindingsError;
use std::path::Path;

/// Validate a relative file path: no `..`, not absolute, normalised separators.
///
/// Also rejects Windows device names (CON, NUL, COM1-9, LPT1-9, AUX, PRN) in
/// any path component because the Windows kernel intercepts these regardless of
/// directory context, which can cause hangs or unexpected I/O redirection.
///
/// Rejects drive-relative Windows paths like `C:relative` which do not start
/// with `/` or `\` and therefore bypass the standard absolute-path checks, but
/// which cause `session_dir.join("C:relative")` to silently redirect to a
/// different volume on Windows.
pub(super) fn validate_relative_path(relative_path: &str) -> Result<(), BindingsError> {
    if relative_path.is_empty() {
        return Err(BindingsError::Validation(
            "File path cannot be empty".into(),
        ));
    }
    // Reject absolute paths
    if relative_path.starts_with('/') || relative_path.starts_with('\\') {
        return Err(BindingsError::Validation(
            "File path cannot be absolute".into(),
        ));
    }
    if Path::new(relative_path).is_absolute() {
        return Err(BindingsError::Validation(
            "File path cannot be absolute".into(),
        ));
    }
    // Reject drive-relative paths like `C:relative` — these don't start with
    // `/` or `\` and Path::is_absolute() returns false, yet session_dir.join()
    // on Windows silently redirects to that drive's current directory.
    if relative_path.contains(':') {
        return Err(BindingsError::Validation(
            "File path cannot contain a colon (drive specifier)".into(),
        ));
    }
    // Reject traversal sequences and Windows reserved device names.
    for component in relative_path.replace('\\', "/").split('/') {
        if component == ".." {
            return Err(BindingsError::Validation(
                "File path cannot contain '..' (path traversal)".into(),
            ));
        }
        // Windows strips trailing spaces and periods from path components at
        // the kernel level, so `CON ` and `NUL.` are treated identically to
        // `CON` and `NUL`. Trim both before the device-name check.
        let component_trimmed = component.trim_end_matches([' ', '.']);
        // Strip any extension before checking: NUL.txt and CON.md are also reserved.
        let stem = component_trimmed
            .split('.')
            .next()
            .unwrap_or(component_trimmed)
            .to_uppercase();
        // COM1-COM9, COM10+, LPT1-LPT9, LPT10+ are all reserved on Windows.
        // COM0 and LPT0 are NOT reserved — excluded by `!= "0"` check.
        let digit_suffix_is_nonzero = |prefix: &str| -> bool {
            let suffix = &stem[prefix.len()..];
            !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) && suffix != "0"
        };
        let is_device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.starts_with("COM") && stem.len() >= 4 && digit_suffix_is_nonzero("COM"))
            || (stem.starts_with("LPT") && stem.len() >= 4 && digit_suffix_is_nonzero("LPT"));
        if is_device {
            return Err(BindingsError::Validation(
                "File path contains a reserved Windows device name".into(),
            ));
        }
    }
    Ok(())
}

/// Resolve `relative_path` inside `session_dir` and verify the canonical path
/// stays within the directory (defends against symlink attacks).
pub(super) fn safe_session_file_path(
    session_dir: &Path,
    relative_path: &str,
) -> Result<std::path::PathBuf, BindingsError> {
    validate_relative_path(relative_path)?;

    let joined = session_dir.join(relative_path);

    // Canonicalize the session directory to an absolute form so we can compare.
    let canonical_dir = session_dir.canonicalize()?;

    // For the file path: if it exists, canonicalize it; if not, check the parent.
    if joined.exists() {
        let canonical_file = joined.canonicalize()?;
        if !canonical_file.starts_with(&canonical_dir) {
            return Err(BindingsError::Validation(
                "File path escapes session directory".into(),
            ));
        }
        Ok(canonical_file)
    } else {
        // File doesn't exist — verify the parent's canonical form is within
        // the session directory. Return `joined` un-canonicalized; the caller
        // must check `file_path.exists()` before opening it (which they do).
        //
        // NOTE: we do NOT apply a final `joined.starts_with(canonical_dir)`
        // check here because `joined` is non-canonical (built from potentially
        // symlinked session_state_dir), so comparing it against canonical_dir
        // would produce false "escapes" rejections on symlinked config paths.
        // The canonical-parent check below is the authoritative guard.
        let parent = joined.parent().unwrap_or(&joined);
        let canonical_parent = if parent.exists() {
            parent.canonicalize()?
        } else {
            canonical_dir.clone()
        };
        if !canonical_parent.starts_with(&canonical_dir) {
            return Err(BindingsError::Validation(
                "File path escapes session directory".into(),
            ));
        }
        Ok(joined)
    }
}

/// Re-canonicalize `file_path` and `session_dir` after a `path.exists()` check
/// to close the TOCTOU window left open by [`safe_session_file_path`] when the
/// target file did not yet exist at validation time.
///
/// Between `safe_session_file_path` (which skips canonicalisation for
/// non-existent files) and the caller's first read, an attacker — or a buggy
/// agent with write access to its own session dir — could have replaced the
/// path with a symlink pointing outside the session directory. Re-canonicalising
/// here forces the symlink target to be resolved and verified.
///
/// Returns the canonicalised file path on success.
pub(super) fn revalidate_within_session_dir(
    session_dir: &Path,
    file_path: &Path,
) -> Result<std::path::PathBuf, BindingsError> {
    let canonical_dir = session_dir.canonicalize()?;
    let canonical_file = file_path.canonicalize()?;
    if !canonical_file.starts_with(&canonical_dir) {
        return Err(BindingsError::Validation(
            "File path escapes session directory".into(),
        ));
    }
    Ok(canonical_file)
}

/// Reject hidden filenames (anything starting with `.`).
///
/// We do not surface dotfiles through the file browser — the relative-path
/// validator already drops them when listing, and the read endpoints refuse
/// them by name in case a renderer constructs the path directly.
pub(super) fn reject_hidden_filename(file_path: &Path) -> Result<(), BindingsError> {
    let file_name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if file_name.starts_with('.') {
        return Err(BindingsError::Validation(
            "Hidden files cannot be read".into(),
        ));
    }
    Ok(())
}

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_session_dir(tmp: &TempDir) -> std::path::PathBuf {
        let dir = tmp.path().join("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
        std::fs::create_dir_all(&dir).unwrap();
        // Return the canonicalized path — collect_entries requires a canonical
        // root so subdirectory prefix checks work correctly on all platforms.
        dir.canonicalize().unwrap()
    }

    // ── validate_relative_path ─────────────────────────────────

    #[test]
    fn relative_path_rejects_empty() {
        assert!(validate_relative_path("").is_err());
    }

    #[test]
    fn relative_path_rejects_traversal() {
        assert!(validate_relative_path("../escape.txt").is_err());
        assert!(validate_relative_path("files/../../../etc/passwd").is_err());
    }

    #[test]
    fn relative_path_rejects_absolute() {
        assert!(validate_relative_path("/etc/passwd").is_err());
        assert!(validate_relative_path("\\Windows\\system32").is_err());
    }

    #[test]
    fn relative_path_rejects_windows_device_names() {
        assert!(validate_relative_path("NUL").is_err());
        assert!(validate_relative_path("CON").is_err());
        assert!(validate_relative_path("PRN").is_err());
        assert!(validate_relative_path("AUX").is_err());
        assert!(validate_relative_path("COM1").is_err());
        assert!(validate_relative_path("COM9").is_err());
        assert!(validate_relative_path("COM10").is_err());
        assert!(validate_relative_path("LPT1").is_err());
        assert!(validate_relative_path("LPT10").is_err());
        // Extensions don't make them safe — NUL.txt is still NUL on Windows.
        assert!(validate_relative_path("NUL.txt").is_err());
        assert!(validate_relative_path("files/COM3.log").is_err());
        // Trailing spaces and periods are stripped by Windows kernel.
        assert!(validate_relative_path("CON ").is_err());
        assert!(validate_relative_path("NUL.").is_err());
        assert!(validate_relative_path("COM1 ").is_err());
        // COM0 and LPT0 are NOT reserved — must not over-block.
        assert!(validate_relative_path("COM0.txt").is_ok());
        assert!(validate_relative_path("LPT0.txt").is_ok());
        // Normal names must still pass.
        assert!(validate_relative_path("events.jsonl").is_ok());
        assert!(validate_relative_path("files/plan.md").is_ok());
    }

    #[test]
    fn relative_path_rejects_drive_relative_paths() {
        assert!(validate_relative_path("C:relative").is_err());
        assert!(validate_relative_path("D:secret.txt").is_err());
        assert!(validate_relative_path("files/C:escape").is_err());
    }

    #[test]
    fn relative_path_allows_nested() {
        assert!(validate_relative_path("files/plan.md").is_ok());
        assert!(validate_relative_path("files/subdir/notes.txt").is_ok());
        assert!(validate_relative_path("events.jsonl").is_ok());
    }

    // ── safe_session_file_path ─────────────────────────────────

    #[test]
    fn safe_path_allows_valid_file() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        std::fs::write(session_dir.join("events.jsonl"), "{}").unwrap();

        let result = safe_session_file_path(&session_dir, "events.jsonl");
        assert!(result.is_ok());
    }

    #[test]
    fn safe_path_rejects_traversal() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);

        assert!(safe_session_file_path(&session_dir, "../other.txt").is_err());
        assert!(safe_session_file_path(&session_dir, "files/../../secret").is_err());
    }

    #[test]
    fn safe_path_rejects_sqlite_traversal() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        assert!(safe_session_file_path(&session_dir, "../other.db").is_err());
    }

    // `revalidate_within_session_dir` and `reject_hidden_filename` tests
    // live in `security_revalidate_tests.rs` to keep this file under the
    // `scripts/check-file-sizes.mjs` budget.
}
