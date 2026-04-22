//! Task result ingestion and attribution snapshot.

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{get_or_init_task_db, mutex_poisoned, read_config};
use crate::types::SharedTaskDb;

use super::resolve_task_model;

/// Scan the jobs directory for completed task results and ingest them into the DB.
/// Returns the number of tasks that were successfully ingested.
#[tauri::command]
pub async fn task_ingest_results(
    config: tauri::State<'_, SharedConfig>,
    task_db: tauri::State<'_, SharedTaskDb>,
    orch_state: tauri::State<'_, crate::types::SharedOrchestratorState>,
    manifest_lock: tauri::State<'_, crate::types::ManifestLock>,
) -> CmdResult<u32> {
    let cfg = read_config(&config);
    let jobs_dir = cfg.jobs_dir();
    let presets_dir = cfg.presets_dir();
    let default_subagent_model = cfg.tasks.default_subagent_model.clone();
    let db = get_or_init_task_db(&task_db)?;
    let orch_state_clone = std::sync::Arc::clone(&*orch_state);
    let manifest_lock_clone = std::sync::Arc::clone(&*manifest_lock);

    tokio::task::spawn_blocking(move || {
        // Phase 1: Quick lock to collect task IDs
        let task_ids = {
            let db_guard = db
                .lock()
                .map_err(|_| mutex_poisoned())?;
            let task_db = db_guard
                .as_ref()
                .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;

            let pending_filter = tracepilot_orchestrator::task_db::types::TaskFilter {
                status: Some(tracepilot_orchestrator::task_db::types::TaskStatus::Pending),
                ..Default::default()
            };
            let in_progress_filter = tracepilot_orchestrator::task_db::types::TaskFilter {
                status: Some(tracepilot_orchestrator::task_db::types::TaskStatus::InProgress),
                ..Default::default()
            };

            let mut ids: Vec<String> = Vec::new();
            if let Ok(tasks) = tracepilot_orchestrator::task_db::operations::list_tasks(
                task_db.conn(),
                &pending_filter,
            ) {
                ids.extend(tasks.into_iter().map(|t| t.id));
            }
            if let Ok(tasks) = tracepilot_orchestrator::task_db::operations::list_tasks(
                task_db.conn(),
                &in_progress_filter,
            ) {
                ids.extend(tasks.into_iter().map(|t| t.id));
            }
            ids
        }; // db_guard dropped — DB is free for other operations

        if task_ids.is_empty() {
            return Ok(0);
        }

        // Phase 2: File I/O without holding the DB lock
        let scan_results =
            tracepilot_orchestrator::task_ipc::scan_completed_tasks(&jobs_dir, &task_ids);

        let actionable: Vec<_> = scan_results.into_iter().filter(|r| r.ingested).collect();
        if actionable.is_empty() {
            return Ok(0);
        }

        // Phase 3: Re-acquire lock for DB writes only
        let db_guard = db
            .lock()
            .map_err(|_| mutex_poisoned())?;
        let task_db = db_guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;

        let mut ingested_count = 0u32;
        let mut retried_ids: Vec<String> = Vec::new();
        for result in &actionable {
            let task_result = tracepilot_orchestrator::task_db::types::TaskResult {
                task_id: result.task_id.clone(),
                status: result.status,
                result_summary: result.result_summary.clone(),
                result_parsed: result.result_parsed.clone(),
                schema_valid: None,
                error_message: result.error.clone(),
            };
            match tracepilot_orchestrator::task_db::operations::store_task_result(
                task_db.conn(),
                &task_result,
            ) {
                Ok(()) => {
                    ingested_count += 1;

                    // Auto-retry: if the task failed and has retries remaining,
                    // reset it to pending so the orchestrator picks it up again.
                    if result.status == tracepilot_orchestrator::task_db::types::TaskStatus::Failed {
                        if let Ok(task) = tracepilot_orchestrator::task_db::operations::get_task(
                            task_db.conn(),
                            &result.task_id,
                        ) {
                            if task.attempt_count < task.max_retries {
                                match tracepilot_orchestrator::task_db::operations::retry_task(
                                    task_db.conn(),
                                    &result.task_id,
                                ) {
                                    Ok(()) => {
                                        retried_ids.push(result.task_id.clone());
                                        tracing::info!(
                                            task_id = %result.task_id,
                                            attempt = task.attempt_count + 1,
                                            max = task.max_retries,
                                            "Auto-retrying failed task"
                                        );
                                    }
                                    Err(e) => {
                                        tracing::warn!(
                                            task_id = %result.task_id,
                                            error = %e,
                                            "Auto-retry failed"
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(task_id = %result.task_id, error = %e, "Failed to store task result");
                }
            }
        }

        // Hot-add retried tasks back to the manifest so the orchestrator picks them up
        if !retried_ids.is_empty() {
            if let Ok(orch_guard) = orch_state_clone.lock() {
                if let Some(handle) = orch_guard.as_ref() {
                    let manifest_path = std::path::PathBuf::from(&handle.manifest_path);
                    if manifest_path.exists() {
                        // Serialize manifest writes to prevent TOCTOU races
                        let _manifest_guard = manifest_lock_clone.lock()
                            .map_err(|_| mutex_poisoned())?;

                        for retry_id in &retried_ids {
                            // Re-read the task to get current state
                            if let Ok(task) = tracepilot_orchestrator::task_db::operations::get_task(
                                task_db.conn(),
                                retry_id,
                            ) {
                                let task_dir = jobs_dir.join(&task.id);

                                // Clean up old result/status files so the orchestrator
                                // treats it as a fresh task (best-effort: missing-file is fine).
                                let _: std::io::Result<()> = std::fs::remove_file(task_dir.join("result.json"));
                                let _: std::io::Result<()> = std::fs::remove_file(task_dir.join("status.json"));

                                let manifest_task = tracepilot_orchestrator::task_orchestrator::manifest::ManifestTask::from_task(
                                    &task,
                                    &resolve_task_model(
                                        &presets_dir,
                                        &tracepilot_core::ids::PresetId::from_validated(&task.preset_id),
                                        &default_subagent_model,
                                    ),
                                    &jobs_dir,
                                );

                                if let Err(e) = tracepilot_orchestrator::task_orchestrator::manifest::append_task_to_manifest(
                                    &manifest_path,
                                    &manifest_task,
                                ) {
                                    tracing::warn!(task_id = %task.id, error = %e, "Failed to re-add retried task to manifest");
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(ingested_count)
    })
    .await?
}

#[tauri::command]
pub async fn task_attribution(
    config: tauri::State<'_, SharedConfig>,
    session_path: String,
) -> CmdResult<tracepilot_orchestrator::task_attribution::AttributionSnapshot> {
    // Validate that the path is within the session state directory to prevent
    // arbitrary file system reads via path traversal.
    let cfg = read_config(&config);
    let session_state_dir = cfg.session_state_dir();
    let path = std::path::PathBuf::from(&session_path);
    let canonical_path = path
        .canonicalize()
        .map_err(|e| BindingsError::Validation(format!("Invalid session path: {e}")))?;
    let canonical_state = session_state_dir
        .canonicalize()
        .unwrap_or_else(|_| session_state_dir.clone());
    if !canonical_path.starts_with(&canonical_state) {
        return Err(BindingsError::Validation(
            "Session path must be within the session state directory".into(),
        ));
    }

    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::task_attribution::build_attribution_from_session(&canonical_path)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}
