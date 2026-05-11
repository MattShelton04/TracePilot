//! Orchestration Tauri commands (22 commands).

use crate::blocking_cmd;
use tracepilot_core::utils::cache::TtlCache;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{read_config, validate_path_within_any};
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Duration;
use tauri::Manager;

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
pub async fn list_registered_repos(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<tracepilot_orchestrator::RegisteredRepo>> {
    let tracepilot_home = read_config(&state).tracepilot_home();
    blocking_cmd!(
        tracepilot_orchestrator::repo_registry::list_registered_repos_in(&tracepilot_home)
    )
}

#[tauri::command]
#[tracing::instrument(skip(path), err)]
pub async fn add_registered_repo(
    state: tauri::State<'_, SharedConfig>,
    path: String,
) -> CmdResult<tracepilot_orchestrator::RegisteredRepo> {
    let tracepilot_home = read_config(&state).tracepilot_home();
    blocking_cmd!(tracepilot_orchestrator::repo_registry::add_repo_in(
        &tracepilot_home,
        &path,
        tracepilot_orchestrator::RepoSource::Manual,
    ))
}

#[tauri::command]
#[tracing::instrument(skip(path), err)]
pub async fn remove_registered_repo(
    state: tauri::State<'_, SharedConfig>,
    path: String,
) -> CmdResult<()> {
    let tracepilot_home = read_config(&state).tracepilot_home();
    blocking_cmd!(tracepilot_orchestrator::repo_registry::remove_repo_in(
        &tracepilot_home,
        &path
    ))
}

#[tauri::command]
#[tracing::instrument(skip(path), err)]
pub async fn toggle_repo_favourite(
    state: tauri::State<'_, SharedConfig>,
    path: String,
) -> CmdResult<bool> {
    let tracepilot_home = read_config(&state).tracepilot_home();
    blocking_cmd!(
        tracepilot_orchestrator::repo_registry::toggle_repo_favourite_in(&tracepilot_home, &path)
    )
}

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn discover_repos_from_sessions(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<tracepilot_orchestrator::RegisteredRepo>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let tracepilot_home = cfg.tracepilot_home();

    let cwds = tokio::task::spawn_blocking(move || -> CmdResult<Vec<String>> {
        if !index_path.exists() {
            Ok(Vec::new())
        } else {
            let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
            Ok(db.distinct_session_cwds()?)
        }
    })
    .await??;

    blocking_cmd!(
        tracepilot_orchestrator::repo_registry::discover_repos_from_sessions_in(
            &tracepilot_home,
            &cwds,
        )
    )
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
#[tracing::instrument(skip(state, app), err)]
pub async fn open_in_explorer(
    state: tauri::State<'_, SharedConfig>,
    app: tauri::AppHandle,
    path: String,
) -> CmdResult<()> {
    let validated = resolve_opener_path(&state, &app, &path)?;
    blocking_cmd!(tracepilot_orchestrator::launcher::open_in_explorer(
        &validated.to_string_lossy()
    ))
}

#[tauri::command]
#[tracing::instrument(skip(state, app), err)]
pub async fn open_in_terminal(
    state: tauri::State<'_, SharedConfig>,
    app: tauri::AppHandle,
    path: String,
) -> CmdResult<()> {
    let validated = resolve_opener_path(&state, &app, &path)?;
    blocking_cmd!(tracepilot_orchestrator::launcher::open_in_terminal(
        &validated.to_string_lossy()
    ))
}

/// Build the allowlist of trusted roots for the OS-opener commands and
/// validate that `path` resolves to a location within one of them.
///
/// Allowed roots:
/// - `session_state_dir`, `tracepilot_home`, `copilot_home` (config-derived)
/// - The Tauri app log directory (e.g. `getLogPath()` callers)
/// - Each registered repository path **and** its parent directory — the parent
///   covers worktrees that `git worktree add` places as siblings of the repo
///   (the default layout used by [`tracepilot_orchestrator::worktrees`]).
///
/// Rejects (via [`validate_path_within_any`]):
/// - Empty / non-existent paths
/// - Paths whose canonical form is outside every allowed root (covers `..`
///   traversal and symlink escapes)
fn resolve_opener_path(
    state: &tauri::State<'_, SharedConfig>,
    app: &tauri::AppHandle,
    path: &str,
) -> CmdResult<PathBuf> {
    let cfg = read_config(state);
    let mut roots: Vec<PathBuf> = vec![
        cfg.session_state_dir(),
        cfg.tracepilot_home(),
        cfg.copilot_home(),
    ];

    if let Ok(log_dir) = app.path().app_log_dir() {
        roots.push(log_dir);
    }

    let tracepilot_home = cfg.tracepilot_home();
    if let Ok(repos) =
        tracepilot_orchestrator::repo_registry::list_registered_repos_in(&tracepilot_home)
    {
        for repo in repos {
            let repo_path = PathBuf::from(&repo.path);
            if let Some(parent) = repo_path.parent() {
                roots.push(parent.to_path_buf());
            }
            roots.push(repo_path);
        }
    }

    validate_path_within_any(path, &roots).map_err(|e| match e {
        BindingsError::Validation(msg) => {
            BindingsError::Validation(format!("Refusing to open path '{path}': {msg}"))
        }
        other => other,
    })
}
