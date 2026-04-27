//! Orchestration Tauri commands (22 commands).

use crate::blocking_cmd;
use crate::cache::TtlCache;
use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::read_config;
use std::sync::LazyLock;
use std::time::Duration;

// ---------------------------------------------------------------------------
// check_system_deps TTL cache (P0 perf fix)
// ---------------------------------------------------------------------------

static SYSTEM_DEPS_CACHE: LazyLock<TtlCache<String, tracepilot_orchestrator::SystemDependencies>> =
    LazyLock::new(|| TtlCache::new(Duration::from_secs(60)));

#[tauri::command]
#[tracing::instrument(skip(state), level = "debug", err)]
pub async fn check_system_deps(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<tracepilot_orchestrator::SystemDependencies> {
    let config = read_config(&state);
    let cli_cmd = config.general.cli_command.clone();

    // Check cache first.
    if let Some(cached) = SYSTEM_DEPS_CACHE.get(&cli_cmd) {
        return Ok(cached);
    }

    // Cache miss — spawn blocking process checks.
    let cli_cmd_clone = cli_cmd.clone();
    let result = tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::launcher::check_dependencies(Some(&cli_cmd_clone))
    })
    .await?;

    // Store in cache.
    SYSTEM_DEPS_CACHE.insert(cli_cmd, result.clone());

    Ok(result)
}

// -- Worktree commands --

#[tauri::command]
#[tracing::instrument(skip(repo_path), err)]
pub async fn list_worktrees(
    repo_path: String,
) -> CmdResult<Vec<tracepilot_orchestrator::WorktreeInfo>> {
    blocking_cmd!(tracepilot_orchestrator::worktrees::list_worktrees(
        std::path::Path::new(&repo_path)
    ))
}

#[tauri::command]
#[tracing::instrument(skip(request), err)]
pub async fn create_worktree(
    request: tracepilot_orchestrator::CreateWorktreeRequest,
) -> CmdResult<tracepilot_orchestrator::WorktreeInfo> {
    blocking_cmd!(tracepilot_orchestrator::worktrees::create_worktree(
        &request
    ))
}

#[tauri::command]
#[tracing::instrument(skip(repo_path, worktree_path), err, fields(force))]
pub async fn remove_worktree(
    repo_path: String,
    worktree_path: String,
    force: bool,
) -> CmdResult<()> {
    blocking_cmd!(tracepilot_orchestrator::worktrees::remove_worktree(
        std::path::Path::new(&repo_path),
        std::path::Path::new(&worktree_path),
        force,
    ))
}

#[tauri::command]
#[tracing::instrument(skip(repo_path), err)]
pub async fn prune_worktrees(repo_path: String) -> CmdResult<tracepilot_orchestrator::PruneResult> {
    blocking_cmd!(tracepilot_orchestrator::worktrees::prune_worktrees(
        std::path::Path::new(&repo_path)
    ))
}

#[tauri::command]
pub async fn list_branches(repo_path: String) -> CmdResult<Vec<String>> {
    blocking_cmd!(tracepilot_orchestrator::worktrees::list_branches(
        std::path::Path::new(&repo_path)
    ))
}

#[tauri::command]
pub async fn get_worktree_disk_usage(path: String) -> CmdResult<u64> {
    blocking_cmd!(tracepilot_orchestrator::worktrees::disk_usage_bytes(
        std::path::Path::new(&path)
    ))
}

#[tauri::command]
#[specta::specta]
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
    blocking_cmd!(tracepilot_orchestrator::worktrees::lock_worktree(
        std::path::Path::new(&repo_path),
        std::path::Path::new(&worktree_path),
        reason.as_deref(),
    ))
}

#[tauri::command]
pub async fn unlock_worktree(repo_path: String, worktree_path: String) -> CmdResult<()> {
    blocking_cmd!(tracepilot_orchestrator::worktrees::unlock_worktree(
        std::path::Path::new(&repo_path),
        std::path::Path::new(&worktree_path),
    ))
}

#[tauri::command]
pub async fn get_worktree_details(
    worktree_path: String,
) -> CmdResult<tracepilot_orchestrator::WorktreeDetails> {
    blocking_cmd!(tracepilot_orchestrator::worktrees::get_worktree_details(
        std::path::Path::new(&worktree_path),
    ))
}

#[tauri::command]
pub async fn get_default_branch(repo_path: String) -> CmdResult<String> {
    blocking_cmd!(tracepilot_orchestrator::worktrees::get_default_branch(
        std::path::Path::new(&repo_path)
    ))
}

#[tauri::command]
#[tracing::instrument(skip(repo_path, branch), err, fields(has_branch = branch.is_some()))]
pub async fn fetch_remote(repo_path: String, branch: Option<String>) -> CmdResult<String> {
    blocking_cmd!(tracepilot_orchestrator::worktrees::fetch_remote(
        std::path::Path::new(&repo_path),
        branch.as_deref(),
    ))
}

// -- Repository Registry commands --

#[tauri::command]
#[tracing::instrument(level = "debug", err)]
pub async fn list_registered_repos() -> CmdResult<Vec<tracepilot_orchestrator::RegisteredRepo>> {
    blocking_cmd!(tracepilot_orchestrator::repo_registry::list_registered_repos())
}

#[tauri::command]
#[tracing::instrument(skip(path), err)]
pub async fn add_registered_repo(
    path: String,
) -> CmdResult<tracepilot_orchestrator::RegisteredRepo> {
    blocking_cmd!(tracepilot_orchestrator::repo_registry::add_repo(
        &path,
        tracepilot_orchestrator::RepoSource::Manual,
    ))
}

#[tauri::command]
#[tracing::instrument(skip(path), err)]
pub async fn remove_registered_repo(path: String) -> CmdResult<()> {
    blocking_cmd!(tracepilot_orchestrator::repo_registry::remove_repo(&path))
}

#[tauri::command]
#[tracing::instrument(skip(path), err)]
pub async fn toggle_repo_favourite(path: String) -> CmdResult<bool> {
    blocking_cmd!(tracepilot_orchestrator::repo_registry::toggle_repo_favourite(&path))
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn discover_repos_from_sessions(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<tracepilot_orchestrator::RegisteredRepo>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    let cwds = tokio::task::spawn_blocking(move || -> CmdResult<Vec<String>> {
        if !index_path.exists() {
            Ok(Vec::new())
        } else {
            let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
            Ok(db.distinct_session_cwds()?)
        }
    })
    .await??;

    blocking_cmd!(tracepilot_orchestrator::repo_registry::discover_repos_from_sessions(&cwds))
}

// -- Launcher commands --

#[tauri::command]
#[tracing::instrument(skip(bridge, config), err)]
pub async fn launch_session(
    bridge: tauri::State<'_, tracepilot_orchestrator::bridge::manager::SharedBridgeManager>,
    config: tracepilot_orchestrator::LaunchConfig,
) -> CmdResult<tracepilot_orchestrator::LaunchedSession> {
    if config.launch_mode == tracepilot_orchestrator::LaunchMode::Sdk || config.headless {
        let mut mgr = bridge.write().await;
        return tracepilot_orchestrator::launcher::launch_sdk_session(&config, &mut mgr)
            .await
            .map_err(Into::into);
    }
    blocking_cmd!(tracepilot_orchestrator::launcher::launch_session(&config))
}

#[tauri::command]
pub async fn get_available_models() -> CmdResult<Vec<tracepilot_orchestrator::ModelInfo>> {
    Ok(tracepilot_orchestrator::launcher::available_models())
}

#[tauri::command]
pub async fn open_in_explorer(path: String) -> CmdResult<()> {
    blocking_cmd!(tracepilot_orchestrator::launcher::open_in_explorer(&path))
}

#[tauri::command]
pub async fn open_in_terminal(path: String) -> CmdResult<()> {
    blocking_cmd!(tracepilot_orchestrator::launcher::open_in_terminal(&path))
}
