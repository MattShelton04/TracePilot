//! Analytics Tauri commands (3 commands).

use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::{open_index_db, read_config};

#[tauri::command]
pub async fn get_analytics(
    state: tauri::State<'_, SharedConfig>,
    from_date: Option<String>,
    to_date: Option<String>,
    repo: Option<String>,
    hide_empty: Option<bool>,
) -> CmdResult<tracepilot_core::analytics::AnalyticsData> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let session_state_dir = cfg.session_state_dir();

    tokio::task::spawn_blocking(move || {
        if let Some(db) = open_index_db(&index_path) {
            match db.query_analytics(
                from_date.as_deref(),
                to_date.as_deref(),
                repo.as_deref(),
                hide_empty.unwrap_or(false),
            ) {
                Ok(result) => return Ok(result),
                Err(e) => tracing::warn!("Analytics SQL fast path failed, falling back to disk scan: {e}"),
            }
        }

        let inputs = tracepilot_core::analytics::load_full_sessions_filtered(
            &session_state_dir,
            from_date.as_deref(),
            to_date.as_deref(),
            repo.as_deref(),
            hide_empty.unwrap_or(false),
        )?;
        Ok(tracepilot_core::analytics::compute_analytics(&inputs))
    })
    .await?
}

#[tauri::command]
pub async fn get_tool_analysis(
    state: tauri::State<'_, SharedConfig>,
    from_date: Option<String>,
    to_date: Option<String>,
    repo: Option<String>,
    hide_empty: Option<bool>,
) -> CmdResult<tracepilot_core::analytics::ToolAnalysisData> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let session_state_dir = cfg.session_state_dir();

    tokio::task::spawn_blocking(move || {
        if let Some(db) = open_index_db(&index_path) {
            match db.query_tool_analysis(
                from_date.as_deref(),
                to_date.as_deref(),
                repo.as_deref(),
                hide_empty.unwrap_or(false),
            ) {
                Ok(result) => return Ok(result),
                Err(e) => tracing::warn!("Tool analysis SQL fast path failed, falling back to disk scan: {e}"),
            }
        }

        let inputs = tracepilot_core::analytics::load_full_sessions_filtered(
            &session_state_dir,
            from_date.as_deref(),
            to_date.as_deref(),
            repo.as_deref(),
            hide_empty.unwrap_or(false),
        )?;
        Ok(tracepilot_core::analytics::compute_tool_analysis(&inputs))
    })
    .await?
}

#[tauri::command]
pub async fn get_code_impact(
    state: tauri::State<'_, SharedConfig>,
    from_date: Option<String>,
    to_date: Option<String>,
    repo: Option<String>,
    hide_empty: Option<bool>,
) -> CmdResult<tracepilot_core::analytics::CodeImpactData> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let session_state_dir = cfg.session_state_dir();

    tokio::task::spawn_blocking(move || {
        if let Some(db) = open_index_db(&index_path) {
            match db.query_code_impact(
                from_date.as_deref(),
                to_date.as_deref(),
                repo.as_deref(),
                hide_empty.unwrap_or(false),
            ) {
                Ok(result) => return Ok(result),
                Err(e) => tracing::warn!("Code impact SQL fast path failed, falling back to disk scan: {e}"),
            }
        }

        let inputs = tracepilot_core::analytics::load_session_summaries_filtered(
            &session_state_dir,
            from_date.as_deref(),
            to_date.as_deref(),
            repo.as_deref(),
            hide_empty.unwrap_or(false),
        )?;
        Ok(tracepilot_core::analytics::compute_code_impact(&inputs))
    })
    .await?
}
