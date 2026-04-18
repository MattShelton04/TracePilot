//! Parser for checkpoint files in a session directory.
//!
//! Checkpoints are stored as markdown files under `checkpoints/`, with an
//! `index.md` table listing each checkpoint's number, title, and filename.

use crate::error::{Result, TracePilotError};
use serde::Serialize;
use std::path::Path;

/// Index of all checkpoints in a session.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointIndex {
    pub checkpoints: Vec<CheckpointEntry>,
}

/// A single checkpoint entry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointEntry {
    pub number: u32,
    pub title: String,
    pub filename: String,
    pub content: Option<String>,
}

/// Parse checkpoints from a session directory.
///
/// Returns `None` if the `checkpoints/index.md` file doesn't exist.
/// Reads the markdown table in `index.md` (`| # | Title | File |`) and
/// loads the corresponding `.md` file content for each entry.
pub fn parse_checkpoints(session_dir: &Path) -> Result<Option<CheckpointIndex>> {
    let index_path = session_dir.join("checkpoints").join("index.md");
    if !index_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&index_path)
        .map_err(|e| TracePilotError::io_context("Failed to read", index_path.display(), e))?;

    let checkpoints_dir = session_dir.join("checkpoints");
    let mut entries = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        // Skip empty lines, header rows, and separator rows (e.g. |---|---|---|)
        if trimmed.is_empty() || !trimmed.starts_with('|') || !trimmed.ends_with('|') {
            continue;
        }

        let cols: Vec<&str> = trimmed.split('|').map(|s| s.trim()).collect();

        // After splitting on '|', a line like "| a | b | c |" gives ["", "a", "b", "c", ""]
        // We need at least 5 parts (empty + 3 cols + empty)
        if cols.len() < 5 {
            continue;
        }

        let num_str = cols[1];
        let title = cols[2];
        let filename = cols[3];

        // Skip header row and separator row
        if num_str == "#" || num_str.contains('-') {
            continue;
        }

        let number: u32 = match num_str.parse() {
            Ok(n) => n,
            Err(_) => continue,
        };

        let file_path = checkpoints_dir.join(filename);
        // Prevent path traversal — ensure the resolved path stays under checkpoints/
        let canonical_dir = match checkpoints_dir.canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let canonical_file = match file_path.canonicalize() {
            Ok(p) => p,
            Err(_) => {
                // File doesn't exist — skip silently
                entries.push(CheckpointEntry {
                    number,
                    title: title.to_string(),
                    filename: filename.to_string(),
                    content: None,
                });
                continue;
            }
        };
        if !canonical_file.starts_with(&canonical_dir) {
            // Path escapes checkpoints directory — skip
            continue;
        }

        let file_content = Some(std::fs::read_to_string(&canonical_file).map_err(|e| {
            TracePilotError::io_context("Failed to read checkpoint", canonical_file.display(), e)
        })?);
        entries.push(CheckpointEntry {
            number,
            title: title.to_string(),
            filename: filename.to_string(),
            content: file_content,
        });
    }

    Ok(Some(CheckpointIndex {
        checkpoints: entries,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_checkpoint_index() {
        let dir = tempfile::tempdir().unwrap();
        let cp_dir = dir.path().join("checkpoints");
        std::fs::create_dir_all(&cp_dir).unwrap();

        let index = "| # | Title | File |\n| --- | --- | --- |\n| 1 | Initial setup | cp1.md |\n| 2 | Add auth | cp2.md |\n";
        std::fs::write(cp_dir.join("index.md"), index).unwrap();
        std::fs::write(
            cp_dir.join("cp1.md"),
            "# Checkpoint 1\nInitial project scaffolding",
        )
        .unwrap();
        std::fs::write(cp_dir.join("cp2.md"), "# Checkpoint 2\nAdded auth module").unwrap();

        let result = parse_checkpoints(dir.path()).unwrap();
        assert!(result.is_some());
        let idx = result.unwrap();
        assert_eq!(idx.checkpoints.len(), 2);

        assert_eq!(idx.checkpoints[0].number, 1);
        assert_eq!(idx.checkpoints[0].title, "Initial setup");
        assert_eq!(idx.checkpoints[0].filename, "cp1.md");
        assert!(
            idx.checkpoints[0]
                .content
                .as_ref()
                .unwrap()
                .contains("Initial project scaffolding")
        );

        assert_eq!(idx.checkpoints[1].number, 2);
        assert_eq!(idx.checkpoints[1].title, "Add auth");
        assert!(idx.checkpoints[1].content.is_some());
    }

    #[test]
    fn test_no_checkpoints() {
        let dir = tempfile::tempdir().unwrap();
        let result = parse_checkpoints(dir.path()).unwrap();
        assert!(result.is_none());
    }
}
