//! State/system Tauri commands (6 commands).

use crate::config::SharedConfig;
use crate::helpers::{open_index_db, read_config};
use crate::types::{GitInfo, UpdateCheckResult};

#[tauri::command]
pub async fn get_db_size(
    state: tauri::State<'_, SharedConfig>,
) -> Result<u64, String> {
    let index_path = read_config(&state).index_db_path();

    tokio::task::spawn_blocking(move || {
        Ok(std::fs::metadata(&index_path)
            .map(|m| m.len())
            .unwrap_or(0))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Check if a session is currently running by looking for `inuse.*.lock` files.
#[tauri::command]
pub async fn is_session_running(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> Result<bool, String> {
    let session_state_dir = read_config(&state).session_state_dir();

    tokio::task::spawn_blocking(move || {
        let path = tracepilot_core::session::discovery::resolve_session_path_in(
            &session_id,
            &session_state_dir,
        )
        .map_err(|e| e.to_string())?;
        Ok(tracepilot_core::session::discovery::has_lock_file(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_session_count(
    state: tauri::State<'_, SharedConfig>,
) -> Result<usize, String> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let session_state_dir = cfg.session_state_dir();

    tokio::task::spawn_blocking(move || {
        if let Some(db) = open_index_db(&index_path) {
            if let Ok(count) = db.session_count() {
                return Ok(count);
            }
        }
        tracepilot_core::session::discovery::discover_sessions(&session_state_dir)
            .map(|s| s.len())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Returns the installation type: "source", "installed", or "portable".
#[tauri::command]
pub fn get_install_type() -> String {
    if cfg!(debug_assertions) {
        return "source".to_string();
    }
    if let Ok(exe) = std::env::current_exe() {
        let path = exe.to_string_lossy().to_lowercase();
        if path.contains("appdata") && path.contains("dev.tracepilot.app") {
            return "installed".to_string();
        }
    }
    "portable".to_string()
}

#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateCheckResult, String> {
    let current_str = env!("CARGO_PKG_VERSION");
    let current = semver::Version::parse(current_str).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .user_agent(format!("TracePilot/{current_str}"))
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get("https://api.github.com/repos/MattShelton04/TracePilot/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    match response.status().as_u16() {
        404 => {
            return Ok(UpdateCheckResult {
                current_version: current_str.to_string(),
                latest_version: None,
                has_update: false,
                release_url: None,
                published_at: None,
            })
        }
        429 | 403 => {
            return Err("GitHub API rate limit reached. Try again later.".into())
        }
        s if s >= 500 => return Err(format!("GitHub API error: HTTP {s}")),
        _ => {}
    }

    let release: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {e}"))?;

    let latest_str = release["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v');

    let has_update = semver::Version::parse(latest_str)
        .map(|latest| latest > current)
        .unwrap_or(false);

    Ok(UpdateCheckResult {
        current_version: current_str.to_string(),
        latest_version: Some(latest_str.to_string()),
        has_update,
        release_url: release["html_url"].as_str().map(String::from),
        published_at: release["published_at"].as_str().map(String::from),
    })
}

#[tauri::command]
pub async fn get_git_info() -> GitInfo {
    let run = |args: &[&str]| -> Option<String> {
        tracepilot_orchestrator::process::run_hidden("git", args, None)
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    GitInfo {
        commit_hash: run(&["rev-parse", "--short", "HEAD"]),
        branch: run(&["rev-parse", "--abbrev-ref", "HEAD"]),
    }
}
