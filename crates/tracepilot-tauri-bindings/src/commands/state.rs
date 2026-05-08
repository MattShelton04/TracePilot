//! State/system Tauri commands (6 commands).
//!
//! Thin shells over `crate::services::{app_info, update}` and the existing
//! helpers — the orchestration / pure logic lives in the service layer.

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{open_index_db, read_config, with_session_path};
use crate::services;
use crate::types::{GitInfo, UpdateCheckResult};

#[tauri::command]
#[specta::specta]
pub async fn get_db_size(state: tauri::State<'_, SharedConfig>) -> CmdResult<u64> {
    let index_path = read_config(&state).index_db_path();

    blocking_cmd!({
        Ok::<_, BindingsError>(std::fs::metadata(&index_path).map(|m| m.len()).unwrap_or(0))
    })
}

/// Check if a session is currently running by looking for `inuse.*.lock` files.
#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(session_id = %session_id))]
#[specta::specta]
pub async fn is_session_running(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<bool> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_path(&state, sid, |path| {
        Ok(tracepilot_core::session::discovery::has_lock_file(&path))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn get_session_count(state: tauri::State<'_, SharedConfig>) -> CmdResult<usize> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let session_state_dir = cfg.session_state_dir();

    blocking_cmd!({
        if let Some(opened) = open_index_db(&index_path) {
            return Ok(opened.session_count);
        }
        Ok::<_, BindingsError>(
            tracepilot_core::session::discovery::discover_sessions(&session_state_dir)?.len(),
        )
    })
}

/// Returns the installation type: "source", "installed", or "portable".
#[tauri::command]
#[specta::specta]
pub fn get_install_type() -> String {
    services::app_info::get_install_type_string()
}

#[tauri::command]
#[specta::specta]
pub async fn check_for_updates() -> CmdResult<UpdateCheckResult> {
    services::update::check_for_updates_with_reqwest().await
}

#[tauri::command]
#[specta::specta]
pub async fn get_git_info() -> GitInfo {
    services::app_info::get_git_info().await
}
