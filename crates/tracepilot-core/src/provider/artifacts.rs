//! Session side files beyond the transcript: the latest plan and the
//! file-history checkpoints a session can be rewound to.
//!
//! These are read only when a view asks for them, never while parsing or
//! indexing, so their content never reaches search.

use std::io::Read as _;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[cfg(feature = "specta")]
use specta::Type;

use crate::error::{Result, TracePilotError};

/// A session's latest plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlanArtifact {
    /// A plan file, read when shown (Copilot's `plan.md`, Claude Code's
    /// `plans/<slug>.md`).
    File(PathBuf),
    /// Plan text the transcript recorded (Claude Code's `ExitPlanMode`).
    Inline(String),
}

impl PlanArtifact {
    /// The plan's text. `None` when the plan file no longer exists.
    pub fn read(&self) -> Result<Option<String>> {
        match self {
            Self::Inline(text) => Ok(Some(text.clone())),
            Self::File(path) => match std::fs::read_to_string(path) {
                Ok(text) => Ok(Some(text)),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(error) => Err(TracePilotError::io_context(
                    "Failed to read",
                    path.display(),
                    error,
                )),
            },
        }
    }
}

/// The files a source backed up before changing them, grouped into the
/// points a session can be rewound to. Read-only: TracePilot never restores.
#[derive(Debug, Clone, Default)]
pub struct FileHistory {
    /// The directory holding the backups. Backend only; never crosses IPC.
    pub dir: PathBuf,
    /// In transcript order.
    pub checkpoints: Vec<FileCheckpoint>,
}

/// The tracked files as they were before one prompt ran.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub struct FileCheckpoint {
    /// 1-based, in transcript order.
    pub number: u32,
    /// The prompt this checkpoint precedes.
    pub message_id: String,
    /// RFC 3339 time the checkpoint was taken.
    pub timestamp: Option<String>,
    /// The opening of the prompt, when the transcript still has it.
    pub prompt: Option<String>,
    /// Sorted by path.
    pub files: Vec<FileVersion>,
}

/// One tracked file at a checkpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    /// The path as the source recorded it.
    pub path: String,
    /// The backup holding the file's content. `None` means the file did not
    /// exist yet.
    pub backup: Option<String>,
    pub version: Option<u32>,
    /// First tracked here, or its backup differs from the previous
    /// checkpoint's.
    pub changed: bool,
}

/// The content of one backed-up file version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "camelCase")]
pub struct FileVersionContent {
    /// Empty for a binary file.
    pub content: String,
    pub binary: bool,
    /// Only the first `max_bytes` were read.
    pub truncated: bool,
}

/// A backup name a source may write: one plain file name, never a path.
pub fn is_safe_backup_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'@' | b'.' | b'-' | b'_'))
}

impl FileHistory {
    /// Whether some checkpoint names `backup`.
    pub fn contains(&self, backup: &str) -> bool {
        self.checkpoints
            .iter()
            .flat_map(|checkpoint| &checkpoint.files)
            .any(|file| file.backup.as_deref() == Some(backup))
    }

    /// Read one backup, at most `max_bytes` of it. `None` when no checkpoint
    /// names it, or the file is gone. The file must resolve directly inside
    /// [`Self::dir`]; a link out of it is refused.
    pub fn read_version(
        &self,
        backup: &str,
        max_bytes: usize,
    ) -> Result<Option<FileVersionContent>> {
        if !is_safe_backup_name(backup) || !self.contains(backup) {
            return Ok(None);
        }
        let Some(path) = contained_file(&self.dir, backup)? else {
            return Ok(None);
        };
        let file = std::fs::File::open(&path)
            .map_err(|e| TracePilotError::io_context("Failed to open", path.display(), e))?;
        let mut bytes = Vec::new();
        file.take(max_bytes as u64 + 1).read_to_end(&mut bytes)?;
        let truncated = bytes.len() > max_bytes;
        bytes.truncate(max_bytes);
        if bytes.iter().take(8192).any(|b| *b == 0) {
            return Ok(Some(FileVersionContent {
                content: String::new(),
                binary: true,
                truncated,
            }));
        }
        let mut content = String::from_utf8_lossy(&bytes).into_owned();
        if truncated {
            // A cut through a multi-byte character decodes as U+FFFD; drop it.
            while content.ends_with('\u{FFFD}') {
                content.pop();
            }
        }
        Ok(Some(FileVersionContent {
            content,
            binary: false,
            truncated,
        }))
    }
}

/// `dir/name` when it is a regular file whose canonical path sits directly
/// inside the canonical `dir`.
fn contained_file(dir: &Path, name: &str) -> Result<Option<PathBuf>> {
    let canonical = |path: &Path| match path.canonicalize() {
        Ok(path) => Ok(Some(path)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(TracePilotError::io_context(
            "Failed to resolve",
            path.display(),
            error,
        )),
    };
    let (Some(dir), Some(file)) = (canonical(dir)?, canonical(&dir.join(name))?) else {
        return Ok(None);
    };
    Ok((file.parent() == Some(dir.as_path()) && file.is_file()).then_some(file))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn history(dir: &Path, backups: &[&str]) -> FileHistory {
        FileHistory {
            dir: dir.to_path_buf(),
            checkpoints: vec![FileCheckpoint {
                number: 1,
                message_id: "m1".into(),
                timestamp: None,
                prompt: None,
                files: backups
                    .iter()
                    .map(|b| FileVersion {
                        path: format!("src/{b}"),
                        backup: Some((*b).into()),
                        version: Some(1),
                        changed: true,
                    })
                    .collect(),
            }],
        }
    }

    #[test]
    fn reads_only_named_backups_inside_the_directory() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join("history");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("aaaa@v1"), "fn main() {}\n").unwrap();
        std::fs::write(dir.join("bbbb@v1"), "unlisted").unwrap();
        std::fs::write(temp.path().join("secret"), "outside").unwrap();
        let history = history(&dir, &["aaaa@v1", "../secret", "gone@v2"]);

        let read = history.read_version("aaaa@v1", 1024).unwrap().unwrap();
        assert_eq!(read.content, "fn main() {}\n");
        assert!(!read.binary && !read.truncated);
        // Not named by any checkpoint, a path rather than a name, or missing.
        assert_eq!(history.read_version("bbbb@v1", 1024).unwrap(), None);
        assert_eq!(history.read_version("../secret", 1024).unwrap(), None);
        assert_eq!(history.read_version("gone@v2", 1024).unwrap(), None);
    }

    #[test]
    fn caps_and_flags_binary_content() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("text@v1"), "héllo world").unwrap();
        std::fs::write(temp.path().join("blob@v1"), [0_u8, 1, 2, 3]).unwrap();
        let history = history(temp.path(), &["text@v1", "blob@v1"]);

        // The cut lands inside "é", which is dropped rather than mangled.
        let cut = history.read_version("text@v1", 2).unwrap().unwrap();
        assert_eq!(cut.content, "h");
        assert!(cut.truncated);
        let blob = history.read_version("blob@v1", 1024).unwrap().unwrap();
        assert!(blob.binary && blob.content.is_empty());
    }

    #[test]
    fn backup_names_are_plain_file_names() {
        assert!(is_safe_backup_name("0123abcd4567ef89@v12"));
        for bad in ["", ".hidden", "a/b", "a\\b", "..", "C:x", &"a".repeat(129)] {
            assert!(!is_safe_backup_name(bad), "{bad}");
        }
    }
}
