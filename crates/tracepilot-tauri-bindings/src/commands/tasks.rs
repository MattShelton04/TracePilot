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
    task_type: String,
    preset_id: String,
    input_params: serde_json::Value,
    priority: Option<String>,
    max_retries: Option<i32>,
) -> CmdResult<Task> {
    let db = get_or_init_task_db(&state)?;
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
        tracepilot_orchestrator::task_db::operations::create_task(db.conn(), &new_task)
            .map_err(BindingsError::Orchestrator)
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
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
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
pub async fn task_get(
    state: tauri::State<'_, SharedTaskDb>,
    id: String,
) -> CmdResult<Task> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
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
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::list_tasks(db.conn(), &f)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_cancel(
    state: tauri::State<'_, SharedTaskDb>,
    id: String,
) -> CmdResult<()> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::cancel_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_retry(
    state: tauri::State<'_, SharedTaskDb>,
    id: String,
) -> CmdResult<()> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::retry_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_delete(
    state: tauri::State<'_, SharedTaskDb>,
    id: String,
) -> CmdResult<()> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::delete_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_stats(
    state: tauri::State<'_, SharedTaskDb>,
) -> CmdResult<TaskStats> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
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
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
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
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
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
    orch_state: tauri::State<'_, crate::types::SharedOrchestratorState>,
) -> CmdResult<tracepilot_orchestrator::task_recovery::HealthCheckResult> {
    let cfg = read_config(&config);
    let jobs_dir = cfg.jobs_dir();
    let session_state_dir = cfg.session_state_dir();
    let orch_state_clone = std::sync::Arc::clone(&*orch_state);
    let handle = orch_state
        .lock()
        .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?
        .clone();
    let stale_secs = (cfg.tasks.poll_interval_seconds * cfg.tasks.heartbeat_stale_multiplier) as u64;
    tokio::task::spawn_blocking(move || {
        // Attempt session UUID discovery if handle exists but UUID is unknown
        if let Some(ref h) = handle {
            if h.session_uuid.is_none() {
                if let Some(uuid) = tracepilot_orchestrator::task_orchestrator::discover_session_uuid(
                    &session_state_dir,
                    h.pid,
                    &h.launched_at,
                ) {
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

        let resolved_models: Vec<String> = pending_tasks
            .iter()
            .map(|_| default_subagent_model.clone())
            .collect();

        // Assemble context OUTSIDE the DB lock (may involve expensive I/O)
        let context_contents: Vec<(String, String)> = pending_tasks
            .iter()
            .map(|task| {
                let task_dir = jobs_dir.join(&task.id);
                let result_file = task_dir.join("result.json");
                let result_path = result_file.to_string_lossy().to_string();

                let content = match tracepilot_orchestrator::presets::io::get_preset(
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
                            Ok(assembled) => assembled.content,
                            Err(e) => {
                                tracing::warn!(
                                    task_id = %task.id,
                                    error = %e,
                                    "Context assembly failed, using fallback"
                                );
                                fallback_context(task, &result_path)
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
                        fallback_context(task, &result_path)
                    }
                };

                (task.id.clone(), content)
            })
            .collect();

        let launch_config = tracepilot_orchestrator::task_orchestrator::OrchestratorLaunchConfig {
            poll_interval,
            max_parallel: max_concurrent,
            max_empty_polls: 10,
            max_cycles: 100,
            orchestrator_model,
            cli_command,
            jobs_dir,
        };

        let handle =
            tracepilot_orchestrator::task_orchestrator::launch_orchestrator(
                &pending_tasks,
                &resolved_models,
                &context_contents,
                &launch_config,
            )
            .map_err(BindingsError::Orchestrator)?;

        // Store handle
        let mut guard = orch_state_clone
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        *guard = Some(handle.clone());
        drop(guard);

        // Mark all claimed tasks as in_progress in the DB
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
            }
        }

        Ok(handle)
    })
    .await?
}

#[tauri::command]
pub async fn task_orchestrator_stop(
    orch_state: tauri::State<'_, crate::types::SharedOrchestratorState>,
) -> CmdResult<()> {
    let orch_state_clone = std::sync::Arc::clone(&*orch_state);

    tokio::task::spawn_blocking(move || {
        let mut guard = orch_state_clone
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let handle = guard
            .take()
            .ok_or_else(|| BindingsError::Validation("Orchestrator is not running.".into()))?;

        let manifest_path = std::path::PathBuf::from(&handle.manifest_path);
        tracepilot_orchestrator::task_orchestrator::manifest::update_manifest_shutdown(
            &manifest_path,
        )
        .map_err(BindingsError::Orchestrator)?;

        Ok(())
    })
    .await?
}

// ─── Ingestion ──────────────────────────────────────────────────────

/// Scan the jobs directory for completed task results and ingest them into the DB.
/// Returns the number of tasks that were successfully ingested.
#[tauri::command]
pub async fn task_ingest_results(
    config: tauri::State<'_, SharedConfig>,
    task_db: tauri::State<'_, SharedTaskDb>,
) -> CmdResult<u32> {
    let cfg = read_config(&config);
    let jobs_dir = cfg.jobs_dir();
    let db = get_or_init_task_db(&task_db)?;

    tokio::task::spawn_blocking(move || {
        let db_guard = db
            .lock()
            .map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let task_db = db_guard
            .as_ref()
            .ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;

        // Get all non-terminal tasks (pending + in_progress) — these are candidates for ingestion
        let pending_filter = tracepilot_orchestrator::task_db::types::TaskFilter {
            status: Some(tracepilot_orchestrator::task_db::types::TaskStatus::Pending),
            ..Default::default()
        };
        let in_progress_filter = tracepilot_orchestrator::task_db::types::TaskFilter {
            status: Some(tracepilot_orchestrator::task_db::types::TaskStatus::InProgress),
            ..Default::default()
        };

        let mut task_ids: Vec<String> = Vec::new();
        if let Ok(tasks) = tracepilot_orchestrator::task_db::operations::list_tasks(
            task_db.conn(),
            &pending_filter,
        ) {
            task_ids.extend(tasks.into_iter().map(|t| t.id));
        }
        if let Ok(tasks) = tracepilot_orchestrator::task_db::operations::list_tasks(
            task_db.conn(),
            &in_progress_filter,
        ) {
            task_ids.extend(tasks.into_iter().map(|t| t.id));
        }

        if task_ids.is_empty() {
            return Ok(0);
        }

        let results = tracepilot_orchestrator::task_ipc::ingest_results(
            task_db.conn(),
            &jobs_dir,
            &task_ids,
        )
        .map_err(BindingsError::Orchestrator)?;

        let ingested_count = results.iter().filter(|r| r.ingested).count() as u32;
        Ok(ingested_count)
    })
    .await?
}

// ─── Attribution ────────────────────────────────────────────────────

#[tauri::command]
pub async fn task_attribution(
    session_path: String,
) -> CmdResult<tracepilot_orchestrator::task_attribution::AttributionSnapshot> {
    let path = std::path::PathBuf::from(session_path);
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::task_attribution::build_attribution_from_session(&path)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

// ─── Helpers ────────────────────────────────────────────────────────

/// Build minimal context when preset loading or full assembly fails.
fn fallback_context(
    task: &tracepilot_orchestrator::task_db::Task,
    result_path: &str,
) -> String {
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
