//! Path-validation and directory-walking helpers for the session file browser.
//!
//! All helpers are sandboxed — they only operate within a canonicalized
//! session directory and reject path-traversal, symlinks, dotfiles, and
//! Windows reserved device names.

use super::types::{MAX_DEPTH, MAX_ENTRIES, SessionFileEntry, SessionFileType};
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
        let component_trimmed = component.trim_end_matches(|c| c == ' ' || c == '.');
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

/// Recursively collect file entries from `dir`, building paths relative to `root`.
///
/// `depth` tracks the current recursion level; the call site passes 0.
pub(super) fn collect_entries(
    root: &Path,
    dir: &Path,
    depth: usize,
    entries: &mut Vec<SessionFileEntry>,
) -> Result<(), BindingsError> {
    if depth > MAX_DEPTH {
        return Ok(()); // silently skip overly-deep trees
    }

    for entry in std::fs::read_dir(dir)?.flatten() {
        if entries.len() >= MAX_ENTRIES {
            break; // cap reached — stop adding entries
        }

        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files (dotfiles, e.g. `.git`).
        if name.starts_with('.') {
            continue;
        }

        // Use DirEntry::file_type() which does NOT follow symlinks, so
        // symlink-to-directory entries are classified as symlinks (not dirs).
        // We skip all symlinks to prevent both directory traversal attacks and
        // symlink-cycle infinite recursion.
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }

        let path = entry.path();
        let relative = match path.strip_prefix(root) {
            Ok(rel) => rel.to_string_lossy().replace('\\', "/"),
            // strip_prefix should never fail since path descends from root,
            // but if it does (e.g. OS path normalisation discrepancy) skip
            // the entry rather than falling back to the absolute path, which
            // would leak the OS username and full filesystem layout.
            Err(_) => continue,
        };

        if ft.is_dir() {
            // TOCTOU mitigation: canonicalize before recursing. Between the
            // file_type() check above and the read_dir() inside the recursive
            // call, an attacker (e.g. an AI agent with write access to its
            // own session dir) could replace the subdirectory with a symlink
            // to an arbitrary location. Canonicalizing here collapses that
            // race window — if the replacement has occurred the canonical
            // path will point outside `root` and we skip the entry.
            let canonical_subdir = match path.canonicalize() {
                Ok(p) => p,
                Err(_) => continue, // disappeared or permission denied — skip
            };
            if !canonical_subdir.starts_with(root) {
                continue; // raced into an outside symlink — skip silently
            }
            entries.push(SessionFileEntry {
                path: relative.clone(),
                name: name.clone(),
                size_bytes: 0,
                is_directory: true,
                file_type: SessionFileType::Binary, // unused for dirs
            });
            collect_entries(root, &canonical_subdir, depth + 1, entries)?;
        } else {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            entries.push(SessionFileEntry {
                file_type: SessionFileType::from_name(&name),
                path: relative,
                name,
                size_bytes: size,
                is_directory: false,
            });
        }
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

    // ── collect_entries ────────────────────────────────────────

    #[test]
    fn collect_entries_basic() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        std::fs::write(session_dir.join("events.jsonl"), "{}\n").unwrap();
        std::fs::write(session_dir.join("workspace.yaml"), "cwd: /\n").unwrap();
        let files_dir = session_dir.join("files");
        std::fs::create_dir_all(&files_dir).unwrap();
        std::fs::write(files_dir.join("plan.md"), "# Plan").unwrap();

        let mut entries = Vec::new();
        collect_entries(&session_dir, &session_dir, 0, &mut entries).unwrap();

        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"events.jsonl"));
        assert!(names.contains(&"workspace.yaml"));
        assert!(names.contains(&"files"));
        assert!(names.contains(&"plan.md"));
    }

    #[test]
    fn collect_entries_skips_hidden_files() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        std::fs::write(session_dir.join(".hidden"), "secret").unwrap();
        std::fs::write(session_dir.join("visible.txt"), "public").unwrap();

        let mut entries = Vec::new();
        collect_entries(&session_dir, &session_dir, 0, &mut entries).unwrap();

        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(!names.contains(&".hidden"));
        assert!(names.contains(&"visible.txt"));
    }

    #[test]
    fn collect_entries_forward_slash_paths() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        let sub = session_dir.join("files");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("notes.md"), "# Notes").unwrap();

        let mut entries = Vec::new();
        collect_entries(&session_dir, &session_dir, 0, &mut entries).unwrap();

        let file_entry = entries.iter().find(|e| e.name == "notes.md").unwrap();
        assert!(!file_entry.path.contains('\\'), "path should use forward slashes");
        assert_eq!(file_entry.path, "files/notes.md");
    }

    #[test]
    fn collect_entries_respects_entry_cap() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        for i in 0..MAX_ENTRIES + 10 {
            std::fs::write(session_dir.join(format!("file_{i}.txt")), "x").unwrap();
        }
        let mut entries = Vec::new();
        collect_entries(&session_dir, &session_dir, 0, &mut entries).unwrap();
        assert!(entries.len() <= MAX_ENTRIES, "entry cap exceeded: {}", entries.len());
    }

    #[test]
    fn collect_entries_skips_beyond_max_depth() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        let mut deep = session_dir.clone();
        for _ in 0..=MAX_DEPTH {
            deep = deep.join("sub");
            std::fs::create_dir_all(&deep).unwrap();
        }
        std::fs::write(deep.join("deep.txt"), "too deep").unwrap();

        let mut entries = Vec::new();
        collect_entries(&session_dir, &session_dir, 0, &mut entries).unwrap();

        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(!names.contains(&"deep.txt"), "file beyond max depth should be skipped");
    }

    /// Regression test for the TOCTOU symlink race in collect_entries.
    ///
    /// On Unix we can create a symlink that points outside the session dir
    /// and verify collect_entries skips it rather than following it.  On
    /// Windows symlinks require elevation, so this test is cfg-gated.
    #[test]
    #[cfg(unix)]
    fn collect_entries_skips_symlink_dir_outside_root() {
        use std::os::unix::fs::symlink;

        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);

        let outside_dir = tmp.path().join("outside");
        std::fs::create_dir_all(&outside_dir).unwrap();
        std::fs::write(outside_dir.join("secret.txt"), "secret").unwrap();

        let symlink_path = session_dir.join("evil_link");
        symlink(&outside_dir, &symlink_path).unwrap();

        let mut entries = Vec::new();
        collect_entries(&session_dir, &session_dir, 0, &mut entries).unwrap();

        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(!names.contains(&"evil_link"), "symlink dir should be skipped: {names:?}");
        assert!(!names.contains(&"secret.txt"), "file from outside root leaked: {names:?}");
    }
}
