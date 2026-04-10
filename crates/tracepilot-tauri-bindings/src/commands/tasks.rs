//! Tauri IPC commands for the AI agent task system.
//!
//! Commands for task CRUD, orchestrator lifecycle, health monitoring,
//! and result ingestion.

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{get_or_init_task_db, read_config};
use crate::types::SharedTaskDb;
use tracepilot_orchestrator::task_db::types::*;

// ─── Task CRUD ──────────────────────────────────────────────────────

#[tauri::command]
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
    let db = get_or_init_task_db(&state)?;
    let cfg = read_config(&config);
    let orch_state_clone = std::sync::Arc::clone(&*orch_state);
    let manifest_lock_clone = std::sync::Arc::clone(&*manifest_lock);

    let jobs_dir = cfg.jobs_dir();
    let presets_dir = cfg.presets_dir();
    let session_state_dir = cfg.session_state_dir();
    let default_model = cfg.tasks.default_subagent_model.clone();

    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
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
        if let Ok(orch_guard) = orch_state_clone.lock() {
            if let Some(handle) = orch_guard.as_ref() {
                let manifest_path = std::path::PathBuf::from(&handle.manifest_path);
                if manifest_path.exists() {
                    let task_dir = jobs_dir.join(&task.id);
                    let _ = std::fs::create_dir_all(&task_dir);

                    // Assemble context file for the new task
                    let result_file = task_dir.join("result.json");
                    let result_path = result_file.to_string_lossy().to_string();

                    let (content, resolved_model) = match tracepilot_orchestrator::presets::io::get_preset(
                        &presets_dir,
                        &task.preset_id,
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
                    let _ = std::fs::write(&context_path, &content);

                    let title = task.input_params
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&task.task_type)
                        .to_string();

                    let manifest_task = tracepilot_orchestrator::task_orchestrator::manifest::ManifestTask {
                        id: task.id.clone(),
                        task_type: task.task_type.clone(),
                        title,
                        context_file: context_path.to_string_lossy().to_string(),
                        result_file: result_path,
                        status_file: task_dir.join("status.json").to_string_lossy().to_string(),
                        model: resolved_model,
                        priority: task.priority.clone(),
                    };

                    // Serialize manifest writes to prevent TOCTOU races
                    let _manifest_guard = manifest_lock_clone.lock()
                        .map_err(|_| BindingsError::Validation("manifest lock poisoned".into()))?;

                    if let Err(e) = tracepilot_orchestrator::task_orchestrator::manifest::append_task_to_manifest(
                        &manifest_path,
                        &manifest_task,
                    ) {
                        tracing::warn!(task_id = %task.id, error = %e, "Failed to hot-add task to manifest");
                    } else {
                        // Mark task as in_progress and bind to the running orchestrator session
                        let _ = tracepilot_orchestrator::task_db::operations::update_task_status(
                            db.conn(),
                            &task.id,
                            tracepilot_orchestrator::task_db::types::TaskStatus::InProgress,
                        );
                        if let Some(ref sid) = handle.session_uuid {
                            let _ = tracepilot_orchestrator::task_db::operations::set_orchestrator_session_id(
                                db.conn(),
                                sid,
                            );
                        }
                        tracing::info!(task_id = %task.id, "Hot-added task to running orchestrator manifest");
                    }
                }
            }
        }

        Ok(task)
    })
    .await?
}

#[tauri::command]
pub async fn task_create_batch(
    state: tauri::State<'_, SharedTaskDb>,
    tasks: Vec<NewTask>,
    job_name: String,
    preset_id: Option<String>,
) -> CmdResult<Job> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::create_task_batch(
            db.conn(),
            &tasks,
            &job_name,
            preset_id.as_deref(),
        )
        .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_get(state: tauri::State<'_, SharedTaskDb>, id: String) -> CmdResult<Task> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::get_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_list(
    state: tauri::State<'_, SharedTaskDb>,
    filter: Option<TaskFilter>,
) -> CmdResult<Vec<Task>> {
    let db = get_or_init_task_db(&state)?;
    let f = filter.unwrap_or_default();
    tokio::task::spawn_blocking(move || {
        let guard = db
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::list_tasks(db.conn(), &f)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_cancel(state: tauri::State<'_, SharedTaskDb>, id: String) -> CmdResult<()> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::cancel_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_retry(state: tauri::State<'_, SharedTaskDb>, id: String) -> CmdResult<()> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::retry_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_delete(state: tauri::State<'_, SharedTaskDb>, id: String) -> CmdResult<()> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::delete_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_stats(state: tauri::State<'_, SharedTaskDb>) -> CmdResult<TaskStats> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::get_task_stats(db.conn())
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

// ─── Jobs ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn task_list_jobs(
    state: tauri::State<'_, SharedTaskDb>,
    limit: Option<i64>,
) -> CmdResult<Vec<Job>> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::list_jobs(db.conn(), limit)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_cancel_job(
    state: tauri::State<'_, SharedTaskDb>,
    job_id: String,
) -> CmdResult<()> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::cancel_job(db.conn(), &job_id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

// ─── Presets ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn task_list_presets(
    config: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<tracepilot_orchestrator::presets::types::TaskPreset>> {
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::list_presets(&presets_dir)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_get_preset(
    config: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<tracepilot_orchestrator::presets::types::TaskPreset> {
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::get_preset(&presets_dir, &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_save_preset(
    config: tauri::State<'_, SharedConfig>,
    preset: tracepilot_orchestrator::presets::types::TaskPreset,
) -> CmdResult<()> {
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::save_preset(&presets_dir, &preset)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_delete_preset(
    config: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<()> {
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::delete_preset(&presets_dir, &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

// ─── Orchestrator Lifecycle ─────────────────────────────────────────

#[tauri::command]
pub async fn task_orchestrator_health(
    config: tauri::State<'_, SharedConfig>,
    task_db: tauri::State<'_, SharedTaskDb>,
    orch_state: tauri::State<'_, crate::types::SharedOrchestratorState>,
) -> CmdResult<tracepilot_orchestrator::task_recovery::HealthCheckResult> {
    let cfg = read_config(&config);
    let jobs_dir = cfg.jobs_dir();
    let session_state_dir = cfg.session_state_dir();
    let orch_state_clone = std::sync::Arc::clone(&*orch_state);
    let db = std::sync::Arc::clone(&*task_db);
    let handle = orch_state
        .lock()
        .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?
        .clone();
    let stale_secs =
        (cfg.tasks.poll_interval_seconds * cfg.tasks.heartbeat_stale_multiplier) as u64;
    tokio::task::spawn_blocking(move || {
        // Attempt session UUID discovery if handle exists but UUID is unknown
        if let Some(ref h) = handle {
            if h.session_uuid.is_none() {
                if let Some(uuid) = tracepilot_orchestrator::task_orchestrator::discover_session_uuid(
                    &session_state_dir,
                    h.pid,
                    &h.launched_at,
                ) {
                    // Set orchestrator_session_id on active tasks
                    if let Ok(db_guard) = db.lock() {
                        if let Some(task_db) = db_guard.as_ref() {
                            if let Err(e) = tracepilot_orchestrator::task_db::operations::set_orchestrator_session_id(
                                task_db.conn(),
                                &uuid,
                            ) {
                                tracing::warn!(error = %e, "Failed to set orchestrator_session_id on tasks");
                            }
                        }
                    }
                    let mut guard = orch_state_clone
                        .lock()
                        .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
                    if let Some(ref mut stored) = *guard {
                        stored.session_uuid = Some(uuid);
                    }
                }
            }
        }

        // Read the (possibly just-updated) handle for session UUID + path
        let current_handle = orch_state_clone
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?
            .clone();

        let mut result = tracepilot_orchestrator::task_recovery::check_orchestrator_health(
            &jobs_dir,
            handle.as_ref(),
            Some(stale_secs),
        );

        // Populate session UUID and path from shared state
        if let Some(ref h) = current_handle {
            result.session_uuid = h.session_uuid.clone();
            if let Some(ref uuid) = h.session_uuid {
                let path = session_state_dir.join(uuid);
                result.session_path = Some(path.to_string_lossy().into_owned());
            }
        }

        Ok(result)
    })
    .await?
}

#[tauri::command]
pub async fn task_orchestrator_start(
    config: tauri::State<'_, SharedConfig>,
    task_db: tauri::State<'_, SharedTaskDb>,
    orch_state: tauri::State<'_, crate::types::SharedOrchestratorState>,
    model: Option<String>,
) -> CmdResult<tracepilot_orchestrator::task_orchestrator::OrchestratorHandle> {
    // Atomic launch guard — prevents TOCTOU race where two concurrent starts
    // both pass the "is running?" check before either stores a handle.
    static LAUNCH_IN_PROGRESS: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);

    // Check if already running
    {
        let guard = orch_state
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        if guard.is_some() {
            return Err(BindingsError::Validation(
                "Orchestrator is already running. Stop it first.".into(),
            ));
        }
    }

    // Claim the launch slot atomically
    if LAUNCH_IN_PROGRESS.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Err(BindingsError::Validation(
            "Orchestrator launch already in progress.".into(),
        ));
    }

    let cfg = read_config(&config);
    let db = get_or_init_task_db(&task_db)?;
    let orch_state_clone = std::sync::Arc::clone(&*orch_state);

    let orchestrator_model = model.unwrap_or_else(|| cfg.tasks.orchestrator_model.clone());
    let default_subagent_model = cfg.tasks.default_subagent_model.clone();
    let jobs_dir = cfg.jobs_dir();
    let presets_dir = cfg.presets_dir();
    let session_state_dir = cfg.session_state_dir();
    let cli_command = cfg.general.cli_command.clone();
    let poll_interval = cfg.tasks.poll_interval_seconds;
    let max_concurrent = cfg.tasks.max_concurrent_tasks;

    tokio::task::spawn_blocking(move || {
        // Release the launch guard when we exit this closure (success or error)
        struct LaunchGuard;
        impl Drop for LaunchGuard {
            fn drop(&mut self) {
                LAUNCH_IN_PROGRESS.store(false, std::sync::atomic::Ordering::SeqCst);
            }
        }
        let _launch_guard = LaunchGuard;

        // Get pending tasks from DB quickly, then release the lock BEFORE context assembly
        let pending_tasks = {
            let db_guard = db
                .lock()
                .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
            let task_db = db_guard
                .as_ref()
                .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;

            let filter = tracepilot_orchestrator::task_db::types::TaskFilter {
                status: Some(tracepilot_orchestrator::task_db::types::TaskStatus::Pending),
                ..Default::default()
            };
            let tasks =
                tracepilot_orchestrator::task_db::operations::list_tasks(task_db.conn(), &filter)
                    .map_err(BindingsError::Orchestrator)?;

            if tasks.is_empty() {
                return Err(BindingsError::Validation(
                    "No pending tasks to process. Create tasks first.".into(),
                ));
            }
            tasks
        }; // db_guard dropped here — DB is free for other operations

        // Resolve model per-task: use preset model_override if set, else global default
        let resolved_models: Vec<String> = pending_tasks
            .iter()
            .map(|task| {
                tracepilot_orchestrator::presets::io::get_preset(&presets_dir, &task.preset_id)
                    .ok()
                    .and_then(|p| p.execution.model_override.clone())
                    .unwrap_or_else(|| default_subagent_model.clone())
            })
            .collect();

        // Assemble context OUTSIDE the DB lock (may involve expensive I/O)
        // Collect (task_id, content, Option<context_hash>) tuples
        let context_results: Vec<(String, String, Option<String>)> = pending_tasks
            .iter()
            .map(|task| {
                let task_dir = jobs_dir.join(&task.id);
                let result_file = task_dir.join("result.json");
                let result_path = result_file.to_string_lossy().to_string();

                let (content, hash) = match tracepilot_orchestrator::presets::io::get_preset(
                    &presets_dir,
                    &task.preset_id,
                ) {
                    Ok(preset) => {
                        match tracepilot_orchestrator::task_context::assemble_task_context(
                            &preset,
                            &task.input_params,
                            &session_state_dir,
                            preset.context.max_chars,
                            &result_path,
                        ) {
                            Ok(assembled) => (assembled.content, Some(assembled.context_hash)),
                            Err(e) => {
                                tracing::warn!(
                                    task_id = %task.id,
                                    error = %e,
                                    "Context assembly failed, using fallback"
                                );
                                (fallback_context(task, &result_path), None)
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            task_id = %task.id,
                            preset_id = %task.preset_id,
                            error = %e,
                            "Preset not found, using fallback context"
                        );
                        (fallback_context(task, &result_path), None)
                    }
                };

                (task.id.clone(), content, hash)
            })
            .collect();

        let context_contents: Vec<(String, String)> = context_results
            .iter()
            .map(|(id, content, _)| (id.clone(), content.clone()))
            .collect();

        let jobs_dir_for_rescan = jobs_dir.clone();
        let launch_config = tracepilot_orchestrator::task_orchestrator::OrchestratorLaunchConfig {
            poll_interval,
            max_parallel: max_concurrent,
            max_empty_polls: 10,
            max_cycles: 100,
            orchestrator_model,
            cli_command,
            jobs_dir,
        };

        // Launch orchestrator FIRST, then mark tasks in_progress only on success.
        // This avoids stranding tasks in InProgress if the launch fails.
        let handle =
            tracepilot_orchestrator::task_orchestrator::launch_orchestrator(
                &pending_tasks,
                &resolved_models,
                &context_contents,
                &launch_config,
            )
            .map_err(BindingsError::Orchestrator)?;

        // Launch succeeded — now mark tasks in_progress and set context hashes.
        {
            let db_guard = db
                .lock()
                .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
            if let Some(task_db) = db_guard.as_ref() {
                for task in &pending_tasks {
                    if let Err(e) = tracepilot_orchestrator::task_db::operations::update_task_status(
                        task_db.conn(),
                        &task.id,
                        tracepilot_orchestrator::task_db::types::TaskStatus::InProgress,
                    ) {
                        tracing::warn!(task_id = %task.id, error = %e, "Failed to mark task in_progress");
                    }
                    // Persist context hash for dedup index enforcement
                    if let Some((_, _, Some(hash))) = context_results.iter().find(|(id, _, _)| id == &task.id) {
                        let _ = tracepilot_orchestrator::task_db::operations::set_context_hash(
                            task_db.conn(),
                            &task.id,
                            hash,
                        );
                    }
                }
            }
        }

        // Store handle
        let mut guard = orch_state_clone
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        *guard = Some(handle.clone());
        drop(guard);

        // Rescan for any tasks created during the launch window (between
        // initial query and handle-store). These would have been committed
        // to the DB but missed by hot-add since the handle wasn't set yet.
        {
            let db_guard = db
                .lock()
                .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
            if let Some(task_db) = db_guard.as_ref() {
                let filter = tracepilot_orchestrator::task_db::types::TaskFilter {
                    status: Some(tracepilot_orchestrator::task_db::types::TaskStatus::Pending),
                    ..Default::default()
                };
                if let Ok(stragglers) = tracepilot_orchestrator::task_db::operations::list_tasks(
                    task_db.conn(),
                    &filter,
                ) {
                    let manifest_path = std::path::PathBuf::from(&handle.manifest_path);
                    for task in &stragglers {
                        // Skip tasks we already included in the initial manifest
                        if pending_tasks.iter().any(|p| p.id == task.id) {
                            continue;
                        }
                        let task_dir = jobs_dir_for_rescan.join(&task.id);
                        let _ = std::fs::create_dir_all(&task_dir);
                        let result_path = task_dir.join("result.json").to_string_lossy().to_string();
                        let content = fallback_context(task, &result_path);
                        let _ = std::fs::write(task_dir.join("context.md"), &content);

                        let title = task.input_params
                            .get("title")
                            .and_then(|v| v.as_str())
                            .unwrap_or(&task.task_type)
                            .to_string();

                        let model = tracepilot_orchestrator::presets::io::get_preset(&presets_dir, &task.preset_id)
                            .ok()
                            .and_then(|p| p.execution.model_override.clone())
                            .unwrap_or_else(|| default_subagent_model.clone());

                        let manifest_task = tracepilot_orchestrator::task_orchestrator::manifest::ManifestTask {
                            id: task.id.clone(),
                            task_type: task.task_type.clone(),
                            title,
                            context_file: task_dir.join("context.md").to_string_lossy().to_string(),
                            result_file: result_path,
                            status_file: task_dir.join("status.json").to_string_lossy().to_string(),
                            model,
                            priority: task.priority.clone(),
                        };
                        if tracepilot_orchestrator::task_orchestrator::manifest::append_task_to_manifest(
                            &manifest_path,
                            &manifest_task,
                        ).is_ok() {
                            // Mark straggler as in_progress so results can be ingested
                            let _ = tracepilot_orchestrator::task_db::operations::update_task_status(
                                task_db.conn(),
                                &task.id,
                                tracepilot_orchestrator::task_db::types::TaskStatus::InProgress,
                            );
                        }
                    }
                }
            }
        }

        Ok(handle)
    })
    .await?
}

#[tauri::command]
pub async fn task_orchestrator_stop(
    config: tauri::State<'_, SharedConfig>,
    orch_state: tauri::State<'_, crate::types::SharedOrchestratorState>,
) -> CmdResult<()> {
    let orch_state_clone = std::sync::Arc::clone(&*orch_state);
    let cfg = read_config(&config);
    let jobs_dir = cfg.jobs_dir();

    tokio::task::spawn_blocking(move || {
        let mut guard = orch_state_clone
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;

        if let Some(handle) = guard.as_ref() {
            // Normal path: we have the in-memory handle with manifest path + PID.
            let manifest_path = std::path::PathBuf::from(&handle.manifest_path);
            let pid = handle.pid;

            tracepilot_orchestrator::task_orchestrator::manifest::update_manifest_shutdown(
                &manifest_path,
            )
            .map_err(BindingsError::Orchestrator)?;

            guard.take();
            drop(guard);

            for _ in 0..10 {
                if !is_process_alive(pid) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(300));
            }

            // Clean up heartbeat after stop so health immediately reports "stopped".
            let heartbeat_path = jobs_dir.join("heartbeat.json");
            if heartbeat_path.exists() {
                let _ = std::fs::remove_file(&heartbeat_path);
            }
        } else {
            // Fallback: handle lost (app restarted) — try manifest in jobs_dir.
            drop(guard);
            let manifest_path = jobs_dir.join("manifest.json");
            let heartbeat_path = jobs_dir.join("heartbeat.json");

            if manifest_path.exists() {
                // Best-effort: set shutdown flag so a still-alive process exits.
                let _ =
                    tracepilot_orchestrator::task_orchestrator::manifest::update_manifest_shutdown(
                        &manifest_path,
                    );
            }

            // Clean up stale heartbeat so the next health check returns "stopped"
            // instead of staying stuck on "stale" forever.
            if heartbeat_path.exists() {
                let _ = std::fs::remove_file(&heartbeat_path);
            }

            // Also remove manifest to fully reset state.
            if manifest_path.exists() {
                let _ = std::fs::remove_file(&manifest_path);
            }
        }

        Ok(())
    })
    .await?
}

/// Check if a process with the given PID is still alive (portable, no extra deps).
fn is_process_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        // Use tasklist to check if the PID exists
        std::process::Command::new("tasklist")
            .args(["/NH", "/FI", &format!("PID eq {pid}")])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .map(|o| {
                let out = String::from_utf8_lossy(&o.stdout);
                // tasklist returns "INFO: No tasks..." when PID doesn't exist
                !out.contains("No tasks") && out.contains(&pid.to_string())
            })
            .unwrap_or(false)
    }
    #[cfg(unix)]
    {
        // signal 0 checks process existence without killing it
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

// ─── Ingestion ──────────────────────────────────────────────────────

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
                .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
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
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
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
                            .map_err(|_| BindingsError::Validation("manifest lock poisoned".into()))?;

                        for retry_id in &retried_ids {
                            // Re-read the task to get current state
                            if let Ok(task) = tracepilot_orchestrator::task_db::operations::get_task(
                                task_db.conn(),
                                retry_id,
                            ) {
                                let task_dir = jobs_dir.join(&task.id);

                                // Clean up old result/status files so the orchestrator
                                // treats it as a fresh task
                                let _ = std::fs::remove_file(task_dir.join("result.json"));
                                let _ = std::fs::remove_file(task_dir.join("status.json"));

                                let title = task.input_params
                                    .get("title")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or(&task.task_type)
                                    .to_string();

                                let manifest_task = tracepilot_orchestrator::task_orchestrator::manifest::ManifestTask {
                                    id: task.id.clone(),
                                    task_type: task.task_type.clone(),
                                    title,
                                    context_file: task_dir.join("context.md").to_string_lossy().to_string(),
                                    result_file: task_dir.join("result.json").to_string_lossy().to_string(),
                                    status_file: task_dir.join("status.json").to_string_lossy().to_string(),
                                    model: tracepilot_orchestrator::presets::io::get_preset(&presets_dir, &task.preset_id)
                                        .ok()
                                        .and_then(|p| p.execution.model_override.clone())
                                        .unwrap_or_else(|| default_subagent_model.clone()),
                                    priority: task.priority.clone(),
                                };

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

// ─── Attribution ────────────────────────────────────────────────────

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

// ─── Helpers ────────────────────────────────────────────────────────

/// Build minimal context when preset loading or full assembly fails.
fn fallback_context(task: &tracepilot_orchestrator::task_db::Task, result_path: &str) -> String {
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
