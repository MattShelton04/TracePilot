//! Parser for `rewind-snapshots/index.json` — the rewind snapshot index.

use crate::error::{Result, TracePilotError};
use serde::Deserialize;
use std::path::Path;

/// Top-level rewind snapshot index.
#[derive(Debug, Clone, Deserialize)]
pub struct RewindIndex {
    pub version: u32,
    pub snapshots: Vec<RewindSnapshot>,
}

/// A single rewind snapshot entry.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindSnapshot {
    pub snapshot_id: String,
    pub event_id: Option<String>,
    pub user_message: Option<String>,
    pub timestamp: Option<String>,
    pub file_count: Option<u32>,
    pub git_commit: Option<String>,
    pub git_branch: Option<String>,
}

/// Parse `rewind-snapshots/index.json` from a session directory.
///
/// Returns `None` if the file doesn't exist.
pub fn parse_rewind_index(session_dir: &Path) -> Result<Option<RewindIndex>> {
    let index_path = session_dir.join("rewind-snapshots").join("index.json");

    if !index_path.exists() {
        return Ok(None);
    }

    let content =
        std::fs::read_to_string(&index_path).map_err(|e| TracePilotError::ParseError {
            context: format!("Failed to read {}", index_path.display()),
            source: Some(Box::new(e)),
        })?;

    let index: RewindIndex =
        serde_json::from_str(&content).map_err(|e| TracePilotError::ParseError {
            context: format!("Failed to parse {}", index_path.display()),
            source: Some(Box::new(e)),
        })?;

    Ok(Some(index))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rewind_index() {
        let dir = tempfile::tempdir().unwrap();
        let rw_dir = dir.path().join("rewind-snapshots");
        std::fs::create_dir_all(&rw_dir).unwrap();

        let json = r#"{
            "version": 1,
            "snapshots": [
                {
                    "snapshotId": "snap-001",
                    "eventId": "evt-10",
                    "userMessage": "Add login page",
                    "timestamp": "2026-03-10T07:20:00.000Z",
                    "fileCount": 3,
                    "gitCommit": "abc123",
                    "gitBranch": "main"
                },
                {
                    "snapshotId": "snap-002",
                    "eventId": null,
                    "userMessage": null,
                    "timestamp": "2026-03-10T07:25:00.000Z",
                    "fileCount": 5,
                    "gitCommit": null,
                    "gitBranch": null
                }
            ]
        }"#;
        std::fs::write(rw_dir.join("index.json"), json).unwrap();

        let result = parse_rewind_index(dir.path()).unwrap();
        assert!(result.is_some());
        let idx = result.unwrap();
        assert_eq!(idx.version, 1);
        assert_eq!(idx.snapshots.len(), 2);

        assert_eq!(idx.snapshots[0].snapshot_id, "snap-001");
        assert_eq!(idx.snapshots[0].event_id.as_deref(), Some("evt-10"));
        assert_eq!(
            idx.snapshots[0].user_message.as_deref(),
            Some("Add login page")
        );
        assert_eq!(idx.snapshots[0].file_count, Some(3));
        assert_eq!(idx.snapshots[0].git_commit.as_deref(), Some("abc123"));

        assert_eq!(idx.snapshots[1].snapshot_id, "snap-002");
        assert!(idx.snapshots[1].event_id.is_none());
        assert!(idx.snapshots[1].git_commit.is_none());
    }

    #[test]
    fn test_no_rewind_dir() {
        let dir = tempfile::tempdir().unwrap();
        let result = parse_rewind_index(dir.path()).unwrap();
        assert!(result.is_none());
    }
}
