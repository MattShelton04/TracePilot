//! Terminal-launch entry point.
//!
//! Coordinates worktree creation, argument assembly, and dispatch to the
//! per-OS spawn implementation in `windows.rs` / `unix.rs`.

use crate::error::{OrchestratorError, Result};
use crate::types::{CreateWorktreeRequest, LaunchConfig, LaunchMode, LaunchedSession};
use crate::worktrees;

use super::models::validate_model;
use super::paths::canonicalize_user_path;

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod unix;
#[cfg(windows)]
mod windows;

/// Inputs shared by every per-OS terminal spawner.
pub(super) struct SessionPlan<'a> {
    pub config: &'a LaunchConfig,
    pub work_dir: std::path::PathBuf,
    pub copilot_cmd: String,
}

/// Launch a new Copilot CLI session in a **new terminal window**.
///
/// If `create_worktree` is true and a `branch` is specified, a new git worktree
/// will be created first and used as the working directory.
///
/// NOTE: The returned `pid` is the PID of the **terminal wrapper process**, not
/// the Copilot session itself. It is informational only.
pub fn launch_session(config: &LaunchConfig) -> Result<LaunchedSession> {
    if config.launch_mode == LaunchMode::Sdk || config.headless {
        return Err(OrchestratorError::Launch(
            "SDK/headless launches must use the async SDK launcher path".into(),
        ));
    }

    // Phase 1A.2: canonicalize repo path + reject UNC/network paths.
    let repo = canonicalize_user_path(&config.repo_path)?;

    // Handle worktree creation if requested
    let (work_dir, worktree_path) = if config.create_worktree {
        let branch = config.branch.as_deref().ok_or_else(|| {
            OrchestratorError::Launch("Branch is required when creating a worktree".into())
        })?;

        let request = CreateWorktreeRequest {
            repo_path: config.repo_path.clone(),
            branch: branch.to_string(),
            base_branch: config.base_branch.clone(),
            target_dir: None,
        };

        match worktrees::create_worktree(&request) {
            Ok(wt) => {
                let wt_path = wt.path.clone();
                (std::path::PathBuf::from(&wt.path), Some(wt_path))
            }
            Err(e) => {
                return Err(OrchestratorError::launch_ctx(
                    "Failed to create worktree",
                    e,
                ));
            }
        }
    } else {
        (repo.to_path_buf(), None)
    };

    // Sanitize CLI command — allow only safe characters.
    // Colon is needed for Windows drive letters (e.g., C:\path\to\copilot).
    let cli = &config.cli_command;
    if !cli
        .chars()
        .all(|c| c.is_alphanumeric() || "-_./\\ :".contains(c))
    {
        return Err(OrchestratorError::Launch(
            "CLI command contains invalid characters".into(),
        ));
    }

    // Build the copilot command arguments
    let mut args: Vec<String> = Vec::new();

    if let Some(model) = &config.model {
        validate_model(model)?;
        args.push("--model".to_string());
        args.push(model.clone());
    }

    if config.auto_approve {
        args.push("--allow-all".to_string());
    }

    if config.ui_server {
        args.push("--ui-server".to_string());
    }

    if let Some(effort) = &config.reasoning_effort {
        args.push("--reasoning-effort".to_string());
        args.push(effort.clone());
    }

    // Build the CLI command string using the user-configured CLI command
    let copilot_cmd = if args.is_empty() {
        cli.clone()
    } else {
        format!("{} {}", cli, args.join(" "))
    };

    let plan = SessionPlan {
        config,
        work_dir,
        copilot_cmd: copilot_cmd.clone(),
    };

    #[cfg(windows)]
    let pid = windows::spawn(&plan)?;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let pid = unix::spawn(&plan)?;

    Ok(LaunchedSession {
        pid,
        worktree_path,
        command: copilot_cmd,
        launched_at: chrono::Utc::now().to_rfc3339(),
        launch_mode: LaunchMode::Terminal,
        sdk_session_id: None,
    })
}

/// Launch a Copilot SDK-owned headless session.
pub async fn launch_sdk_session(
    config: &LaunchConfig,
    bridge: &mut crate::bridge::BridgeManager,
) -> Result<LaunchedSession> {
    crate::launcher_sdk::launch_sdk_session(config, bridge).await
}
