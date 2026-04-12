//! Orchestrator lifecycle commands: health, start, stop.
//!
//! These commands manage the long-running orchestrator process that
//! executes AI agent tasks.  They involve complex state management
//! with multiple lock acquisitions and process lifecycle tracking.

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{get_or_init_task_db, read_config};
use crate::types::SharedTaskDb;

use super::manifest_helpers::{
    build_and_append_manifest_task, ensure_task_job_dir, fallback_context, resolve_task_model,
    write_task_context,
};

// ─── Health ─────────────────────────────────────────────────────────

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

// ─── Start ──────────────────────────────────────────────────────────

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
            .map(|task| resolve_task_model(&presets_dir, &task.preset_id, &default_subagent_model))
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
        //
        // NOTE: This path intentionally does NOT acquire manifest_lock.
        // The LAUNCH_IN_PROGRESS atomic guard is still held, preventing
        // concurrent task_create hot-adds. This is a pre-existing design
        // choice preserved during the decomposition.
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
                        let task_dir = ensure_task_job_dir(&jobs_dir_for_rescan, &task.id)?;
                        let result_path = task_dir.join("result.json").to_string_lossy().to_string();
                        let content = fallback_context(task, &result_path);
                        let _ = write_task_context(&task_dir, &content);

                        let model = resolve_task_model(&presets_dir, &task.preset_id, &default_subagent_model);
                        if build_and_append_manifest_task(
                            task, &model, &jobs_dir_for_rescan, &manifest_path,
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

// ─── Stop ───────────────────────────────────────────────────────────

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
                let _ = tracepilot_orchestrator::task_orchestrator::manifest::update_manifest_shutdown(
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

// ── Helpers ─────────────────────────────────────────────────────────

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
