//! SDK/headless session launcher path.

use crate::bridge::{BridgeManager, BridgeMessagePayload, BridgeSessionConfig};
use crate::error::{OrchestratorError, Result};
use crate::types::{CreateWorktreeRequest, LaunchConfig, LaunchMode, LaunchedSession};
use crate::{launcher, worktrees};

pub(crate) async fn launch_sdk_session(
    config: &LaunchConfig,
    bridge: &mut BridgeManager,
) -> Result<LaunchedSession> {
    let (work_dir, worktree_path) = prepare_sdk_workspace(config)?;
    let work_dir_string = work_dir.display().to_string();
    let session = bridge
        .create_launcher_session(BridgeSessionConfig {
            model: config.model.clone(),
            working_directory: Some(work_dir_string.clone()),
            system_message: None,
            reasoning_effort: config.reasoning_effort.clone(),
            agent: None,
        })
        .await
        .map_err(|e| OrchestratorError::Launch(format!("Copilot SDK launch failed: {e}")))?;
    send_initial_prompt_if_present(bridge, &session.session_id, config.prompt.as_deref()).await?;

    Ok(LaunchedSession {
        pid: 0,
        worktree_path,
        command: format!("Copilot SDK bridge session in {work_dir_string}"),
        launched_at: chrono::Utc::now().to_rfc3339(),
        launch_mode: LaunchMode::Sdk,
        sdk_session_id: Some(session.session_id),
    })
}

async fn send_initial_prompt_if_present(
    bridge: &BridgeManager,
    session_id: &str,
    prompt: Option<&str>,
) -> Result<()> {
    let Some(prompt) = prompt.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };
    bridge
        .send_message(
            session_id,
            BridgeMessagePayload {
                prompt: prompt.to_string(),
                mode: None,
            },
        )
        .await
        .map(|_| ())
        .map_err(|e| OrchestratorError::Launch(format!("Copilot SDK initial prompt failed: {e}")))
}

fn prepare_sdk_workspace(config: &LaunchConfig) -> Result<(std::path::PathBuf, Option<String>)> {
    let repo = launcher::canonicalize_user_path(&config.repo_path)?;
    if config.create_worktree {
        let branch = config.branch.as_deref().ok_or_else(|| {
            OrchestratorError::Launch("Branch is required when creating a worktree".into())
        })?;

        let request = CreateWorktreeRequest {
            repo_path: config.repo_path.clone(),
            branch: branch.to_string(),
            base_branch: config.base_branch.clone(),
            target_dir: None,
        };
        let wt = worktrees::create_worktree(&request)
            .map_err(|e| OrchestratorError::Launch(format!("Failed to create worktree: {e}")))?;
        return Ok((std::path::PathBuf::from(&wt.path), Some(wt.path)));
    }

    if let Some(branch) = config.branch.as_deref().filter(|b| !b.trim().is_empty()) {
        checkout_branch_for_sdk(&repo, branch, config.base_branch.as_deref())?;
    }

    Ok((repo, None))
}

fn checkout_branch_for_sdk(
    repo: &std::path::Path,
    branch: &str,
    base_branch: Option<&str>,
) -> Result<()> {
    let status = crate::process::hidden_std_command("git")
        .args(["checkout", branch])
        .current_dir(repo)
        .status()
        .map_err(|e| OrchestratorError::launch_ctx("Failed to run git checkout", e))?;
    if status.success() {
        return Ok(());
    }

    let base = base_branch.unwrap_or("origin/main");
    let create_status = crate::process::hidden_std_command("git")
        .args(["checkout", "-b", branch, base])
        .current_dir(repo)
        .status()
        .map_err(|e| OrchestratorError::launch_ctx("Failed to create branch for SDK launch", e))?;
    if create_status.success() {
        Ok(())
    } else {
        Err(OrchestratorError::Launch(format!(
            "Failed to checkout or create branch '{branch}' for SDK launch"
        )))
    }
}
