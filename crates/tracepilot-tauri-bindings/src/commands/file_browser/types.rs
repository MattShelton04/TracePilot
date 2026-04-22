//! Types and constants for the session file browser.

use serde::{Deserialize, Serialize};

/// Maximum size of a text file that will be returned verbatim (1 MiB).
pub(super) const MAX_READ_BYTES: u64 = 1_024 * 1_024;

/// Maximum number of file entries returned by `session_list_files`.
///
/// Prevents the IPC payload from growing unbounded if a session directory
/// somehow contains an unusually large number of files.
pub(super) const MAX_ENTRIES: usize = 2_000;

/// Maximum directory recursion depth for `collect_entries`.
///
/// Session directories are shallow by design (≤ 3 levels). A hard cap
/// prevents a maliciously constructed directory tree from stack-overflowing
/// the blocking worker thread.
pub(super) const MAX_DEPTH: usize = 8;

/// Maximum number of rows returned per SQLite table.
pub(super) const MAX_SQLITE_ROWS_PER_TABLE: usize = 500;

/// Maximum number of tables returned by `session_read_sqlite`.
///
/// A crafted SQLite file with thousands of tables could produce a multi-gigabyte
/// IPC payload (tables × rows × row size). 50 tables is generous for any real
/// session database while being several orders of magnitude below the attack threshold.
pub(super) const MAX_SQLITE_TABLES: usize = 50;

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
    pub(super) fn from_name(name: &str) -> Self {
        let lower = name.to_lowercase();
        let ext = lower.rsplit('.').next().unwrap_or("");
        match ext {
            "md" | "markdown" => Self::Markdown,
            "jsonl" => Self::Jsonl,
            "json" => Self::Json,
            "yaml" | "yml" => Self::Yaml,
            "toml" => Self::Toml,
            "db" | "sqlite" | "sqlite3" => Self::Sqlite,
            "txt" | "log" | "csv" | "lock" | "sh" | "ps1" | "ts" | "js" | "rs" | "py" | "rb"
            | "go" | "java" | "cpp" | "c" | "h" | "css" | "html" | "xml" | "env" => Self::Text,
            _ => {
                // Unknown extension — prefer Text unless the extension is a
                // known binary format. This keeps common agent-produced files
                // (.cfg, .ini, .conf, .diff, .patch, .bak) readable by default.
                //
                // Files without any dot (Dockerfile, Makefile, Gemfile, etc.)
                // are always text.
                let known_binary = matches!(
                    ext,
                    "zip"
                        | "gz"
                        | "tar"
                        | "bz2"
                        | "xz"
                        | "7z"
                        | "rar"
                        | "exe"
                        | "dll"
                        | "so"
                        | "dylib"
                        | "bin"
                        | "png"
                        | "jpg"
                        | "jpeg"
                        | "gif"
                        | "webp"
                        | "bmp"
                        | "ico"
                        | "tiff"
                        | "mp3"
                        | "mp4"
                        | "wav"
                        | "ogg"
                        | "flac"
                        | "mkv"
                        | "avi"
                        | "pdf"
                        | "doc"
                        | "docx"
                        | "xls"
                        | "xlsx"
                        | "ppt"
                        | "pptx"
                        | "wasm"
                        | "class"
                        | "pyc"
                        | "o"
                        | "a"
                        | "lib"
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

// ── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_type_markdown() {
        assert_eq!(
            SessionFileType::from_name("plan.md"),
            SessionFileType::Markdown
        );
        assert_eq!(
            SessionFileType::from_name("README.MD"),
            SessionFileType::Markdown
        );
    }

    #[test]
    fn file_type_jsonl() {
        assert_eq!(
            SessionFileType::from_name("events.jsonl"),
            SessionFileType::Jsonl
        );
    }

    #[test]
    fn file_type_json() {
        assert_eq!(
            SessionFileType::from_name("workspace.json"),
            SessionFileType::Json
        );
    }

    #[test]
    fn file_type_yaml() {
        assert_eq!(
            SessionFileType::from_name("workspace.yaml"),
            SessionFileType::Yaml
        );
        assert_eq!(
            SessionFileType::from_name("config.yml"),
            SessionFileType::Yaml
        );
    }

    #[test]
    fn file_type_toml() {
        assert_eq!(
            SessionFileType::from_name("Cargo.toml"),
            SessionFileType::Toml
        );
    }

    #[test]
    fn file_type_sqlite() {
        assert_eq!(
            SessionFileType::from_name("session.db"),
            SessionFileType::Sqlite
        );
        assert_eq!(
            SessionFileType::from_name("data.sqlite"),
            SessionFileType::Sqlite
        );
        assert_eq!(
            SessionFileType::from_name("data.sqlite3"),
            SessionFileType::Sqlite
        );
    }

    #[test]
    fn file_type_text_extensions() {
        assert_eq!(SessionFileType::from_name("run.sh"), SessionFileType::Text);
        assert_eq!(
            SessionFileType::from_name("script.ps1"),
            SessionFileType::Text
        );
        assert_eq!(
            SessionFileType::from_name("notes.txt"),
            SessionFileType::Text
        );
        assert_eq!(
            SessionFileType::from_name("output.log"),
            SessionFileType::Text
        );
    }

    #[test]
    fn file_type_binary_fallback() {
        assert_eq!(
            SessionFileType::from_name("archive.zip"),
            SessionFileType::Binary
        );
        assert_eq!(
            SessionFileType::from_name("image.png"),
            SessionFileType::Binary
        );
        assert_eq!(
            SessionFileType::from_name("app.exe"),
            SessionFileType::Binary
        );
        assert_eq!(
            SessionFileType::from_name("lib.dll"),
            SessionFileType::Binary
        );
    }

    #[test]
    fn file_type_unknown_extension_defaults_to_text() {
        // Unknown extensions are treated as Text (not Binary) so that common
        // agent-produced files (.cfg, .ini, .conf, .diff, .patch, .bak) are
        // readable in the file viewer instead of being blocked.
        assert_eq!(
            SessionFileType::from_name("config.cfg"),
            SessionFileType::Text
        );
        assert_eq!(
            SessionFileType::from_name("settings.ini"),
            SessionFileType::Text
        );
        assert_eq!(
            SessionFileType::from_name("server.conf"),
            SessionFileType::Text
        );
        assert_eq!(
            SessionFileType::from_name("changes.diff"),
            SessionFileType::Text
        );
        assert_eq!(
            SessionFileType::from_name("notes.bak"),
            SessionFileType::Text
        );
    }

    #[test]
    fn file_type_dotless_names_are_text() {
        // Dotless filenames (Dockerfile, Makefile, Gemfile, Procfile, etc.)
        // should never be classified as Binary — they are always UTF-8 text.
        assert_eq!(
            SessionFileType::from_name("Dockerfile"),
            SessionFileType::Text
        );
        assert_eq!(
            SessionFileType::from_name("Makefile"),
            SessionFileType::Text
        );
        assert_eq!(SessionFileType::from_name("Gemfile"), SessionFileType::Text);
        assert_eq!(
            SessionFileType::from_name("Procfile"),
            SessionFileType::Text
        );
        assert_eq!(
            SessionFileType::from_name("Rakefile"),
            SessionFileType::Text
        );
    }

    #[test]
    fn sqlite_type_variants() {
        assert_eq!(
            SessionFileType::from_name("session.db"),
            SessionFileType::Sqlite
        );
        assert_eq!(
            SessionFileType::from_name("data.sqlite"),
            SessionFileType::Sqlite
        );
        assert_eq!(
            SessionFileType::from_name("store.sqlite3"),
            SessionFileType::Sqlite
        );
        // Non-db extensions are not Sqlite
        assert_ne!(
            SessionFileType::from_name("events.jsonl"),
            SessionFileType::Sqlite
        );
        assert_ne!(
            SessionFileType::from_name("workspace.yaml"),
            SessionFileType::Sqlite
        );
        assert_ne!(
            SessionFileType::from_name("notes.txt"),
            SessionFileType::Sqlite
        );
    }

    #[test]
    fn binary_file_classification() {
        assert_eq!(
            SessionFileType::from_name("session.db"),
            SessionFileType::Sqlite
        );
    }
}
