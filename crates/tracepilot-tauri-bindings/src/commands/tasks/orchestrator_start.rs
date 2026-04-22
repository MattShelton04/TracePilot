//! Orchestrator start command. Separated from `orchestrator.rs` because
//! the launch path (context assembly, straggler rescan, etc.) is large
//! enough to warrant its own file under the ≤ 350 LOC submodule budget.

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{get_or_init_task_db, mutex_poisoned, read_config};
use crate::types::SharedTaskDb;

use super::{fallback_context, resolve_task_model};

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
            .map_err(|_| mutex_poisoned())?;
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
                .map_err(|_| mutex_poisoned())?;
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
                resolve_task_model(
                    &presets_dir,
                    &tracepilot_core::ids::PresetId::from_validated(&task.preset_id),
                    &default_subagent_model,
                )
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
                    &tracepilot_core::ids::PresetId::from_validated(&task.preset_id),
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
                .map_err(|_| mutex_poisoned())?;
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
                        if let Err(e) = tracepilot_orchestrator::task_db::operations::set_context_hash(
                            task_db.conn(),
                            &task.id,
                            hash,
                        ) {
                            tracing::warn!(task_id = %task.id, error = %e, "Failed to persist context hash");
                        }
                    }
                }
            }
        }

        // Store handle
        let mut guard = orch_state_clone
            .lock()
            .map_err(|_| mutex_poisoned())?;
        *guard = Some(handle.clone());
        drop(guard);

        // Rescan for any tasks created during the launch window (between
        // initial query and handle-store). These would have been committed
        // to the DB but missed by hot-add since the handle wasn't set yet.
        {
            let db_guard = db
                .lock()
                .map_err(|_| mutex_poisoned())?;
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
                        if let Err(e) = std::fs::create_dir_all(&task_dir) {
                            tracing::warn!(task_id = %task.id, path = %task_dir.display(), error = %e, "Failed to create straggler task dir");
                            continue;
                        }
                        let result_path = task_dir.join("result.json").to_string_lossy().to_string();
                        let content = fallback_context(task, &result_path);
                        if let Err(e) = std::fs::write(task_dir.join("context.md"), &content) {
                            tracing::warn!(task_id = %task.id, error = %e, "Failed to write fallback context.md for straggler");
                        }

                        let model = resolve_task_model(
                            &presets_dir,
                            &tracepilot_core::ids::PresetId::from_validated(&task.preset_id),
                            &default_subagent_model,
                        );
                        let manifest_task = tracepilot_orchestrator::task_orchestrator::manifest::ManifestTask::from_task(
                            task, &model, &jobs_dir_for_rescan,
                        );
                        if tracepilot_orchestrator::task_orchestrator::manifest::append_task_to_manifest(
                            &manifest_path,
                            &manifest_task,
                        ).is_ok() {
                            // Mark straggler as in_progress so results can be ingested
                            if let Err(e) = tracepilot_orchestrator::task_db::operations::update_task_status(
                                task_db.conn(),
                                &task.id,
                                tracepilot_orchestrator::task_db::types::TaskStatus::InProgress,
                            ) {
                                tracing::warn!(task_id = %task.id, error = %e, "Failed to mark straggler task in_progress");
                            }
                        }
                    }
                }
            }
        }

        Ok(handle)
    })
    .await?
}
