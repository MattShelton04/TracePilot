//! Result monitoring — scans the jobs directory for completed tasks and
//! ingests results into the task DB.

use crate::error::Result;
use crate::task_db::types::{TaskResult, TaskStatus};
use crate::task_ipc::protocol;
use std::path::Path;

/// Scan result for a single task.
#[derive(Debug)]
pub struct IngestResult {
    pub task_id: String,
    pub status: TaskStatus,
    pub ingested: bool,
    pub error: Option<String>,
    pub result_summary: Option<String>,
    pub result_parsed: Option<serde_json::Value>,
}

/// Scan the jobs directory for completed tasks and build `TaskResult` values
/// ready to be stored in the DB.
///
/// Returns one `IngestResult` per task that has a `status.json` file.
pub fn scan_completed_tasks(
    jobs_dir: &Path,
    task_ids: &[String],
) -> Vec<IngestResult> {
    let mut results = Vec::new();

    for task_id in task_ids {
        // Check status.json first (completion trigger)
        let status_file = match protocol::read_status_file(jobs_dir, task_id) {
            Ok(Some(sf)) => sf,
            Ok(None) => continue, // Not completed yet
            Err(e) => {
                results.push(IngestResult {
                    task_id: task_id.clone(),
                    status: TaskStatus::Failed,
                    ingested: false,
                    error: Some(format!("Failed to read status.json: {}", e)),
                    result_summary: None,
                    result_parsed: None,
                });
                continue;
            }
        };

        // Parse result.json if present
        let result_file = match protocol::read_result_file(jobs_dir, task_id) {
            Ok(rf) => rf,
            Err(e) => {
                tracing::warn!(task_id = %task_id, error = %e, "Failed to read result.json");
                None
            }
        };

        let task_status = match status_file.status.as_str() {
            "done" | "completed" => TaskStatus::Done,
            "failed" => TaskStatus::Failed,
            _ => TaskStatus::Failed,
        };

        results.push(IngestResult {
            task_id: task_id.clone(),
            status: task_status,
            ingested: true,
            error: status_file.error_message.clone(),
            result_summary: result_file.as_ref().and_then(|rf| rf.summary.clone()),
            result_parsed: result_file.as_ref().map(|rf| rf.result.clone()),
        });
    }

    results
}

/// Ingest all completed results into the task DB.
///
/// Reads status.json + result.json for each task, then calls
/// `store_task_result` on the DB connection.
pub fn ingest_results(
    conn: &rusqlite::Connection,
    jobs_dir: &Path,
    task_ids: &[String],
) -> Result<Vec<IngestResult>> {
    let mut results = Vec::new();

    for task_id in task_ids {
        let status_file = match protocol::read_status_file(jobs_dir, task_id) {
            Ok(Some(sf)) => sf,
            Ok(None) => continue,
            Err(e) => {
                results.push(IngestResult {
                    task_id: task_id.clone(),
                    status: TaskStatus::Failed,
                    ingested: false,
                    error: Some(format!("Failed to read status.json: {}", e)),
                    result_summary: None,
                    result_parsed: None,
                });
                continue;
            }
        };

        let result_file = protocol::read_result_file(jobs_dir, task_id).ok().flatten();

        let task_status = match status_file.status.as_str() {
            "done" | "completed" => TaskStatus::Done,
            "failed" => TaskStatus::Failed,
            _ => TaskStatus::Failed,
        };

        let task_result = TaskResult {
            task_id: task_id.clone(),
            status: task_status,
            result_summary: result_file.as_ref().and_then(|rf| rf.summary.clone()),
            result_parsed: result_file.map(|rf| rf.result),
            schema_valid: None,
            error_message: status_file.error_message,
        };

        match crate::task_db::operations::store_task_result(conn, &task_result) {
            Ok(()) => {
                tracing::info!(task_id = %task_id, status = %task_status, "Task result ingested");
                results.push(IngestResult {
                    task_id: task_id.clone(),
                    status: task_status,
                    ingested: true,
                    error: None,
                    result_summary: task_result.result_summary.clone(),
                    result_parsed: task_result.result_parsed.clone(),
                });
            }
            Err(e) => {
                tracing::error!(task_id = %task_id, error = %e, "Failed to store task result");
                results.push(IngestResult {
                    task_id: task_id.clone(),
                    status: task_status,
                    ingested: false,
                    error: Some(format!("DB store failed: {}", e)),
                    result_summary: None,
                    result_parsed: None,
                });
            }
        }
    }

    Ok(results)
}

/// Clean up job files for completed tasks.
pub fn cleanup_task_files(jobs_dir: &Path, task_id: &str) -> Result<()> {
    let task_dir = jobs_dir.join(task_id);
    if task_dir.exists() {
        std::fs::remove_dir_all(&task_dir)?;
        tracing::debug!(task_id = %task_id, "Cleaned up task files");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_ipc::protocol::{TaskResultFile, TaskStatusFile};
    use tempfile::TempDir;

    fn write_status(dir: &Path, task_id: &str, status: &str) {
        let task_dir = dir.join(task_id);
        std::fs::create_dir_all(&task_dir).unwrap();
        let sf = TaskStatusFile {
            task_id: task_id.to_string(),
            status: status.to_string(),
            completed_at: "2026-01-01T00:00:00Z".to_string(),
            error_message: None,
        };
        crate::json_io::atomic_json_write(&task_dir.join("status.json"), &sf).unwrap();
    }

    fn write_result(dir: &Path, task_id: &str) {
        let task_dir = dir.join(task_id);
        std::fs::create_dir_all(&task_dir).unwrap();
        let rf = TaskResultFile {
            task_id: task_id.to_string(),
            result: serde_json::json!({"output": "test"}),
            summary: Some("Test result".to_string()),
        };
        crate::json_io::atomic_json_write(&task_dir.join("result.json"), &rf).unwrap();
    }

    #[test]
    fn scan_finds_completed_tasks() {
        let dir = TempDir::new().unwrap();
        let ids = vec!["task-001".to_string(), "task-002".to_string(), "task-003".to_string()];

        // task-001: completed with result
        write_status(dir.path(), "task-001", "done");
        write_result(dir.path(), "task-001");

        // task-002: not completed (no status.json)

        // task-003: failed
        write_status(dir.path(), "task-003", "failed");

        let results = scan_completed_tasks(dir.path(), &ids);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].task_id, "task-001");
        assert_eq!(results[0].status, TaskStatus::Done);
        assert!(results[0].ingested);
        assert_eq!(results[1].task_id, "task-003");
        assert_eq!(results[1].status, TaskStatus::Failed);
    }

    #[test]
    fn cleanup_removes_task_dir() {
        let dir = TempDir::new().unwrap();
        let task_dir = dir.path().join("task-001");
        std::fs::create_dir_all(&task_dir).unwrap();
        std::fs::write(task_dir.join("context.md"), "test").unwrap();

        cleanup_task_files(dir.path(), "task-001").unwrap();
        assert!(!task_dir.exists());
    }
}
