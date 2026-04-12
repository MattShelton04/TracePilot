//! Shared helpers for the task command modules.
//!
//! Contains composable building blocks for manifest hot-add operations,
//! model resolution, and fallback context generation.  Extracted from the
//! original monolithic `tasks.rs` to eliminate three near-identical copies
//! of the hot-add pattern.

use std::path::Path;

use crate::error::BindingsError;
use tracepilot_orchestrator::task_db::types::Task;

// ── Model resolution ──────────────────────────────────────────────────────

/// Resolve the effective model for a task by checking the preset's
/// `model_override` first, falling back to `default_model`.
///
/// This centralises the model-resolution pattern used whenever a task
/// needs to be hot-added or retried into a running orchestrator manifest.
pub(super) fn resolve_task_model(
    presets_dir: &Path,
    preset_id: &str,
    default_model: &str,
) -> String {
    tracepilot_orchestrator::presets::io::get_preset(presets_dir, preset_id)
        .ok()
        .and_then(|p| p.execution.model_override.clone())
        .unwrap_or_else(|| default_model.to_string())
}

// ── Context generation ────────────────────────────────────────────────────

/// Build minimal context when preset loading or full assembly fails.
pub(super) fn fallback_context(task: &Task, result_path: &str) -> String {
    format!(
        "# Task: {}\n\n**Type:** {}\n**Preset:** {}\n\n\
         ## Input Parameters\n\n```json\n{}\n```\n\n\
         ## Output Format\n\nWrite your result as valid JSON to: `{}`\n\
         Use atomic write: write to `.tmp` then rename.\n",
        task.id,
        task.task_type,
        task.preset_id,
        serde_json::to_string_pretty(&task.input_params).unwrap_or_default(),
        result_path,
    )
}

// ── Manifest building blocks ──────────────────────────────────────────────

/// Create the job directory for a task, returning the path.
///
/// Silently succeeds if the directory already exists.
pub(super) fn ensure_task_job_dir(
    jobs_dir: &Path,
    task_id: &str,
) -> Result<std::path::PathBuf, BindingsError> {
    let task_dir = jobs_dir.join(task_id);
    std::fs::create_dir_all(&task_dir)?;
    Ok(task_dir)
}

/// Write the assembled context to the task's job directory.
pub(super) fn write_task_context(
    task_dir: &Path,
    content: &str,
) -> Result<(), BindingsError> {
    let context_path = task_dir.join("context.md");
    std::fs::write(&context_path, content)?;
    Ok(())
}

/// Build a [`ManifestTask`] and append it to the manifest file.
///
/// This is the core building block shared by all hot-add call sites.
/// Callers are responsible for acquiring any necessary locks (e.g.
/// `manifest_lock`) before calling this function.
pub(super) fn build_and_append_manifest_task(
    task: &Task,
    model: &str,
    jobs_dir: &Path,
    manifest_path: &Path,
) -> Result<(), BindingsError> {
    let manifest_task =
        tracepilot_orchestrator::task_orchestrator::manifest::ManifestTask::from_task(
            task, model, jobs_dir,
        );
    tracepilot_orchestrator::task_orchestrator::manifest::append_task_to_manifest(
        manifest_path,
        &manifest_task,
    )
    .map_err(BindingsError::Orchestrator)
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_task(id: &str, preset_id: &str) -> Task {
        Task {
            id: id.to_string(),
            task_type: "test_type".to_string(),
            preset_id: preset_id.to_string(),
            input_params: serde_json::json!({"key": "value"}),
            priority: "normal".to_string(),
            status: tracepilot_orchestrator::task_db::types::TaskStatus::Pending,
            max_retries: 0,
            attempt_count: 0,
            result_summary: None,
            result_parsed: None,
            schema_valid: None,
            error_message: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            completed_at: None,
            claimed_at: None,
            started_at: None,
            job_id: None,
            orchestrator_session_id: None,
            context_hash: None,
        }
    }

    #[test]
    fn fallback_context_includes_task_fields() {
        let task = make_test_task("task-123", "my-preset");
        let ctx = fallback_context(&task, "/tmp/result.json");

        assert!(ctx.contains("# Task: task-123"));
        assert!(ctx.contains("**Type:** test_type"));
        assert!(ctx.contains("**Preset:** my-preset"));
        assert!(ctx.contains("/tmp/result.json"));
        assert!(ctx.contains("\"key\": \"value\""));
    }

    #[test]
    fn fallback_context_handles_complex_params() {
        let mut task = make_test_task("task-456", "preset-2");
        task.input_params = serde_json::json!({"nested": {"a": 1}, "list": [1, 2, 3]});
        let ctx = fallback_context(&task, "/out/result.json");

        assert!(ctx.contains("\"nested\""));
        assert!(ctx.contains("\"list\""));
    }

    #[test]
    fn resolve_task_model_falls_back_to_default() {
        // Non-existent presets_dir → preset lookup fails → returns default
        let model = resolve_task_model(
            std::path::Path::new("/nonexistent/presets"),
            "missing-preset",
            "claude-haiku-4.5",
        );
        assert_eq!(model, "claude-haiku-4.5");
    }

    #[test]
    fn ensure_task_job_dir_creates_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let result = ensure_task_job_dir(tmp.path(), "test-task-id");
        assert!(result.is_ok());
        let dir = result.unwrap();
        assert!(dir.is_dir());
        assert_eq!(dir.file_name().unwrap(), "test-task-id");
    }

    #[test]
    fn ensure_task_job_dir_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        ensure_task_job_dir(tmp.path(), "task-1").unwrap();
        let result = ensure_task_job_dir(tmp.path(), "task-1");
        assert!(result.is_ok());
    }

    #[test]
    fn write_task_context_creates_file() {
        let tmp = tempfile::tempdir().unwrap();
        let task_dir = tmp.path().join("my-task");
        std::fs::create_dir_all(&task_dir).unwrap();

        write_task_context(&task_dir, "Hello, context!").unwrap();

        let content = std::fs::read_to_string(task_dir.join("context.md")).unwrap();
        assert_eq!(content, "Hello, context!");
    }
}
