//! Session file browser Tauri commands.
//!
//! Provides read-only, sandboxed access to files within a session's
//! directory. All paths are validated and canonicalized to prevent
//! traversal attacks.

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Maximum size of a text file that will be returned verbatim (1 MiB).
///
/// Files larger than this are truncated with a trailing notice so the
/// frontend never receives multi-megabyte payloads over the IPC bridge.
const MAX_READ_BYTES: u64 = 1_024 * 1_024;

/// Classified file type used by the frontend to choose a renderer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionFileType {
    Markdown,
    Jsonl,
    Json,
    Yaml,
    Toml,
    Sqlite,
    Text,
    Binary,
}

impl SessionFileType {
    fn from_name(name: &str) -> Self {
        let lower = name.to_lowercase();
        let ext = lower.rsplit('.').next().unwrap_or("");
        match ext {
            "md" | "markdown" => Self::Markdown,
            "jsonl" => Self::Jsonl,
            "json" => Self::Json,
            "yaml" | "yml" => Self::Yaml,
            "toml" => Self::Toml,
            "db" | "sqlite" | "sqlite3" => Self::Sqlite,
            "txt" | "log" | "csv" | "lock" | "sh" | "ps1" | "ts" | "js" | "rs" | "py"
            | "rb" | "go" | "java" | "cpp" | "c" | "h" | "css" | "html" | "xml" | "env" => {
                Self::Text
            }
            _ => {
                // Unknown extension — prefer Text unless the extension is a
                // known binary format. This keeps common agent-produced files
                // (.cfg, .ini, .conf, .diff, .patch, .bak) readable by default.
                //
                // Files without any dot (Dockerfile, Makefile, Gemfile, etc.)
                // are always text.
                let known_binary = matches!(
                    ext,
                    "zip" | "gz" | "tar" | "bz2" | "xz" | "7z" | "rar"
                        | "exe" | "dll" | "so" | "dylib" | "bin"
                        | "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "tiff"
                        | "mp3" | "mp4" | "wav" | "ogg" | "flac" | "mkv" | "avi"
                        | "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx"
                        | "wasm" | "class" | "pyc" | "o" | "a" | "lib"
                );
                if known_binary {
                    Self::Binary
                } else {
                    Self::Text
                }
            }
        }
    }
}

/// A single entry (file or directory) in the session file tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFileEntry {
    /// Relative path from the session directory root (forward-slash separated).
    pub path: String,
    /// Filename or directory name.
    pub name: String,
    /// File size in bytes (0 for directories).
    pub size_bytes: u64,
    /// Whether this entry is a directory.
    pub is_directory: bool,
    /// Classified type for frontend rendering decisions.
    pub file_type: SessionFileType,
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
fn validate_relative_path(relative_path: &str) -> Result<(), BindingsError> {
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
fn safe_session_file_path(
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

/// Maximum number of file entries returned by `session_list_files`.
///
/// Prevents the IPC payload from growing unbounded if a session directory
/// somehow contains an unusually large number of files.
const MAX_ENTRIES: usize = 2_000;

/// Maximum directory recursion depth for `collect_entries`.
///
/// Session directories are shallow by design (≤ 3 levels). A hard cap
/// prevents a maliciously constructed directory tree from stack-overflowing
/// the blocking worker thread.
const MAX_DEPTH: usize = 8;

/// Recursively collect file entries from `dir`, building paths relative to `root`.
///
/// `depth` tracks the current recursion level; the call site passes 0.
fn collect_entries(
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

// ── Tauri commands ───────────────────────────────────────────────────────────

/// List all files in a session's directory tree.
///
/// Returns a flat list of [`SessionFileEntry`] values (files and directories)
/// with paths relative to the session directory root.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn session_list_files(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<SessionFileEntry>> {
    crate::validators::validate_session_id(&session_id)?;

    let session_state_dir = read_config(&state).session_state_dir();

    blocking_cmd!({
        let session_dir = session_state_dir.join(&session_id);

        let mut entries = Vec::new();
        // Canonicalize before walking so we have an authoritative prefix to
        // verify subdirectories against (TOCTOU mitigation).
        // Drop the separate `exists()` precheck — let `canonicalize()` fail
        // with NotFound to eliminate the race window between the two calls.
        let canonical_dir = session_dir.canonicalize().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                BindingsError::Validation(format!(
                    "Session directory not found: {}",
                    session_id
                ))
            } else {
                BindingsError::Validation(format!("Failed to resolve session dir: {e}"))
            }
        })?;
        collect_entries(&canonical_dir, &canonical_dir, 0, &mut entries)?;
        entries.sort_by(|a, b| {
            // Directories first, then alphabetically by path
            b.is_directory
                .cmp(&a.is_directory)
                .then_with(|| a.path.cmp(&b.path))
        });
        Ok::<_, BindingsError>(entries)
    })
}

/// Read the text content of a file within a session directory.
///
/// Returns the file contents as a UTF-8 string. Files exceeding
/// [`MAX_READ_BYTES`] are truncated with a trailing notice.
/// Binary files (`.db`, `.sqlite`, etc.) cannot be read and return an error.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id, %relative_path))]
pub async fn session_read_file(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    relative_path: String,
) -> CmdResult<String> {
    crate::validators::validate_session_id(&session_id)?;

    let session_state_dir = read_config(&state).session_state_dir();

    blocking_cmd!({
        let session_dir = session_state_dir.join(&session_id);
        let file_path = safe_session_file_path(&session_dir, &relative_path)?;

        if !file_path.exists() {
            return Err(BindingsError::Validation(format!(
                "File not found: {}",
                relative_path
            )));
        }

        // Re-canonicalize after the exists() check to close the TOCTOU window:
        // between safe_session_file_path (which skips canonicalization for
        // non-existent files) and here, the path could have been replaced with
        // a symlink pointing outside the session directory.
        let canonical_dir = session_dir.canonicalize()?;
        let file_path = file_path.canonicalize()?;
        if !file_path.starts_with(&canonical_dir) {
            return Err(BindingsError::Validation(
                "File path escapes session directory".into(),
            ));
        }

        if file_path.is_dir() {
            return Err(BindingsError::Validation(format!(
                "'{}' is a directory, not a file",
                relative_path
            )));
        }

        // Refuse to read binary formats or hidden dotfiles.
        let file_name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if file_name.starts_with('.') {
            return Err(BindingsError::Validation(
                "Hidden files cannot be read".into(),
            ));
        }
        if SessionFileType::from_name(&file_name) == SessionFileType::Binary
            || SessionFileType::from_name(&file_name) == SessionFileType::Sqlite
        {
            return Err(BindingsError::Validation(format!(
                "'{}' is a binary file and cannot be displayed as text",
                relative_path
            )));
        }

        // Open the file once and read through a size-limited handle to close
        // the TOCTOU window between a metadata() size check and the subsequent
        // read (relevant for active sessions where events.jsonl grows rapidly).
        use std::io::Read as _;
        let file = std::fs::File::open(&file_path)?;
        let mut buf = Vec::new();
        // take(MAX + 1) lets us detect truncation without a separate metadata call.
        let n = file.take(MAX_READ_BYTES + 1).read_to_end(&mut buf)?;
        let truncated = n > MAX_READ_BYTES as usize;
        if truncated {
            buf.truncate(MAX_READ_BYTES as usize);
            // Walk back to the last valid UTF-8 boundary so we don't split a
            // multi-byte codepoint at the cut point (continuation bytes have
            // the high bits 0b10xxxxxx, i.e. (byte & 0xC0) == 0x80).
            while !buf.is_empty() && (buf[buf.len() - 1] & 0xC0 == 0x80) {
                buf.pop();
            }
        }

        let mut content = String::from_utf8_lossy(&buf).into_owned();
        if truncated {
            content.push_str(&format!(
                "\n\n[... file truncated — showing first {} bytes ...]",
                MAX_READ_BYTES
            ));
        }

        Ok::<_, BindingsError>(content)
    })
}

/// Read all user tables from a SQLite database file within a session directory.
///
/// Returns at most `MAX_ROWS_PER_TABLE` rows per table to keep IPC payloads
/// manageable. The file must be a `.db`, `.sqlite`, or `.sqlite3` file located
/// inside the session directory (path traversal is rejected).
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id, %relative_path))]
pub async fn session_read_sqlite(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    relative_path: String,
) -> CmdResult<Vec<tracepilot_core::parsing::session_db::CustomTableInfo>> {
    use tracepilot_core::parsing::session_db::{list_tables, read_custom_table};

    crate::validators::validate_session_id(&session_id)?;

    let session_state_dir = read_config(&state).session_state_dir();

    blocking_cmd!({
        let session_dir = session_state_dir.join(&session_id);
        let file_path = safe_session_file_path(&session_dir, &relative_path)?;

        if !file_path.exists() {
            return Err(BindingsError::Validation(format!(
                "File not found: {}",
                relative_path
            )));
        }

        // Re-canonicalize after exists() to close the TOCTOU window (same
        // rationale as session_read_file above).
        let canonical_dir = session_dir.canonicalize()?;
        let file_path = file_path.canonicalize()?;
        if !file_path.starts_with(&canonical_dir) {
            return Err(BindingsError::Validation(
                "File path escapes session directory".into(),
            ));
        }

        // Only allow recognised SQLite extensions; reject hidden files.
        let file_name = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if file_name.starts_with('.') {
            return Err(BindingsError::Validation(
                "Hidden files cannot be read".into(),
            ));
        }
        if SessionFileType::from_name(&file_name) != SessionFileType::Sqlite {
            return Err(BindingsError::Validation(format!(
                "'{}' is not a SQLite database file",
                relative_path
            )));
        }

        // Cap table count to prevent a crafted .db with thousands of tables
        // from producing a multi-gigabyte IPC payload.
        let table_names: Vec<_> = list_tables(&file_path)
            .map_err(|e| BindingsError::Validation(format!("Failed to list tables: {}", e)))?
            .into_iter()
            .take(MAX_SQLITE_TABLES)
            .collect();

        let mut tables = Vec::with_capacity(table_names.len());
        for name in &table_names {
            match read_custom_table(&file_path, name) {
                Ok(mut info) => {
                    // Cap rows to keep IPC payload manageable
                    if info.rows.len() > MAX_SQLITE_ROWS_PER_TABLE {
                        info.rows.truncate(MAX_SQLITE_ROWS_PER_TABLE);
                    }
                    tables.push(info);
                }
                Err(e) => {
                    tracing::warn!("Skipping table '{}': {}", name, e);
                }
            }
        }

        Ok::<_, BindingsError>(tables)
    })
}

/// Maximum number of rows returned per SQLite table.
const MAX_SQLITE_ROWS_PER_TABLE: usize = 500;

/// Maximum number of tables returned by `session_read_sqlite`.
///
/// A crafted SQLite file with thousands of tables could produce a multi-gigabyte
/// IPC payload (tables × rows × row size). 50 tables is generous for any real
/// session database while being several orders of magnitude below the attack threshold.
const MAX_SQLITE_TABLES: usize = 50;

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

    // ── SessionFileType classification ─────────────────────────

    #[test]
    fn file_type_markdown() {
        assert_eq!(SessionFileType::from_name("plan.md"), SessionFileType::Markdown);
        assert_eq!(SessionFileType::from_name("README.MD"), SessionFileType::Markdown);
    }

    #[test]
    fn file_type_jsonl() {
        assert_eq!(SessionFileType::from_name("events.jsonl"), SessionFileType::Jsonl);
    }

    #[test]
    fn file_type_json() {
        assert_eq!(SessionFileType::from_name("workspace.json"), SessionFileType::Json);
    }

    #[test]
    fn file_type_yaml() {
        assert_eq!(SessionFileType::from_name("workspace.yaml"), SessionFileType::Yaml);
        assert_eq!(SessionFileType::from_name("config.yml"), SessionFileType::Yaml);
    }

    #[test]
    fn file_type_toml() {
        assert_eq!(SessionFileType::from_name("Cargo.toml"), SessionFileType::Toml);
    }

    #[test]
    fn file_type_sqlite() {
        assert_eq!(SessionFileType::from_name("session.db"), SessionFileType::Sqlite);
        assert_eq!(SessionFileType::from_name("data.sqlite"), SessionFileType::Sqlite);
        assert_eq!(SessionFileType::from_name("data.sqlite3"), SessionFileType::Sqlite);
    }

    #[test]
    fn file_type_text_extensions() {
        assert_eq!(SessionFileType::from_name("run.sh"), SessionFileType::Text);
        assert_eq!(SessionFileType::from_name("script.ps1"), SessionFileType::Text);
        assert_eq!(SessionFileType::from_name("notes.txt"), SessionFileType::Text);
        assert_eq!(SessionFileType::from_name("output.log"), SessionFileType::Text);
    }

    #[test]
    fn file_type_binary_fallback() {
        // Known binary formats are always Binary.
        assert_eq!(SessionFileType::from_name("archive.zip"), SessionFileType::Binary);
        assert_eq!(SessionFileType::from_name("image.png"), SessionFileType::Binary);
        assert_eq!(SessionFileType::from_name("app.exe"), SessionFileType::Binary);
        assert_eq!(SessionFileType::from_name("lib.dll"), SessionFileType::Binary);
    }

    #[test]
    fn file_type_unknown_extension_defaults_to_text() {
        // Unknown extensions are treated as Text (not Binary) so that common
        // agent-produced files (.cfg, .ini, .conf, .diff, .patch, .bak) are
        // readable in the file viewer instead of being blocked.
        assert_eq!(SessionFileType::from_name("config.cfg"), SessionFileType::Text);
        assert_eq!(SessionFileType::from_name("settings.ini"), SessionFileType::Text);
        assert_eq!(SessionFileType::from_name("server.conf"), SessionFileType::Text);
        assert_eq!(SessionFileType::from_name("changes.diff"), SessionFileType::Text);
        assert_eq!(SessionFileType::from_name("notes.bak"), SessionFileType::Text);
    }

    #[test]
    fn file_type_dotless_names_are_text() {
        // Dotless filenames (Dockerfile, Makefile, Gemfile, Procfile, etc.)
        // should never be classified as Binary — they are always UTF-8 text.
        assert_eq!(SessionFileType::from_name("Dockerfile"), SessionFileType::Text);
        assert_eq!(SessionFileType::from_name("Makefile"), SessionFileType::Text);
        assert_eq!(SessionFileType::from_name("Gemfile"), SessionFileType::Text);
        assert_eq!(SessionFileType::from_name("Procfile"), SessionFileType::Text);
        assert_eq!(SessionFileType::from_name("Rakefile"), SessionFileType::Text);
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
        // COM1-9, COM10+, LPT1-9, LPT10+ are reserved by Windows.
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
        // Trailing spaces and periods are stripped by Windows kernel — must be
        // caught before the device name check (e.g. "CON " → CON, "NUL." → NUL).
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
        // Drive-relative paths like C:relative bypass starts_with('/') and
        // Path::is_absolute() but cause session_dir.join() to redirect drives.
        assert!(validate_relative_path("C:relative").is_err());
        assert!(validate_relative_path("D:secret.txt").is_err());
        assert!(validate_relative_path("files/C:escape").is_err());
    }

    #[test]
    fn collect_entries_respects_entry_cap() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        // Create MAX_ENTRIES + 10 files.
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
        // Build a directory chain exactly MAX_DEPTH + 1 levels deep.
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
    fn read_binary_file_is_rejected() {
        assert_eq!(
            SessionFileType::from_name("session.db"),
            SessionFileType::Sqlite
        );
    }

    // ── session_read_sqlite path validation ────────────────────

    #[test]
    fn sqlite_rejects_non_db_extension() {
        // We can't call the full async Tauri command without an AppHandle, but we
        // can verify the path-security helpers reject what they should and that
        // SessionFileType classification is correct so the command would reject
        // a text file being passed as a SQLite path.
        assert_ne!(SessionFileType::from_name("events.jsonl"), SessionFileType::Sqlite);
        assert_ne!(SessionFileType::from_name("workspace.yaml"), SessionFileType::Sqlite);
        assert_ne!(SessionFileType::from_name("notes.txt"), SessionFileType::Sqlite);
    }

    #[test]
    fn sqlite_accepts_db_extensions() {
        assert_eq!(SessionFileType::from_name("session.db"), SessionFileType::Sqlite);
        assert_eq!(SessionFileType::from_name("data.sqlite"), SessionFileType::Sqlite);
        assert_eq!(SessionFileType::from_name("store.sqlite3"), SessionFileType::Sqlite);
    }

    #[test]
    fn sqlite_path_traversal_rejected() {
        let tmp = TempDir::new().unwrap();
        let session_dir = make_session_dir(&tmp);
        assert!(safe_session_file_path(&session_dir, "../other.db").is_err());
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

        // A directory *outside* the session dir that shouldn't be visited.
        let outside_dir = tmp.path().join("outside");
        std::fs::create_dir_all(&outside_dir).unwrap();
        std::fs::write(outside_dir.join("secret.txt"), "secret").unwrap();

        // Create a symlink inside the session dir pointing to outside_dir.
        let symlink_path = session_dir.join("evil_link");
        symlink(&outside_dir, &symlink_path).unwrap();

        let mut entries = Vec::new();
        collect_entries(&session_dir, &session_dir, 0, &mut entries).unwrap();

        let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(!names.contains(&"evil_link"), "symlink dir should be skipped: {names:?}");
        assert!(!names.contains(&"secret.txt"), "file from outside root leaked: {names:?}");
    }
}
