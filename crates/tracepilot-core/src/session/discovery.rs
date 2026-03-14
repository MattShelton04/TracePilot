//! Discover sessions stored under `~/.copilot/session-state/{UUID}/`.

use std::path::{Path, PathBuf};

use crate::error::{Result, TracePilotError};

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

    let entries = std::fs::read_dir(base_dir).map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to read session-state dir: {}", base_dir.display()),
        source: Some(Box::new(e)),
    })?;

    for entry in entries {
        let entry = entry?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        // Validate UUID format using the uuid crate
        let id_str = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();

        let id = match uuid::Uuid::parse_str(id_str) {
            Ok(u) => u.to_string(),
            Err(_) => continue,
        };

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

/// Resolve a session ID (full or partial prefix) to its directory path.
/// Returns TracePilotError::SessionNotFound if no match or multiple matches.
pub fn resolve_session_path(session_id_prefix: &str) -> Result<PathBuf> {
    let base_dir = default_session_state_dir();
    let sessions = discover_sessions(&base_dir)?;
    let matches: Vec<_> = sessions
        .iter()
        .filter(|s| s.id.starts_with(session_id_prefix))
        .collect();
    match matches.len() {
        0 => Err(TracePilotError::SessionNotFound(
            session_id_prefix.to_string(),
        )),
        1 => Ok(matches[0].path.clone()),
        _ => Err(TracePilotError::SessionNotFound(format!(
            "Ambiguous prefix '{}' matches {} sessions",
            session_id_prefix,
            matches.len()
        ))),
    }
}

/// Resolve a session ID (full or partial prefix) to its directory path,
/// searching within the given base directory.
pub fn resolve_session_path_in(session_id_prefix: &str, base_dir: &Path) -> Result<PathBuf> {
    let sessions = discover_sessions(base_dir)?;
    let matches: Vec<_> = sessions
        .iter()
        .filter(|s| s.id.starts_with(session_id_prefix))
        .collect();
    match matches.len() {
        0 => Err(TracePilotError::SessionNotFound(
            session_id_prefix.to_string(),
        )),
        1 => Ok(matches[0].path.clone()),
        _ => Err(TracePilotError::SessionNotFound(format!(
            "Ambiguous prefix '{}' matches {} sessions",
            session_id_prefix,
            matches.len()
        ))),
    }
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

    #[test]
    fn test_resolve_session_path_exact_match() {
        let tmp = std::env::temp_dir().join("tracepilot_test_resolve");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let session_dir = tmp.join(uuid);
        fs::create_dir_all(&session_dir).unwrap();

        let result = resolve_session_path_in(uuid, &tmp);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), session_dir);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_resolve_session_path_prefix_match() {
        let tmp = std::env::temp_dir().join("tracepilot_test_resolve_prefix");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let session_dir = tmp.join(uuid);
        fs::create_dir_all(&session_dir).unwrap();

        let result = resolve_session_path_in("a1b2c3d4", &tmp);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), session_dir);

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_resolve_session_path_no_match() {
        let tmp = std::env::temp_dir().join("tracepilot_test_resolve_none");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let result = resolve_session_path_in("nonexistent", &tmp);
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_resolve_session_path_ambiguous() {
        let tmp = std::env::temp_dir().join("tracepilot_test_resolve_ambig");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let uuid1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let uuid2 = "a1b2c3d4-e5f6-7890-abcd-000000000000";
        fs::create_dir_all(tmp.join(uuid1)).unwrap();
        fs::create_dir_all(tmp.join(uuid2)).unwrap();

        let result = resolve_session_path_in("a1b2c3d4", &tmp);
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(err_msg.contains("Ambiguous"));

        let _ = fs::remove_dir_all(&tmp);
    }
}
