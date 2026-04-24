//! MCP Tauri commands (11 commands).

use crate::blocking_cmd;
use crate::error::CmdResult;
use std::collections::HashMap;
use tracepilot_orchestrator::OrchestratorError;

/// Helper to convert McpError to OrchestratorError inside spawn_blocking.
fn mcp<T>(r: Result<T, tracepilot_orchestrator::mcp::McpError>) -> Result<T, OrchestratorError> {
    r.map_err(OrchestratorError::from)
}

// -- Server CRUD --

#[tauri::command]
#[tracing::instrument(level = "debug", err)]
pub async fn mcp_list_servers()
-> CmdResult<Vec<(String, tracepilot_orchestrator::mcp::types::McpServerConfig)>> {
    blocking_cmd!(tracepilot_orchestrator::mcp::config::list_servers())
}

#[tauri::command]
#[tracing::instrument(level = "debug", err, fields(server = %name))]
pub async fn mcp_get_server(
    name: String,
) -> CmdResult<tracepilot_orchestrator::mcp::types::McpServerConfig> {
    blocking_cmd!(mcp(tracepilot_orchestrator::mcp::config::get_server(&name)))
}

#[tauri::command]
#[tracing::instrument(skip(config), err, fields(server = %name))]
pub async fn mcp_add_server(
    name: String,
    config: tracepilot_orchestrator::mcp::types::McpServerConfig,
) -> CmdResult<()> {
    blocking_cmd!(mcp(tracepilot_orchestrator::mcp::config::add_server(
        &name, config
    )))
}

#[tauri::command]
#[tracing::instrument(skip(config), err, fields(server = %name))]
pub async fn mcp_update_server(
    name: String,
    config: tracepilot_orchestrator::mcp::types::McpServerConfig,
) -> CmdResult<()> {
    blocking_cmd!(mcp(tracepilot_orchestrator::mcp::config::update_server(
        &name, config
    )))
}

#[tauri::command]
#[tracing::instrument(err, fields(server = %name))]
pub async fn mcp_remove_server(
    name: String,
) -> CmdResult<tracepilot_orchestrator::mcp::types::McpServerConfig> {
    blocking_cmd!(mcp(tracepilot_orchestrator::mcp::config::remove_server(
        &name
    )))
}

#[tauri::command]
#[tracing::instrument(err, fields(server = %name))]
#[specta::specta]
pub async fn mcp_toggle_server(name: String) -> CmdResult<bool> {
    blocking_cmd!(mcp(tracepilot_orchestrator::mcp::config::toggle_server(
        &name
    )))
}

// -- Health checks --

#[tauri::command]
#[tracing::instrument(err)]
pub async fn mcp_check_health()
-> CmdResult<HashMap<String, tracepilot_orchestrator::mcp::health::McpHealthResultCached>> {
    let config =
        tokio::task::spawn_blocking(tracepilot_orchestrator::mcp::config::load_config).await??;

    let results =
        tracepilot_orchestrator::mcp::health::check_all_servers(&config.mcp_servers).await;
    Ok(results)
}

#[tauri::command]
#[tracing::instrument(err, fields(server = %name))]
pub async fn mcp_check_server_health(
    name: String,
) -> CmdResult<tracepilot_orchestrator::mcp::health::McpHealthResultCached> {
    let config = tokio::task::spawn_blocking(move || {
        mcp(tracepilot_orchestrator::mcp::config::get_server(&name).map(|c| (name, c)))
    })
    .await??;

    let result =
        tracepilot_orchestrator::mcp::health::check_single_server(&config.0, &config.1).await;
    Ok(result)
}

// -- Import --

#[tauri::command]
#[tracing::instrument(skip(path), err, fields(path_len = path.len()))]
pub async fn mcp_import_from_file(
    path: String,
) -> CmdResult<tracepilot_orchestrator::mcp::import::McpImportResult> {
    blocking_cmd!(mcp(tracepilot_orchestrator::mcp::import::import_from_file(
        std::path::Path::new(&path),
    )))
}

#[tauri::command]
#[tracing::instrument(skip(path), err, fields(%owner, %repo, git_ref = git_ref.as_deref().unwrap_or("")))]
pub async fn mcp_import_from_github(
    owner: String,
    repo: String,
    path: Option<String>,
    git_ref: Option<String>,
) -> CmdResult<tracepilot_orchestrator::mcp::import::McpImportResult> {
    blocking_cmd!(mcp(
        tracepilot_orchestrator::mcp::import::import_from_github(
            &owner,
            &repo,
            path.as_deref(),
            git_ref.as_deref(),
        )
    ))
}

// -- Diff --

#[tauri::command]
#[tracing::instrument(skip(incoming), err, fields(incoming_count = incoming.len()))]
pub async fn mcp_compute_diff(
    incoming: HashMap<String, tracepilot_orchestrator::mcp::types::McpServerConfig>,
) -> CmdResult<tracepilot_orchestrator::mcp::diff::McpConfigDiff> {
    blocking_cmd!({
        let config = tracepilot_orchestrator::mcp::config::load_config()?;
        Ok::<_, OrchestratorError>(tracepilot_orchestrator::mcp::diff::compute_diff(
            &config.mcp_servers,
            &incoming,
        ))
    })
}
