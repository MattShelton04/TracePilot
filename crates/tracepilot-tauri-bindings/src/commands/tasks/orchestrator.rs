//! Orchestrator lifecycle: health monitoring and stop. Start lives in
//! `orchestrator_start` because that single command is large enough to
//! warrant its own file under the ≤ 350 LOC submodule budget.

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::SharedTaskDb;

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
        use std::os::windows::process::CommandExt;
        // Use tasklist to check if the PID exists
        std::process::Command::new("tasklist")
            .args(["/NH", "/FI", &format!("PID eq {pid}")])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .creation_flags(tracepilot_core::constants::CREATE_NO_WINDOW)
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
