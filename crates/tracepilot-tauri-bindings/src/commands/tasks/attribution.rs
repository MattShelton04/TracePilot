//! Task attribution command.
//!
//! Builds an attribution snapshot showing how a Copilot session relates
//! to orchestrated tasks.

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;

#[tauri::command]
pub async fn task_attribution(
    config: tauri::State<'_, SharedConfig>,
    session_path: String,
) -> CmdResult<tracepilot_orchestrator::task_attribution::AttributionSnapshot> {
    // Validate that the path is within the session state directory to prevent
    // arbitrary file system reads via path traversal.
    let cfg = read_config(&config);
    let session_state_dir = cfg.session_state_dir();
    let path = std::path::PathBuf::from(&session_path);
    let canonical_path = path
        .canonicalize()
        .map_err(|e| BindingsError::Validation(format!("Invalid session path: {e}")))?;
    let canonical_state = session_state_dir
        .canonicalize()
        .unwrap_or_else(|_| session_state_dir.clone());
    if !canonical_path.starts_with(&canonical_state) {
        return Err(BindingsError::Validation(
            "Session path must be within the session state directory".into(),
        ));
    }

    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::task_attribution::build_attribution_from_session(&canonical_path)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}
