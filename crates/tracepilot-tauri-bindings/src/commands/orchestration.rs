//! Orchestration Tauri commands (22 commands).

use crate::config::SharedConfig;
use crate::helpers::read_config;

#[tauri::command]
pub async fn check_system_deps() -> Result<tracepilot_orchestrator::SystemDependencies, String> {
    Ok(tokio::task::spawn_blocking(tracepilot_orchestrator::launcher::check_dependencies)
        .await
        .map_err(|e| e.to_string())?)
}

// -- Worktree commands --

#[tauri::command]
pub async fn list_worktrees(
    repo_path: String,
) -> Result<Vec<tracepilot_orchestrator::WorktreeInfo>, String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::list_worktrees(std::path::Path::new(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_worktree(
    request: tracepilot_orchestrator::CreateWorktreeRequest,
) -> Result<tracepilot_orchestrator::WorktreeInfo, String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::create_worktree(&request)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::remove_worktree(
            std::path::Path::new(&repo_path),
            std::path::Path::new(&worktree_path),
            force,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prune_worktrees(
    repo_path: String,
) -> Result<tracepilot_orchestrator::PruneResult, String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::prune_worktrees(std::path::Path::new(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_branches(repo_path: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::list_branches(std::path::Path::new(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_worktree_disk_usage(path: String) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::disk_usage_bytes(std::path::Path::new(&path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn is_git_repo(path: String) -> Result<bool, String> {
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::is_git_repo(std::path::Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn lock_worktree(
    repo_path: String,
    worktree_path: String,
    reason: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::lock_worktree(
            std::path::Path::new(&repo_path),
            std::path::Path::new(&worktree_path),
            reason.as_deref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn unlock_worktree(
    repo_path: String,
    worktree_path: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::unlock_worktree(
            std::path::Path::new(&repo_path),
            std::path::Path::new(&worktree_path),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_worktree_details(
    worktree_path: String,
) -> Result<tracepilot_orchestrator::WorktreeDetails, String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::get_worktree_details(
            std::path::Path::new(&worktree_path),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_default_branch(repo_path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::get_default_branch(
            std::path::Path::new(&repo_path),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fetch_remote(
    repo_path: String,
    branch: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::worktrees::fetch_remote(
            std::path::Path::new(&repo_path),
            branch.as_deref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// -- Repository Registry commands --

#[tauri::command]
pub async fn list_registered_repos(
) -> Result<Vec<tracepilot_orchestrator::RegisteredRepo>, String> {
    tokio::task::spawn_blocking(
        tracepilot_orchestrator::repo_registry::list_registered_repos,
    )
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_registered_repo(
    path: String,
) -> Result<tracepilot_orchestrator::RegisteredRepo, String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::repo_registry::add_repo(
            &path,
            tracepilot_orchestrator::RepoSource::Manual,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remove_registered_repo(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::repo_registry::remove_repo(&path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toggle_repo_favourite(path: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::repo_registry::toggle_repo_favourite(&path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn discover_repos_from_sessions(
    state: tauri::State<'_, SharedConfig>,
) -> Result<Vec<tracepilot_orchestrator::RegisteredRepo>, String> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    let cwds = tokio::task::spawn_blocking(move || -> Result<Vec<String>, String> {
        if !index_path.exists() {
            return Ok(Vec::new());
        }
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)
            .map_err(|e| e.to_string())?;
        db.distinct_session_cwds().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::repo_registry::discover_repos_from_sessions(&cwds)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// -- Launcher commands --

#[tauri::command]
pub async fn launch_session(
    config: tracepilot_orchestrator::LaunchConfig,
) -> Result<tracepilot_orchestrator::LaunchedSession, String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::launcher::launch_session(&config)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_available_models() -> Result<Vec<tracepilot_orchestrator::ModelInfo>, String> {
    Ok(tracepilot_orchestrator::launcher::available_models())
}

#[tauri::command]
pub async fn open_in_explorer(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::launcher::open_in_explorer(&path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_in_terminal(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::launcher::open_in_terminal(&path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
