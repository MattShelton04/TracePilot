//! Orchestrator health monitoring and recovery decisions.

use crate::error::Result;
use crate::task_ipc::protocol;
use crate::task_orchestrator::launcher::OrchestratorHandle;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// How long (seconds) before a missing heartbeat means the orchestrator is dead.
const DEFAULT_HEARTBEAT_TIMEOUT_SECS: u64 = 120;

/// Health status of the orchestrator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrchestratorHealth {
    /// Orchestrator is actively running and heartbeating.
    Healthy,
    /// No heartbeat recently — may have stalled.
    Stale,
    /// Orchestrator is not running (no PID, no heartbeat).
    Stopped,
    /// Unknown state (couldn't determine).
    Unknown,
}

/// Full health check result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckResult {
    pub health: OrchestratorHealth,
    pub heartbeat_age_secs: Option<u64>,
    pub last_cycle: Option<u32>,
    pub active_tasks: Vec<String>,
    pub needs_restart: bool,
}

/// Check the health of the orchestrator.
///
/// Uses heartbeat freshness and optionally the PID to determine status.
pub fn check_orchestrator_health(
    jobs_dir: &Path,
    handle: Option<&OrchestratorHandle>,
    heartbeat_timeout_secs: Option<u64>,
) -> HealthCheckResult {
    let timeout = heartbeat_timeout_secs.unwrap_or(DEFAULT_HEARTBEAT_TIMEOUT_SECS);

    // Try to read heartbeat
    let heartbeat = protocol::read_heartbeat(jobs_dir).ok().flatten();
    let heartbeat_path = jobs_dir.join("heartbeat.json");
    let heartbeat_age = std::fs::metadata(&heartbeat_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.elapsed().ok())
        .map(|d| d.as_secs());

    // No handle means orchestrator was never launched or state was lost
    if handle.is_none() {
        return HealthCheckResult {
            health: OrchestratorHealth::Stopped,
            heartbeat_age_secs: heartbeat_age,
            last_cycle: heartbeat.as_ref().map(|h| h.cycle),
            active_tasks: vec![],
            needs_restart: false,
        };
    }

    // Check heartbeat freshness
    match heartbeat_age {
        Some(age) if age < timeout => {
            HealthCheckResult {
                health: OrchestratorHealth::Healthy,
                heartbeat_age_secs: Some(age),
                last_cycle: heartbeat.as_ref().map(|h| h.cycle),
                active_tasks: heartbeat
                    .map(|h| h.active_tasks)
                    .unwrap_or_default(),
                needs_restart: false,
            }
        }
        Some(age) => {
            // Heartbeat exists but is stale
            HealthCheckResult {
                health: OrchestratorHealth::Stale,
                heartbeat_age_secs: Some(age),
                last_cycle: heartbeat.as_ref().map(|h| h.cycle),
                active_tasks: vec![],
                needs_restart: true,
            }
        }
        None => {
            // No heartbeat file at all (or unreadable)
            HealthCheckResult {
                health: OrchestratorHealth::Unknown,
                heartbeat_age_secs: None,
                last_cycle: None,
                active_tasks: vec![],
                needs_restart: true,
            }
        }
    }
}

/// Determine if the orchestrator should be restarted.
///
/// Decision factors:
/// 1. Heartbeat is stale (> timeout)
/// 2. There are still pending tasks in the DB
pub fn should_restart(
    health: &HealthCheckResult,
    has_pending_tasks: bool,
) -> bool {
    health.needs_restart && has_pending_tasks
}

/// Prepare for a restart by cleaning up stale state.
///
/// - Releases claimed tasks back to pending
/// - Clears the old heartbeat file
/// - Returns the number of tasks released
pub fn prepare_restart(
    conn: &rusqlite::Connection,
    jobs_dir: &Path,
    stale_minutes: i64,
) -> Result<u64> {
    // Release stale claimed/in_progress tasks
    let released = crate::task_db::operations::release_stale_tasks(conn, stale_minutes)?;

    // Remove old heartbeat
    let heartbeat_path = jobs_dir.join("heartbeat.json");
    if heartbeat_path.exists() {
        let _ = std::fs::remove_file(&heartbeat_path);
    }

    if released > 0 {
        tracing::info!(released = released, "Released stale tasks for restart");
    }

    Ok(released)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_ipc::protocol::HeartbeatFile;
    use tempfile::TempDir;

    fn make_handle() -> OrchestratorHandle {
        OrchestratorHandle {
            pid: 12345,
            manifest_path: "/tmp/manifest.json".to_string(),
            jobs_dir: "/tmp/jobs".to_string(),
            launched_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn stopped_when_no_handle() {
        let dir = TempDir::new().unwrap();
        let result = check_orchestrator_health(dir.path(), None, None);
        assert_eq!(result.health, OrchestratorHealth::Stopped);
        assert!(!result.needs_restart);
    }

    #[test]
    fn healthy_with_fresh_heartbeat() {
        let dir = TempDir::new().unwrap();
        let hb = HeartbeatFile {
            timestamp: chrono::Utc::now().to_rfc3339(),
            cycle: 5,
            active_tasks: vec!["task-001".to_string()],
            completed_tasks: vec![],
        };
        crate::json_io::atomic_json_write(&dir.path().join("heartbeat.json"), &hb).unwrap();

        let handle = make_handle();
        let result = check_orchestrator_health(dir.path(), Some(&handle), None);
        assert_eq!(result.health, OrchestratorHealth::Healthy);
        assert!(!result.needs_restart);
        assert_eq!(result.last_cycle, Some(5));
    }

    #[test]
    fn unknown_when_no_heartbeat_file() {
        let dir = TempDir::new().unwrap();
        let handle = make_handle();
        let result = check_orchestrator_health(dir.path(), Some(&handle), None);
        assert_eq!(result.health, OrchestratorHealth::Unknown);
        assert!(result.needs_restart);
    }

    #[test]
    fn should_restart_only_with_pending() {
        let health = HealthCheckResult {
            health: OrchestratorHealth::Stale,
            heartbeat_age_secs: Some(300),
            last_cycle: Some(10),
            active_tasks: vec![],
            needs_restart: true,
        };
        assert!(should_restart(&health, true));
        assert!(!should_restart(&health, false));
    }
}
