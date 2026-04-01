//! MCP Tauri commands (11 commands).

use crate::error::CmdResult;
use crate::helpers::{spawn_blocking_infallible, spawn_blocking_orchestrator};
use std::collections::HashMap;
use tracepilot_orchestrator::OrchestratorError;

/// Helper to convert McpError to OrchestratorError inside spawn_blocking.
fn mcp<T>(r: Result<T, tracepilot_orchestrator::mcp::McpError>) -> Result<T, OrchestratorError> {
    r.map_err(OrchestratorError::from)
}

// -- Server CRUD --

#[tauri::command]
pub async fn mcp_list_servers(
) -> CmdResult<Vec<(String, tracepilot_orchestrator::mcp::types::McpServerConfig)>> {
    spawn_blocking_infallible(|| {
        tracepilot_orchestrator::mcp::config::list_servers()
    })
    .await
}

#[tauri::command]
pub async fn mcp_get_server(
    name: String,
) -> CmdResult<tracepilot_orchestrator::mcp::types::McpServerConfig> {
    spawn_blocking_orchestrator(move || {
        mcp(tracepilot_orchestrator::mcp::config::get_server(&name))
    })
    .await
}

#[tauri::command]
pub async fn mcp_add_server(
    name: String,
    config: tracepilot_orchestrator::mcp::types::McpServerConfig,
) -> CmdResult<()> {
    spawn_blocking_orchestrator(move || {
        mcp(tracepilot_orchestrator::mcp::config::add_server(&name, config))
    })
    .await
}

#[tauri::command]
pub async fn mcp_update_server(
    name: String,
    config: tracepilot_orchestrator::mcp::types::McpServerConfig,
) -> CmdResult<()> {
    spawn_blocking_orchestrator(move || {
        mcp(tracepilot_orchestrator::mcp::config::update_server(&name, config))
    })
    .await
}

#[tauri::command]
pub async fn mcp_remove_server(
    name: String,
) -> CmdResult<tracepilot_orchestrator::mcp::types::McpServerConfig> {
    spawn_blocking_orchestrator(move || {
        mcp(tracepilot_orchestrator::mcp::config::remove_server(&name))
    })
    .await
}

#[tauri::command]
pub async fn mcp_toggle_server(name: String) -> CmdResult<bool> {
    spawn_blocking_orchestrator(move || {
        mcp(tracepilot_orchestrator::mcp::config::toggle_server(&name))
    })
    .await
}

// -- Health checks --

#[tauri::command]
pub async fn mcp_check_health(
) -> CmdResult<HashMap<String, tracepilot_orchestrator::mcp::health::McpHealthResultCached>> {
    let config = spawn_blocking_infallible(|| {
        tracepilot_orchestrator::mcp::config::load_config()
    })
    .await?;

    let results =
        tracepilot_orchestrator::mcp::health::check_all_servers(&config.mcp_servers).await;
    Ok(results)
}

#[tauri::command]
pub async fn mcp_check_server_health(
    name: String,
) -> CmdResult<tracepilot_orchestrator::mcp::health::McpHealthResultCached> {
    let config = spawn_blocking_orchestrator(move || {
        mcp(tracepilot_orchestrator::mcp::config::get_server(&name)
            .map(|c| (name, c)))
    })
    .await?;

    let result = tracepilot_orchestrator::mcp::health::check_single_server(
        &config.0,
        &config.1,
    )
    .await;
    Ok(result)
}

// -- Import --

#[tauri::command]
pub async fn mcp_import_from_file(
    path: String,
) -> CmdResult<tracepilot_orchestrator::mcp::import::McpImportResult> {
    spawn_blocking_orchestrator(move || {
        mcp(tracepilot_orchestrator::mcp::import::import_from_file(
            std::path::Path::new(&path),
        ))
    })
    .await
}

#[tauri::command]
pub async fn mcp_import_from_github(
    owner: String,
    repo: String,
    path: Option<String>,
    git_ref: Option<String>,
) -> CmdResult<tracepilot_orchestrator::mcp::import::McpImportResult> {
    spawn_blocking_orchestrator(move || {
        mcp(tracepilot_orchestrator::mcp::import::import_from_github(
            &owner,
            &repo,
            path.as_deref(),
            git_ref.as_deref(),
        ))
    })
    .await
}

// -- Diff --

#[tauri::command]
pub async fn mcp_compute_diff(
    incoming: HashMap<String, tracepilot_orchestrator::mcp::types::McpServerConfig>,
) -> CmdResult<tracepilot_orchestrator::mcp::diff::McpConfigDiff> {
    spawn_blocking_orchestrator(move || {
        let config = tracepilot_orchestrator::mcp::config::load_config()?;
        Ok::<_, OrchestratorError>(
            tracepilot_orchestrator::mcp::diff::compute_diff(&config.mcp_servers, &incoming),
        )
    })
    .await
}
