//! Discover sessions stored under `~/.copilot/session-state/{UUID}/`.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

/// Default location for Copilot CLI session state.
pub fn default_session_state_dir() -> PathBuf {
    let home = dirs_path();
    home.join(".copilot").join("session-state")
}

/// Return the user's home directory.
fn dirs_path() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("C:\\Users\\default"))
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/tmp"))
    }
}

/// A discovered session directory with its UUID and path.
#[derive(Debug, Clone)]
pub struct DiscoveredSession {
    pub id: String,
    pub path: PathBuf,
    pub has_workspace_yaml: bool,
    pub has_events_jsonl: bool,
    pub has_session_db: bool,
}

/// Scan the session-state directory and return all discovered sessions.
pub fn discover_sessions(base_dir: &Path) -> Result<Vec<DiscoveredSession>> {
    let mut sessions = Vec::new();

    if !base_dir.exists() {
        return Ok(sessions);
    }

    let entries = std::fs::read_dir(base_dir)
        .with_context(|| format!("Failed to read session-state dir: {}", base_dir.display()))?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let id = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();

        // UUID format check (loose: 8-4-4-4-12 hex chars)
        if id.len() != 36 || id.chars().filter(|c| *c == '-').count() != 4 {
            continue;
        }

        sessions.push(DiscoveredSession {
            id,
            has_workspace_yaml: path.join("workspace.yaml").exists(),
            has_events_jsonl: path.join("events.jsonl").exists(),
            has_session_db: path.join("session.db").exists(),
            path,
        });
    }

    sessions.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_discover_sessions_empty_dir() {
        let tmp = std::env::temp_dir().join("tracepilot_test_empty");
        let _ = fs::create_dir_all(&tmp);
        let sessions = discover_sessions(&tmp).unwrap();
        assert!(sessions.is_empty());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_discover_sessions_finds_uuid_dirs() {
        let tmp = std::env::temp_dir().join("tracepilot_test_uuid");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let uuid_dir = tmp.join("c86fe369-c858-4d91-81da-203c5e276e33");
        fs::create_dir_all(&uuid_dir).unwrap();
        fs::write(uuid_dir.join("workspace.yaml"), "id: test").unwrap();

        let not_uuid = tmp.join("not-a-uuid");
        fs::create_dir_all(&not_uuid).unwrap();

        let sessions = discover_sessions(&tmp).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "c86fe369-c858-4d91-81da-203c5e276e33");
        assert!(sessions[0].has_workspace_yaml);

        let _ = fs::remove_dir_all(&tmp);
    }
}
