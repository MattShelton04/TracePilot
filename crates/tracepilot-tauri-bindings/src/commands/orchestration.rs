//! Orchestration Tauri commands (22 commands).

use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::read_config;

#[tauri::command]
pub async fn check_system_deps(
    cli_command: Option<String>,
) -> CmdResult<tracepilot_orchestrator::SystemDependencies> {
    Ok(tokio::task::spawn_blocking(move || tracepilot_orchestrator::launcher::check_dependencies(cli_command.as_deref())).await?)
}

// -- Worktree commands --

#[tauri::command]
pub async fn list_worktrees(
    repo_path: String,
) -> CmdResult<Vec<tracepilot_orchestrator::WorktreeInfo>> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::list_worktrees(std::path::Path::new(&repo_path))
    })
    .await??)
}

#[tauri::command]
pub async fn create_worktree(
    request: tracepilot_orchestrator::CreateWorktreeRequest,
) -> CmdResult<tracepilot_orchestrator::WorktreeInfo> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::create_worktree(&request)
    })
    .await??)
}

#[tauri::command]
pub async fn remove_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> CmdResult<()> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::remove_worktree(
            std::path::Path::new(&repo_path),
            std::path::Path::new(&worktree_path),
            force,
        )
    })
    .await??)
}

#[tauri::command]
pub async fn prune_worktrees(
    repo_path: String,
) -> CmdResult<tracepilot_orchestrator::PruneResult> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::prune_worktrees(std::path::Path::new(&repo_path))
    })
    .await??)
}

#[tauri::command]
pub async fn list_branches(repo_path: String) -> CmdResult<Vec<String>> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::list_branches(std::path::Path::new(&repo_path))
    })
    .await??)
}

#[tauri::command]
pub async fn get_worktree_disk_usage(path: String) -> CmdResult<u64> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::disk_usage_bytes(std::path::Path::new(&path))
    })
    .await??)
}

#[tauri::command]
pub async fn is_git_repo(path: String) -> CmdResult<bool> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::is_git_repo(std::path::Path::new(&path))
    })
    .await?)
}

#[tauri::command]
pub async fn lock_worktree(
    repo_path: String,
    worktree_path: String,
    reason: Option<String>,
) -> CmdResult<()> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::lock_worktree(
            std::path::Path::new(&repo_path),
            std::path::Path::new(&worktree_path),
            reason.as_deref(),
        )
    })
    .await??)
}

#[tauri::command]
pub async fn unlock_worktree(
    repo_path: String,
    worktree_path: String,
) -> CmdResult<()> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::unlock_worktree(
            std::path::Path::new(&repo_path),
            std::path::Path::new(&worktree_path),
        )
    })
    .await??)
}

#[tauri::command]
pub async fn get_worktree_details(
    worktree_path: String,
) -> CmdResult<tracepilot_orchestrator::WorktreeDetails> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::get_worktree_details(
            std::path::Path::new(&worktree_path),
        )
    })
    .await??)
}

#[tauri::command]
pub async fn get_default_branch(repo_path: String) -> CmdResult<String> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::get_default_branch(std::path::Path::new(&repo_path))
    })
    .await??)
}

#[tauri::command]
pub async fn fetch_remote(
    repo_path: String,
    branch: Option<String>,
) -> CmdResult<String> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::fetch_remote(
            std::path::Path::new(&repo_path),
            branch.as_deref(),
        )
    })
    .await??)
}

// -- Repository Registry commands --

#[tauri::command]
pub async fn list_registered_repos() -> CmdResult<Vec<tracepilot_orchestrator::RegisteredRepo>> {
    Ok(tokio::task::spawn_blocking(
        tracepilot_orchestrator::repo_registry::list_registered_repos,
    )
    .await??)
}

#[tauri::command]
pub async fn add_registered_repo(
    path: String,
) -> CmdResult<tracepilot_orchestrator::RegisteredRepo> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::repo_registry::add_repo(
            &path,
            tracepilot_orchestrator::RepoSource::Manual,
        )
    })
    .await??)
}

#[tauri::command]
pub async fn remove_registered_repo(path: String) -> CmdResult<()> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::repo_registry::remove_repo(&path)
    })
    .await??)
}

#[tauri::command]
pub async fn toggle_repo_favourite(path: String) -> CmdResult<bool> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::repo_registry::toggle_repo_favourite(&path)
    })
    .await??)
}

#[tauri::command]
pub async fn discover_repos_from_sessions(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<tracepilot_orchestrator::RegisteredRepo>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    let cwds = tokio::task::spawn_blocking(move || -> CmdResult<Vec<String>> {
        if !index_path.exists() {
            return Ok(Vec::new());
        }
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        Ok(db.distinct_session_cwds()?)
    })
    .await??;

    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::repo_registry::discover_repos_from_sessions(&cwds)
    })
    .await??)
}

// -- Launcher commands --

#[tauri::command]
pub async fn launch_session(
    config: tracepilot_orchestrator::LaunchConfig,
) -> CmdResult<tracepilot_orchestrator::LaunchedSession> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::launcher::launch_session(&config)
    })
    .await??)
}

#[tauri::command]
pub async fn get_available_models() -> CmdResult<Vec<tracepilot_orchestrator::ModelInfo>> {
    Ok(tracepilot_orchestrator::launcher::available_models())
}

#[tauri::command]
pub async fn open_in_explorer(path: String) -> CmdResult<()> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::launcher::open_in_explorer(&path)
    })
    .await??)
}

#[tauri::command]
pub async fn open_in_terminal(path: String) -> CmdResult<()> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::launcher::open_in_terminal(&path)
    })
    .await??)
}
