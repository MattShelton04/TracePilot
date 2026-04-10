//! Task manifest generation and management.
//!
//! The manifest is the contract between the TracePilot app and the orchestrator
//! agent. The app writes it; the orchestrator reads it on each poll cycle.

use crate::error::{OrchestratorError, Result};
use crate::json_io;
use crate::task_db::Task;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Top-level manifest written to `jobs/manifest.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskManifest {
    pub version: u32,
    pub poll_interval_seconds: u32,
    pub max_parallel: u32,
    pub shutdown: bool,
    pub tasks: Vec<ManifestTask>,
}

/// A single task entry in the manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestTask {
    pub id: String,
    #[serde(rename = "type")]
    pub task_type: String,
    pub title: String,
    pub context_file: String,
    pub result_file: String,
    pub status_file: String,
    pub model: String,
    pub priority: String,
}

impl ManifestTask {
    /// Build a `ManifestTask` from a database [`Task`], its resolved model,
    /// and the jobs directory root.
    ///
    /// This is the single source of truth for mapping a `Task` into the
    /// manifest representation the orchestrator reads.  All hot-add, retry,
    /// and initial-manifest code paths should use this constructor to avoid
    /// divergence.
    pub fn from_task(task: &Task, model: &str, jobs_dir: &Path) -> Self {
        let task_dir = jobs_dir.join(&task.id);
        let title = task
            .input_params
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(&task.task_type)
            .to_string();
        Self {
            id: task.id.clone(),
            task_type: task.task_type.clone(),
            title,
            context_file: task_dir
                .join("context.md")
                .to_string_lossy()
                .to_string(),
            result_file: task_dir
                .join("result.json")
                .to_string_lossy()
                .to_string(),
            status_file: task_dir
                .join("status.json")
                .to_string_lossy()
                .to_string(),
            model: model.to_string(),
            priority: task.priority.clone(),
        }
    }
}

/// Input for manifest generation: a task paired with its resolved model.
pub struct ManifestInput<'a> {
    pub task: &'a Task,
    pub model: String,
}

/// Generate a manifest from pending tasks.
///
/// File paths are absolute so the orchestrator agent can find them regardless
/// of its working directory.
pub fn generate_manifest(
    inputs: &[ManifestInput<'_>],
    jobs_dir: &Path,
    poll_interval: u32,
    max_parallel: u32,
) -> TaskManifest {
    let tasks = inputs
        .iter()
        .map(|input| ManifestTask::from_task(input.task, &input.model, jobs_dir))
        .collect();

    TaskManifest {
        version: 1,
        poll_interval_seconds: poll_interval,
        max_parallel,
        shutdown: false,
        tasks,
    }
}

/// Write the manifest to disk atomically (write to .tmp, then rename).
pub fn write_manifest(manifest: &TaskManifest, path: &Path) -> Result<()> {
    json_io::atomic_json_write(path, manifest)
}

/// Update the manifest to signal shutdown.
///
/// Reads the existing manifest, sets `shutdown: true`, and writes it back.
pub fn update_manifest_shutdown(path: &Path) -> Result<()> {
    let mut manifest: TaskManifest = json_io::atomic_json_read_opt(path)?
        .ok_or_else(|| OrchestratorError::Task(
            "Cannot shutdown: manifest file does not exist".into(),
        ))?;
    manifest.shutdown = true;
    json_io::atomic_json_write(path, &manifest)
}

/// Append a new task entry to an existing manifest on disk.
///
/// This allows dynamically adding tasks to a running orchestrator — the
/// orchestrator re-reads the manifest each poll cycle, so appended tasks
/// will be picked up automatically.
pub fn append_task_to_manifest(
    path: &Path,
    task: &ManifestTask,
) -> Result<()> {
    let mut manifest: TaskManifest = json_io::atomic_json_read_opt(path)?
        .ok_or_else(|| OrchestratorError::Task(
            "Cannot append: manifest file does not exist".into(),
        ))?;
    // Avoid duplicate entries
    if !manifest.tasks.iter().any(|t| t.id == task.id) {
        manifest.tasks.push(task.clone());
    }
    json_io::atomic_json_write(path, &manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_db::{Task, TaskStatus};
    use tempfile::TempDir;

    fn sample_task(id: &str, priority: &str) -> Task {
        Task {
            id: id.to_string(),
            job_id: None,
            task_type: "session_summary".to_string(),
            preset_id: "summary".to_string(),
            status: TaskStatus::Pending,
            priority: priority.to_string(),
            input_params: serde_json::json!({ "title": format!("Task {}", id) }),
            context_hash: None,
            attempt_count: 0,
            max_retries: 3,
            orchestrator_session_id: None,
            result_summary: None,
            result_parsed: None,
            schema_valid: None,
            error_message: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            completed_at: None,
            claimed_at: None,
            started_at: None,
        }
    }

    #[test]
    fn from_task_populates_all_fields() {
        let dir = TempDir::new().unwrap();
        let task = sample_task("task-abc", "high");
        let mt = ManifestTask::from_task(&task, "claude-haiku-4.5", dir.path());

        assert_eq!(mt.id, "task-abc");
        assert_eq!(mt.task_type, "session_summary");
        assert_eq!(mt.title, "Task task-abc");
        assert_eq!(mt.model, "claude-haiku-4.5");
        assert_eq!(mt.priority, "high");
        assert!(mt.context_file.contains("task-abc"));
        assert!(mt.context_file.ends_with("context.md"));
        assert!(mt.result_file.contains("task-abc"));
        assert!(mt.result_file.ends_with("result.json"));
        assert!(mt.status_file.contains("task-abc"));
        assert!(mt.status_file.ends_with("status.json"));
    }

    #[test]
    fn from_task_title_falls_back_to_task_type() {
        let dir = TempDir::new().unwrap();
        let mut task = sample_task("task-no-title", "normal");
        task.input_params = serde_json::json!({ "foo": "bar" });

        let mt = ManifestTask::from_task(&task, "gpt-5.4", dir.path());
        assert_eq!(mt.title, "session_summary", "should fall back to task_type");
    }

    #[test]
    fn from_task_title_falls_back_when_title_is_not_string() {
        let dir = TempDir::new().unwrap();
        let mut task = sample_task("task-numeric-title", "normal");
        task.input_params = serde_json::json!({ "title": 42 });

        let mt = ManifestTask::from_task(&task, "gpt-5.4", dir.path());
        assert_eq!(mt.title, "session_summary", "non-string title falls back to task_type");
    }

    #[test]
    fn from_task_matches_generate_manifest_output() {
        let dir = TempDir::new().unwrap();
        let task = sample_task("task-cross", "normal");
        let inputs = vec![ManifestInput {
            task: &task,
            model: "claude-haiku-4.5".to_string(),
        }];
        let manifest = generate_manifest(&inputs, dir.path(), 30, 3);
        let from_task = ManifestTask::from_task(&task, "claude-haiku-4.5", dir.path());

        assert_eq!(&manifest.tasks[0], &from_task);
    }

    #[test]
    fn generate_manifest_creates_correct_entries() {
        let dir = TempDir::new().unwrap();
        let t1 = sample_task("task-001", "high");
        let t2 = sample_task("task-002", "normal");
        let inputs = vec![
            ManifestInput { task: &t1, model: "claude-haiku-4.5".to_string() },
            ManifestInput { task: &t2, model: "claude-haiku-4.5".to_string() },
        ];
        let manifest = generate_manifest(&inputs, dir.path(), 30, 3);

        assert_eq!(manifest.version, 1);
        assert_eq!(manifest.tasks.len(), 2);
        assert!(!manifest.shutdown);
        assert_eq!(manifest.tasks[0].id, "task-001");
        assert_eq!(manifest.tasks[0].title, "Task task-001");
        assert!(manifest.tasks[0].context_file.contains("task-001"));
        assert!(manifest.tasks[0].result_file.contains("result.json"));
    }

    #[test]
    fn write_and_read_manifest_roundtrip() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("manifest.json");
        let t1 = sample_task("task-001", "normal");
        let inputs = vec![
            ManifestInput { task: &t1, model: "claude-haiku-4.5".to_string() },
        ];
        let manifest = generate_manifest(&inputs, dir.path(), 30, 3);

        write_manifest(&manifest, &path).unwrap();
        let loaded: TaskManifest = json_io::atomic_json_read_opt(&path).unwrap().unwrap();
        assert_eq!(loaded.tasks.len(), 1);
        assert_eq!(loaded.tasks[0].id, "task-001");
        assert!(!loaded.shutdown);
    }

    #[test]
    fn shutdown_flag_updates() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("manifest.json");
        let manifest = generate_manifest(&[], dir.path(), 30, 3);
        write_manifest(&manifest, &path).unwrap();

        update_manifest_shutdown(&path).unwrap();
        let loaded: TaskManifest = json_io::atomic_json_read_opt(&path).unwrap().unwrap();
        assert!(loaded.shutdown);
    }

    #[test]
    fn append_task_to_manifest_adds_new_entry() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("manifest.json");
        let t1 = sample_task("task-001", "normal");
        let inputs = vec![
            ManifestInput { task: &t1, model: "claude-haiku-4.5".to_string() },
        ];
        let manifest = generate_manifest(&inputs, dir.path(), 30, 3);
        write_manifest(&manifest, &path).unwrap();

        let new_task = ManifestTask {
            id: "task-002".into(),
            task_type: "session_summary".into(),
            title: "New task".into(),
            context_file: "context.md".into(),
            result_file: "result.json".into(),
            status_file: "status.json".into(),
            model: "claude-haiku-4.5".into(),
            priority: "high".into(),
        };
        append_task_to_manifest(&path, &new_task).unwrap();

        let loaded: TaskManifest = json_io::atomic_json_read_opt(&path).unwrap().unwrap();
        assert_eq!(loaded.tasks.len(), 2);
        assert_eq!(loaded.tasks[1].id, "task-002");
    }

    #[test]
    fn append_task_deduplicates() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("manifest.json");
        let t1 = sample_task("task-001", "normal");
        let inputs = vec![
            ManifestInput { task: &t1, model: "claude-haiku-4.5".to_string() },
        ];
        let manifest = generate_manifest(&inputs, dir.path(), 30, 3);
        write_manifest(&manifest, &path).unwrap();

        let dup = ManifestTask {
            id: "task-001".into(),
            task_type: "session_summary".into(),
            title: "Duplicate".into(),
            context_file: "context.md".into(),
            result_file: "result.json".into(),
            status_file: "status.json".into(),
            model: "claude-haiku-4.5".into(),
            priority: "normal".into(),
        };
        append_task_to_manifest(&path, &dup).unwrap();

        let loaded: TaskManifest = json_io::atomic_json_read_opt(&path).unwrap().unwrap();
        assert_eq!(loaded.tasks.len(), 1);
    }
}
