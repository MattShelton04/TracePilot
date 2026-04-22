//! Orchestrator launch logic.
//!
//! Handles the full launch sequence: prepare jobs directory, assemble context
//! files, generate manifest, render prompt, and spawn the Copilot CLI session.

use crate::error::{OrchestratorError, Result};
use crate::task_orchestrator::manifest;
use crate::task_orchestrator::prompt;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU32;

/// Configuration for the orchestrator launch.
#[derive(Debug, Clone)]
pub struct OrchestratorLaunchConfig {
    /// Poll interval in seconds.
    pub poll_interval: u32,
    /// Maximum concurrent subagent tasks.
    pub max_parallel: u32,
    /// Exit after this many empty poll cycles.
    pub max_empty_polls: u32,
    /// Exit after this many total cycles.
    pub max_cycles: u32,
    /// Model to use for the orchestrator session.
    pub orchestrator_model: String,
    /// Copilot CLI command (e.g. "copilot").
    pub cli_command: String,
    /// Jobs directory path.
    pub jobs_dir: PathBuf,
}

impl Default for OrchestratorLaunchConfig {
    fn default() -> Self {
        Self {
            poll_interval: 30,
            max_parallel: 3,
            max_empty_polls: 30,
            max_cycles: 200,
            orchestrator_model: tracepilot_core::constants::DEFAULT_ORCHESTRATOR_MODEL.to_string(),
            cli_command: tracepilot_core::constants::DEFAULT_CLI_COMMAND.to_string(),
            jobs_dir: PathBuf::new(), // Must be set by caller
        }
    }
}

/// Handle returned after launching the orchestrator.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorHandle {
    /// PID of the terminal process (informational only).
    pub pid: u32,
    /// Absolute path to the manifest file.
    pub manifest_path: String,
    /// Absolute path to the jobs directory.
    pub jobs_dir: String,
    /// ISO 8601 timestamp when launched.
    pub launched_at: String,
    /// UUID of the orchestrator's Copilot CLI session (discovered via lock file).
    pub session_uuid: Option<String>,
}

/// Shared Tauri state for tracking the active orchestrator.
pub struct OrchestratorState {
    pub handle: std::sync::Mutex<Option<OrchestratorHandle>>,
    pub restart_count: AtomicU32,
}

impl Default for OrchestratorState {
    fn default() -> Self {
        Self {
            handle: std::sync::Mutex::new(None),
            restart_count: AtomicU32::new(0),
        }
    }
}

/// Prepare the jobs directory structure for a set of tasks.
///
/// Creates `jobs_dir` and per-task subdirectories. Removes stale
/// `result.json` and `status.json` files to prevent incorrect ingestion
/// of results from prior runs.
pub fn prepare_jobs_dir(jobs_dir: &Path, task_ids: &[String]) -> Result<()> {
    std::fs::create_dir_all(jobs_dir)?;
    for task_id in task_ids {
        let task_dir = jobs_dir.join(task_id);
        std::fs::create_dir_all(&task_dir)?;
        // Clean stale IPC files so a restarted orchestrator doesn't ingest old results.
        for stale_file in &["result.json", "status.json"] {
            let path = task_dir.join(stale_file);
            if path.exists() {
                // best-effort: a stale file that can't be removed will be overwritten
                // by the next write, so this failure is tolerable.
                let _: std::io::Result<()> = std::fs::remove_file(&path);
            }
        }
    }
    Ok(())
}

/// Full orchestrator launch sequence:
///
/// 1. Prepare jobs directory
/// 2. Write context files for each task (caller provides assembled contexts)
/// 3. Generate and write manifest
/// 4. Render orchestrator prompt
/// 5. Launch Copilot CLI session
/// 6. Return handle
pub fn launch_orchestrator(
    pending_tasks: &[crate::task_db::Task],
    resolved_models: &[String], // per-task model, same order as pending_tasks
    context_contents: &[(String, String)], // (task_id, context.md content)
    config: &OrchestratorLaunchConfig,
) -> Result<OrchestratorHandle> {
    let jobs_dir = &config.jobs_dir;

    // 1. Prepare directories
    let task_ids: Vec<String> = pending_tasks.iter().map(|t| t.id.clone()).collect();
    prepare_jobs_dir(jobs_dir, &task_ids)?;

    // 2. Write context files
    for (task_id, content) in context_contents {
        let context_path = jobs_dir.join(task_id).join("context.md");
        std::fs::write(&context_path, content)
            .map_err(|e| OrchestratorError::task_ctx(format!("Failed to write context for task {task_id}"), e))?;
    }

    // 3. Generate and write manifest
    let manifest_path = prompt::manifest_path(jobs_dir);
    let inputs: Vec<manifest::ManifestInput<'_>> = pending_tasks
        .iter()
        .zip(resolved_models.iter())
        .map(|(task, model)| manifest::ManifestInput {
            task,
            model: model.clone(),
        })
        .collect();
    let task_manifest =
        manifest::generate_manifest(&inputs, jobs_dir, config.poll_interval, config.max_parallel);
    manifest::write_manifest(&task_manifest, &manifest_path)?;

    // 4. Render prompt
    let manifest_str = manifest_path.to_string_lossy().to_string();
    let heartbeat_str = jobs_dir
        .join("heartbeat.json")
        .to_string_lossy()
        .to_string();
    let prompt_config = prompt::OrchestratorPromptConfig {
        manifest_path: manifest_str,
        heartbeat_path: heartbeat_str,
        poll_interval: config.poll_interval,
        max_parallel: config.max_parallel,
        max_empty_polls: config.max_empty_polls,
        max_cycles: config.max_cycles,
    };
    let prompt_text = prompt::render_orchestrator_prompt(&prompt_config);

    // 4b. Write prompt to file (avoids shell escaping issues with long prompts)
    let prompt_path = jobs_dir.join("orchestrator-prompt.md");
    std::fs::write(&prompt_path, &prompt_text)
        .map_err(|e| OrchestratorError::task_ctx("Failed to write orchestrator prompt", e))?;

    // 4c. Write initial heartbeat so the monitor shows "Running" immediately
    let heartbeat_path = jobs_dir.join("heartbeat.json");
    let initial_heartbeat = serde_json::json!({
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "cycle": 0,
        "activeTasks": task_ids,
        "completedTasks": []
    });
    let tmp_heartbeat = heartbeat_path.with_extension("json.tmp");
    if let Err(e) = std::fs::write(&tmp_heartbeat, initial_heartbeat.to_string()) {
        tracing::warn!(error = %e, "Failed to write initial heartbeat file");
    } else if let Err(e) = std::fs::rename(&tmp_heartbeat, &heartbeat_path) {
        tracing::warn!(error = %e, "Failed to rename initial heartbeat file");
        // best-effort: clean up the temp so we don't leak it on disk.
        let _: std::io::Result<()> = std::fs::remove_file(&tmp_heartbeat);
    }

    // 5. Launch via spawn_detached_terminal (reuse existing launcher infra)
    let cli = &config.cli_command;
    if !cli
        .chars()
        .all(|c| c.is_alphanumeric() || "-_./\\ :".contains(c))
    {
        return Err(OrchestratorError::Launch(
            "CLI command contains invalid characters".into(),
        ));
    }

    // Validate orchestrator_model against injection (same rules as cli_command)
    let model = &config.orchestrator_model;
    if !model
        .chars()
        .all(|c| c.is_alphanumeric() || "-_.".contains(c))
    {
        return Err(OrchestratorError::Launch(
            "Orchestrator model contains invalid characters".into(),
        ));
    }

    // Build the copilot command with model + auto-approve + prompt.
    // Quote cli path to handle spaces (e.g., "C:\Program Files\...").
    let copilot_cmd = if cli.contains(' ') {
        format!("\"{}\" --model {} --allow-all", cli, model)
    } else {
        format!("{} --model {} --allow-all", cli, model)
    };

    // Build a short bootstrap prompt that tells copilot to read the full instructions
    // from the file. This avoids all shell escaping issues with the long prompt.
    let bootstrap_prompt = format!(
        "Read and follow ALL instructions in the file at: {}",
        prompt_path.display()
    );

    #[cfg(windows)]
    let pid = {
        let escaped_dir = jobs_dir.display().to_string().replace('\'', "''");
        let escaped_bootstrap = bootstrap_prompt.replace('\'', "''");
        let ps_cmd = format!(
            "$host.UI.RawUI.WindowTitle = 'TracePilot Orchestrator'; \
             Set-Location -LiteralPath '{}'; \
             Write-Host 'TracePilot Task Orchestrator starting...' -ForegroundColor Cyan; \
             Write-Host '  Jobs dir: {}' -ForegroundColor White; \
             Write-Host '' ; \
             {} -i '{}'",
            escaped_dir, escaped_dir, copilot_cmd, escaped_bootstrap
        );
        let encoded = crate::process::encode_powershell_command(&ps_cmd);
        crate::process::spawn_detached_terminal(
            "powershell",
            &["-NoExit", "-EncodedCommand", &encoded],
            jobs_dir,
            None,
        )?
    };

    #[cfg(target_os = "macos")]
    let pid = {
        let escaped_bootstrap = bootstrap_prompt.replace('\'', "'\\''");
        let full_cmd = format!("{} -i '{}'", copilot_cmd, escaped_bootstrap);
        crate::process::spawn_detached_terminal(&full_cmd, &[], jobs_dir, None)?
    };

    #[cfg(target_os = "linux")]
    let pid = {
        let escaped_bootstrap = bootstrap_prompt.replace('\'', "'\\''");
        let full_cmd = format!("{} -i '{}'", copilot_cmd, escaped_bootstrap);
        crate::process::spawn_detached_terminal(&full_cmd, &[], jobs_dir, None)?
    };

    let handle = OrchestratorHandle {
        pid,
        manifest_path: manifest_path.to_string_lossy().to_string(),
        jobs_dir: jobs_dir.to_string_lossy().to_string(),
        launched_at: chrono::Utc::now().to_rfc3339(),
        session_uuid: None, // Populated later via discover_session_uuid
    };

    tracing::info!(
        pid = pid,
        manifest = %manifest_path.display(),
        tasks = pending_tasks.len(),
        "Orchestrator launched"
    );

    Ok(handle)
}

/// Discover the orchestrator's Copilot CLI session UUID by scanning for
/// session directories that were created after the orchestrator launch time
/// and have an active `inuse.*.lock` file.
///
/// We use a time-based approach rather than PID matching because the handle
/// stores the terminal wrapper PID, not the Copilot CLI session PID.
pub fn discover_session_uuid(
    session_state_dir: &Path,
    _pid: u32,
    launched_at: &str,
) -> Option<String> {
    let launch_time = chrono::DateTime::parse_from_rfc3339(launched_at).ok()?;
    let launch_system_time = std::time::SystemTime::from(launch_time);

    let entries = std::fs::read_dir(session_state_dir).ok()?;

    let mut candidates: Vec<(String, std::time::SystemTime)> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Check if directory was created after orchestrator launch
        let created = std::fs::metadata(&path)
            .ok()
            .and_then(|m| m.created().ok().or_else(|| m.modified().ok()));
        let Some(dir_time) = created else {
            continue;
        };
        if dir_time < launch_system_time {
            continue;
        }

        // Check for any active inuse.*.lock file
        let has_lock = std::fs::read_dir(&path)
            .ok()
            .map(|entries| {
                entries.flatten().any(|e| {
                    let name = e.file_name();
                    let name = name.to_string_lossy();
                    name.starts_with("inuse.") && name.ends_with(".lock")
                })
            })
            .unwrap_or(false);

        if has_lock {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                candidates.push((name.to_string(), dir_time));
            }
        }
    }

    // Pick the newest candidate (most recently created after launch)
    candidates.sort_by(|a, b| b.1.cmp(&a.1));

    if let Some((uuid, _)) = candidates.into_iter().next() {
        tracing::info!(
            session_uuid = %uuid,
            "Discovered orchestrator session via time-based scan"
        );
        return Some(uuid);
    }

    None
}
