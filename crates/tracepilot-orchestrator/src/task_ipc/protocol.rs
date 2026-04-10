//! IPC protocol types — the file-format contracts between app and agent.

use serde::{Deserialize, Serialize};

/// Status file written by the orchestrator when a task finishes.
///
/// Located at `jobs/{task_id}/status.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatusFile {
    pub task_id: String,
    pub status: String,
    pub completed_at: String,
    pub error_message: Option<String>,
}

/// Result file written by the subagent.
///
/// Located at `jobs/{task_id}/result.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskResultFile {
    pub task_id: String,
    pub result: serde_json::Value,
    pub summary: Option<String>,
}

/// Heartbeat file written by the orchestrator each poll cycle.
///
/// Located at `jobs/heartbeat.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatFile {
    pub timestamp: String,
    pub cycle: u32,
    pub active_tasks: Vec<String>,
    pub completed_tasks: Vec<String>,
}

/// Validate a task ID to prevent path traversal.
pub(crate) fn validate_task_id(task_id: &str) -> crate::error::Result<()> {
    if task_id.is_empty()
        || task_id.contains('/')
        || task_id.contains('\\')
        || task_id.contains("..")
        || task_id == "."
    {
        return Err(crate::error::OrchestratorError::Task(format!(
            "Invalid task ID (potential path traversal): {task_id}"
        )));
    }
    Ok(())
}

/// Write a context.md file for a task.
pub fn write_context_file(
    jobs_dir: &std::path::Path,
    task_id: &str,
    content: &str,
) -> crate::error::Result<std::path::PathBuf> {
    validate_task_id(task_id)?;
    let task_dir = jobs_dir.join(task_id);
    std::fs::create_dir_all(&task_dir)?;
    let path = task_dir.join("context.md");
    std::fs::write(&path, content)?;
    Ok(path)
}

/// Read a result.json file if it exists.
pub fn read_result_file(
    jobs_dir: &std::path::Path,
    task_id: &str,
) -> crate::error::Result<Option<TaskResultFile>> {
    validate_task_id(task_id)?;
    let path = jobs_dir.join(task_id).join("result.json");
    crate::json_io::atomic_json_read_opt(&path)
}

/// Read a status.json file if it exists.
pub fn read_status_file(
    jobs_dir: &std::path::Path,
    task_id: &str,
) -> crate::error::Result<Option<TaskStatusFile>> {
    validate_task_id(task_id)?;
    let path = jobs_dir.join(task_id).join("status.json");
    crate::json_io::atomic_json_read_opt(&path)
}

/// Read the heartbeat.json file if it exists.
pub fn read_heartbeat(
    jobs_dir: &std::path::Path,
) -> crate::error::Result<Option<HeartbeatFile>> {
    let path = jobs_dir.join("heartbeat.json");
    crate::json_io::atomic_json_read_opt(&path)
}

/// Check if a heartbeat is fresh (written within `max_age_secs` seconds).
pub fn is_heartbeat_fresh(
    jobs_dir: &std::path::Path,
    max_age_secs: u64,
) -> bool {
    let path = jobs_dir.join("heartbeat.json");
    match std::fs::metadata(&path) {
        Ok(meta) => {
            match meta.modified() {
                Ok(modified) => {
                    let age = modified.elapsed().unwrap_or_default();
                    age.as_secs() < max_age_secs
                }
                Err(_) => false,
            }
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_and_read_context() {
        let dir = TempDir::new().unwrap();
        let path = write_context_file(dir.path(), "task-001", "# Test\nHello").unwrap();
        assert!(path.exists());
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("Hello"));
    }

    #[test]
    fn read_missing_result_returns_none() {
        let dir = TempDir::new().unwrap();
        let result = read_result_file(dir.path(), "nonexistent").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn read_existing_result() {
        let dir = TempDir::new().unwrap();
        let task_dir = dir.path().join("task-001");
        std::fs::create_dir_all(&task_dir).unwrap();
        let result_file = TaskResultFile {
            task_id: "task-001".to_string(),
            result: serde_json::json!({"summary": "test"}),
            summary: Some("Test summary".to_string()),
        };
        crate::json_io::atomic_json_write(&task_dir.join("result.json"), &result_file).unwrap();
        let loaded = read_result_file(dir.path(), "task-001").unwrap().unwrap();
        assert_eq!(loaded.task_id, "task-001");
        assert_eq!(loaded.summary.as_deref(), Some("Test summary"));
    }

    #[test]
    fn heartbeat_freshness() {
        let dir = TempDir::new().unwrap();
        // No heartbeat → not fresh
        assert!(!is_heartbeat_fresh(dir.path(), 60));

        // Write heartbeat
        let hb = HeartbeatFile {
            timestamp: chrono::Utc::now().to_rfc3339(),
            cycle: 1,
            active_tasks: vec![],
            completed_tasks: vec![],
        };
        crate::json_io::atomic_json_write(&dir.path().join("heartbeat.json"), &hb).unwrap();
        assert!(is_heartbeat_fresh(dir.path(), 60));
        assert!(is_heartbeat_fresh(dir.path(), 1)); // Just written
    }
}
