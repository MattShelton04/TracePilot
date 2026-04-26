//! Discover sessions stored under `~/.copilot/session-state/{UUID}/`.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use crate::error::{Result, TracePilotError};

/// Maximum age of session activity before a lock file is considered stale.
const STALE_LOCK_THRESHOLD: Duration = Duration::from_secs(24 * 60 * 60); // 24 hours

/// Default location for Copilot CLI session state.
pub fn default_session_state_dir() -> PathBuf {
    let home = dirs_path();
    home.join(".copilot").join("session-state")
}

fn dirs_path() -> PathBuf {
    crate::utils::home_dir()
}

/// A discovered session directory with its UUID and path.
#[derive(Debug, Clone)]
pub struct DiscoveredSession {
    pub id: crate::ids::SessionId,
    pub path: PathBuf,
    pub has_workspace_yaml: bool,
    pub has_events_jsonl: bool,
    pub has_session_db: bool,
}

/// Scan the session-state directory and return all discovered sessions.
///
/// PERF: I/O bound — reads directory entries and checks for marker files.
/// Called on every reindex. Scales linearly with session count (~1ms per 100 sessions).
#[tracing::instrument(skip_all, fields(dir = %base_dir.display()))]
pub fn discover_sessions(base_dir: &Path) -> Result<Vec<DiscoveredSession>> {
    let mut sessions = Vec::new();

    if !base_dir.exists() {
        return Ok(sessions);
    }

    let entries = std::fs::read_dir(base_dir).map_err(|e| {
        TracePilotError::io_context("Failed to read session-state dir:", base_dir.display(), e)
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
            Ok(u) => crate::ids::SessionId::from_validated(u.to_string()),
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

/// Check whether a session directory contains an active lock file (`inuse.*.lock`).
///
/// The Copilot CLI creates this file while a session is open and removes it on exit.
/// If the CLI crashes, the lock file may persist. As a secondary check, we verify
/// that the session has recent activity (events.jsonl or lock file modified within
/// the last 24 hours). If both are stale, we treat the session as inactive.
pub fn has_lock_file(session_dir: &Path) -> bool {
    let has_lock = std::fs::read_dir(session_dir)
        .map(|entries| {
            entries.filter_map(|e| e.ok()).any(|e| {
                let name = e.file_name();
                let name = name.to_string_lossy();
                name.starts_with("inuse.") && name.ends_with(".lock")
            })
        })
        .unwrap_or(false);

    if !has_lock {
        return false;
    }

    // Lock file exists — check for recent activity to filter stale locks
    has_recent_activity(session_dir)
}

/// Check if a session has recent file activity within the staleness threshold.
/// Returns true if any key session file has been modified recently, or if we
/// can't determine mtime (fail-open to avoid false negatives).
fn has_recent_activity(session_dir: &Path) -> bool {
    let now = SystemTime::now();

    // Check events.jsonl first (best activity indicator)
    if is_file_recent(&session_dir.join("events.jsonl"), now) {
        return true;
    }

    // Check lock file mtime as fallback
    if let Ok(entries) = std::fs::read_dir(session_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("inuse.")
                && name_str.ends_with(".lock")
                && is_file_recent(&entry.path(), now)
            {
                return true;
            }
        }
    }

    // Both are stale or unreadable — treat as inactive
    false
}

/// Check if a file has been modified within the staleness threshold.
/// Fails open: returns true if mtime cannot be determined or is in the future
/// (e.g., clock skew), to avoid hiding genuinely active sessions.
fn is_file_recent(path: &Path, now: SystemTime) -> bool {
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false, // File doesn't exist — not evidence of activity
    };
    let modified = match meta.modified() {
        Ok(t) => t,
        Err(_) => return true, // Can't read mtime — fail open
    };
    match now.duration_since(modified) {
        Ok(age) => age < STALE_LOCK_THRESHOLD,
        Err(_) => true, // mtime is in the future (clock skew) — fail open
    }
}

/// Resolve a session ID (full or partial prefix) to its directory path.
/// Returns TracePilotError::SessionNotFound if no match or multiple matches.
pub fn resolve_session_path(session_id_prefix: &str) -> Result<PathBuf> {
    resolve_session_path_in(session_id_prefix, &default_session_state_dir())
}

/// Resolve a session ID (full or partial prefix) to its directory path,
/// searching within the given base directory.
/// Resolve a session path directly from a full session UUID without scanning.
///
/// Session IDs in the IPC layer are always full UUIDs (not prefixes), so we
/// can construct the path directly without the `discover_sessions()` overhead.
/// This is used by all hot-path commands (get_session_detail, get_session_turns,
/// etc.) to avoid expensive directory scans on every request.
///
/// Returns `SessionNotFound` if the directory doesn't exist (the session hasn't
/// been materialized yet), not if the UUID format is invalid — callers validate
/// UUIDs separately.
#[tracing::instrument(skip_all, fields(session_id = %session_id))]
pub fn resolve_session_path_direct(session_id: &str, base_dir: &Path) -> Result<PathBuf> {
    let path = base_dir.join(session_id);
    if !path.exists() {
        return Err(TracePilotError::SessionNotFound(session_id.to_string()));
    }
    Ok(path)
}

pub fn resolve_session_path_in(session_id_prefix: &str, base_dir: &Path) -> Result<PathBuf> {
    let sessions = discover_sessions(base_dir)?;
    let matches: Vec<_> = sessions
        .iter()
        .filter(|s| s.id.as_str().starts_with(session_id_prefix))
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
        let tmp = tempfile::tempdir().unwrap();
        let sessions = discover_sessions(tmp.path()).unwrap();
        assert!(sessions.is_empty());
    }

    #[test]
    fn test_discover_sessions_finds_uuid_dirs() {
        let tmp = tempfile::tempdir().unwrap();

        let uuid_dir = tmp.path().join("c86fe369-c858-4d91-81da-203c5e276e33");
        fs::create_dir_all(&uuid_dir).unwrap();
        fs::write(uuid_dir.join("workspace.yaml"), "id: test").unwrap();

        let not_uuid = tmp.path().join("not-a-uuid");
        fs::create_dir_all(&not_uuid).unwrap();

        let sessions = discover_sessions(tmp.path()).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(
            sessions[0].id.as_str(),
            "c86fe369-c858-4d91-81da-203c5e276e33"
        );
        assert!(sessions[0].has_workspace_yaml);
    }

    #[test]
    fn test_resolve_session_path_exact_match() {
        let tmp = tempfile::tempdir().unwrap();

        let uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let session_dir = tmp.path().join(uuid);
        fs::create_dir_all(&session_dir).unwrap();

        let result = resolve_session_path_in(uuid, tmp.path());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), session_dir);
    }

    #[test]
    fn test_resolve_session_path_prefix_match() {
        let tmp = tempfile::tempdir().unwrap();

        let uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let session_dir = tmp.path().join(uuid);
        fs::create_dir_all(&session_dir).unwrap();

        let result = resolve_session_path_in("a1b2c3d4", tmp.path());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), session_dir);
    }

    #[test]
    fn test_resolve_session_path_no_match() {
        let tmp = tempfile::tempdir().unwrap();

        let result = resolve_session_path_in("nonexistent", tmp.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_session_path_ambiguous() {
        let tmp = tempfile::tempdir().unwrap();

        let uuid1 = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
        let uuid2 = "a1b2c3d4-e5f6-7890-abcd-000000000000";
        fs::create_dir_all(tmp.path().join(uuid1)).unwrap();
        fs::create_dir_all(tmp.path().join(uuid2)).unwrap();

        let result = resolve_session_path_in("a1b2c3d4", tmp.path());
        assert!(result.is_err());
        let err_msg = format!("{}", result.unwrap_err());
        assert!(err_msg.contains("Ambiguous"));
    }

    #[test]
    fn test_has_lock_file_present() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("inuse.12345.lock"), "").unwrap();
        // Lock file present + recently created = active
        assert!(has_lock_file(tmp.path()));
    }

    #[test]
    fn test_has_lock_file_absent() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(!has_lock_file(tmp.path()));
    }

    #[test]
    fn test_has_lock_file_stale() {
        use filetime::FileTime;
        let tmp = tempfile::tempdir().unwrap();
        let lock_path = tmp.path().join("inuse.12345.lock");
        fs::write(&lock_path, "").unwrap();
        // Set mtime to 48 hours ago
        let old_time = FileTime::from_system_time(
            std::time::SystemTime::now() - std::time::Duration::from_secs(48 * 60 * 60),
        );
        filetime::set_file_mtime(&lock_path, old_time).unwrap();
        // No events.jsonl, stale lock → should be inactive
        assert!(!has_lock_file(tmp.path()));
    }

    #[test]
    fn test_has_lock_file_stale_but_recent_events() {
        use filetime::FileTime;
        let tmp = tempfile::tempdir().unwrap();
        let lock_path = tmp.path().join("inuse.12345.lock");
        fs::write(&lock_path, "").unwrap();
        // Set lock mtime to 48 hours ago
        let old_time = FileTime::from_system_time(
            std::time::SystemTime::now() - std::time::Duration::from_secs(48 * 60 * 60),
        );
        filetime::set_file_mtime(&lock_path, old_time).unwrap();
        // Create recent events.jsonl
        fs::write(tmp.path().join("events.jsonl"), "{}").unwrap();
        // Recent events → should be active despite stale lock
        assert!(has_lock_file(tmp.path()));
    }
}
