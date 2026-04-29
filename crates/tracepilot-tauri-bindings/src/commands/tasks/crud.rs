//! Task CRUD commands: create, list, get, update, delete, stats.

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{mutex_poisoned, read_config, with_task_db};
use crate::types::SharedTaskDb;
use tracepilot_orchestrator::task_db::types::*;

use super::fallback_context;

#[tauri::command]
#[tracing::instrument(skip_all, err, fields(%preset_id, %task_type))]
// Tauri command signatures are fixed by the IPC contract (state handles +
// user params); compressing into a struct would be a breaking API change.
#[allow(clippy::too_many_arguments)]
pub async fn task_create(
    state: tauri::State<'_, SharedTaskDb>,
    config: tauri::State<'_, SharedConfig>,
    orch_state: tauri::State<'_, crate::types::SharedOrchestratorState>,
    manifest_lock: tauri::State<'_, crate::types::ManifestLock>,
    task_type: String,
    preset_id: String,
    input_params: serde_json::Value,
    priority: Option<String>,
    max_retries: Option<i32>,
) -> CmdResult<Task> {
    crate::validators::validate_preset_id(&preset_id)?;
    let cfg = read_config(&config);
    let orch_state_clone = std::sync::Arc::clone(&*orch_state);
    let manifest_lock_clone = std::sync::Arc::clone(&*manifest_lock);

    let jobs_dir = cfg.jobs_dir();
    let presets_dir = cfg.presets_dir();
    let session_state_dir = cfg.session_state_dir();
    let default_model = cfg.tasks.default_subagent_model.clone();

    with_task_db(&state, &config, move |db| {
        let new_task = NewTask {
            task_type,
            preset_id,
            priority,
            input_params,
            max_retries,
        };
        let task = tracepilot_orchestrator::task_db::operations::create_task(db.conn(), &new_task)
            .map_err(BindingsError::Orchestrator)?;

        // If orchestrator is running, hot-add this task to the manifest so it
        // gets picked up on the next poll cycle without requiring a restart.
        if let Ok(orch_guard) = orch_state_clone.lock()
            && let Some(handle) = orch_guard.as_ref()
        {
            let manifest_path = std::path::PathBuf::from(&handle.manifest_path);
                if manifest_path.exists() {
                    let task_dir = jobs_dir.join(&task.id);
                    if let Err(e) = std::fs::create_dir_all(&task_dir) {
                        tracing::warn!(task_id = %task.id, path = %task_dir.display(), error = %e, "Failed to create hot-add task dir");
                        return Ok(task);
                    }

                    // Assemble context file for the new task
                    let result_file = task_dir.join("result.json");
                    let result_path = result_file.to_string_lossy().to_string();

                    let (content, resolved_model) = match tracepilot_orchestrator::presets::io::get_preset(
                        &presets_dir,
                        &tracepilot_core::ids::PresetId::from_validated(&task.preset_id),
                    ) {
                        Ok(preset) => {
                            let model = preset.execution.model_override.clone()
                                .unwrap_or_else(|| default_model.clone());
                            match tracepilot_orchestrator::task_context::assemble_task_context(
                                &preset,
                                &task.input_params,
                                &session_state_dir,
                                preset.context.max_chars,
                                &result_path,
                            ) {
                                Ok(assembled) => (assembled.content, model),
                                Err(_) => (fallback_context(&task, &result_path), model),
                            }
                        }
                        Err(_) => (fallback_context(&task, &result_path), default_model.clone()),
                    };

                    let context_path = task_dir.join("context.md");
                    if let Err(e) = std::fs::write(&context_path, &content) {
                        tracing::warn!(task_id = %task.id, error = %e, "Failed to write hot-add context.md");
                    }

                    let manifest_task = tracepilot_orchestrator::task_orchestrator::manifest::ManifestTask::from_task(
                        &task, &resolved_model, &jobs_dir,
                    );

                    // Serialize manifest writes to prevent TOCTOU races
                    let _manifest_guard = manifest_lock_clone.lock()
                        .map_err(|_| mutex_poisoned())?;

                    if let Err(e) = tracepilot_orchestrator::task_orchestrator::manifest::append_task_to_manifest(
                        &manifest_path,
                        &manifest_task,
                    ) {
                        tracing::warn!(task_id = %task.id, error = %e, "Failed to hot-add task to manifest");
                    } else {
                        // Mark task as in_progress and bind to the running orchestrator session
                        if let Err(e) = tracepilot_orchestrator::task_db::operations::update_task_status(
                            db.conn(),
                            &task.id,
                            tracepilot_orchestrator::task_db::types::TaskStatus::InProgress,
                        ) {
                            tracing::warn!(task_id = %task.id, error = %e, "Failed to mark hot-added task in_progress");
                        }
                        if let Some(ref sid) = handle.session_uuid
                            && let Err(e) = tracepilot_orchestrator::task_db::operations::set_orchestrator_session_id(
                                db.conn(),
                                &tracepilot_core::ids::SessionId::from_validated(sid.clone()),
                            )
                        {
                            tracing::warn!(task_id = %task.id, error = %e, "Failed to bind orchestrator session id");
                        }
                        tracing::info!(task_id = %task.id, "Hot-added task to running orchestrator manifest");
                    }
                }
            }

        Ok(task)
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, err, fields(%job_name, task_count = tasks.len()))]
pub async fn task_create_batch(
    state: tauri::State<'_, SharedTaskDb>,
    config: tauri::State<'_, SharedConfig>,
    tasks: Vec<NewTask>,
    job_name: String,
    preset_id: Option<String>,
) -> CmdResult<Job> {
    if let Some(ref id) = preset_id {
        crate::validators::validate_preset_id(id)?;
    }
    for task in &tasks {
        crate::validators::validate_preset_id(&task.preset_id)?;
    }
    with_task_db(&state, &config, move |db| {
        tracepilot_orchestrator::task_db::operations::create_task_batch(
            db.conn(),
            &tasks,
            &job_name,
            preset_id.as_deref(),
        )
        .map_err(BindingsError::Orchestrator)
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(task_id = %id))]
pub async fn task_get(
    state: tauri::State<'_, SharedTaskDb>,
    config: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<Task> {
    crate::validators::validate_task_id(&id)?;
    with_task_db(&state, &config, move |db| {
        tracepilot_orchestrator::task_db::operations::get_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn task_list(
    state: tauri::State<'_, SharedTaskDb>,
    config: tauri::State<'_, SharedConfig>,
    filter: Option<TaskFilter>,
) -> CmdResult<Vec<Task>> {
    let f = filter.unwrap_or_default();
    with_task_db(&state, &config, move |db| {
        tracepilot_orchestrator::task_db::operations::list_tasks(db.conn(), &f)
            .map_err(BindingsError::Orchestrator)
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(task_id = %id))]
pub async fn task_cancel(
    state: tauri::State<'_, SharedTaskDb>,
    config: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<()> {
    crate::validators::validate_task_id(&id)?;
    with_task_db(&state, &config, move |db| {
        tracepilot_orchestrator::task_db::operations::cancel_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(task_id = %id))]
pub async fn task_retry(
    state: tauri::State<'_, SharedTaskDb>,
    config: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<()> {
    crate::validators::validate_task_id(&id)?;
    with_task_db(&state, &config, move |db| {
        tracepilot_orchestrator::task_db::operations::retry_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(task_id = %id))]
pub async fn task_delete(
    state: tauri::State<'_, SharedTaskDb>,
    config: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<()> {
    crate::validators::validate_task_id(&id)?;
    with_task_db(&state, &config, move |db| {
        tracepilot_orchestrator::task_db::operations::delete_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn task_stats(
    state: tauri::State<'_, SharedTaskDb>,
    config: tauri::State<'_, SharedConfig>,
) -> CmdResult<TaskStats> {
    with_task_db(&state, &config, move |db| {
        tracepilot_orchestrator::task_db::operations::get_task_stats(db.conn())
            .map_err(BindingsError::Orchestrator)
    })
    .await
}
