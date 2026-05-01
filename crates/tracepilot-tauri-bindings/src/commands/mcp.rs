//! MCP Tauri commands (11 commands).

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::read_config;
use std::collections::HashMap;

// -- Server CRUD --

#[tauri::command]
#[tracing::instrument(level = "debug", skip(state), err)]
pub async fn mcp_list_servers(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<(String, tracepilot_orchestrator::mcp::types::McpServerConfig)>> {
    let home = read_config(&state).copilot_home();
    blocking_cmd!(tracepilot_orchestrator::mcp::config::list_servers_in(&home))
}

#[tauri::command]
#[tracing::instrument(level = "debug", skip(state), err, fields(server = %name))]
pub async fn mcp_get_server(
    state: tauri::State<'_, SharedConfig>,
    name: String,
) -> CmdResult<tracepilot_orchestrator::mcp::types::McpServerConfig> {
    let home = read_config(&state).copilot_home();
    blocking_cmd!(tracepilot_orchestrator::mcp::config::get_server_in(
        &home, &name
    ))
}

#[tauri::command]
#[tracing::instrument(skip(state, config), err, fields(server = %name))]
pub async fn mcp_add_server(
    state: tauri::State<'_, SharedConfig>,
    name: String,
    config: tracepilot_orchestrator::mcp::types::McpServerConfig,
) -> CmdResult<()> {
    let home = read_config(&state).copilot_home();
    blocking_cmd!(tracepilot_orchestrator::mcp::config::add_server_in(
        &home, &name, config
    ))
}

#[tauri::command]
#[tracing::instrument(skip(state, config), err, fields(server = %name))]
pub async fn mcp_update_server(
    state: tauri::State<'_, SharedConfig>,
    name: String,
    config: tracepilot_orchestrator::mcp::types::McpServerConfig,
) -> CmdResult<()> {
    let home = read_config(&state).copilot_home();
    blocking_cmd!(tracepilot_orchestrator::mcp::config::update_server_in(
        &home, &name, config
    ))
}

#[tauri::command]
#[tracing::instrument(skip(state), err, fields(server = %name))]
pub async fn mcp_remove_server(
    state: tauri::State<'_, SharedConfig>,
    name: String,
) -> CmdResult<tracepilot_orchestrator::mcp::types::McpServerConfig> {
    let home = read_config(&state).copilot_home();
    blocking_cmd!(tracepilot_orchestrator::mcp::config::remove_server_in(
        &home, &name
    ))
}

#[tauri::command]
#[tracing::instrument(skip(state), err, fields(server = %name))]
#[specta::specta]
pub async fn mcp_toggle_server(
    state: tauri::State<'_, SharedConfig>,
    name: String,
) -> CmdResult<bool> {
    let home = read_config(&state).copilot_home();
    blocking_cmd!(tracepilot_orchestrator::mcp::config::toggle_server_in(
        &home, &name
    ))
}

// -- Health checks --

#[tauri::command]
#[tracing::instrument(skip(state), err)]
pub async fn mcp_check_health(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<HashMap<String, tracepilot_orchestrator::mcp::health::McpHealthResultCached>> {
    let home = read_config(&state).copilot_home();
    let config = tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::mcp::config::load_config_in(&home)
    })
    .await??;

    let results =
        tracepilot_orchestrator::mcp::health::check_all_servers(&config.mcp_servers).await;
    Ok(results)
}

#[tauri::command]
#[tracing::instrument(skip(state), err, fields(server = %name))]
pub async fn mcp_check_server_health(
    state: tauri::State<'_, SharedConfig>,
    name: String,
) -> CmdResult<tracepilot_orchestrator::mcp::health::McpHealthResultCached> {
    let home = read_config(&state).copilot_home();
    let config = tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::mcp::config::get_server_in(&home, &name).map(|c| (name, c))
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
    blocking_cmd!(tracepilot_orchestrator::mcp::import::import_from_file(
        std::path::Path::new(&path),
    ))
}

#[tauri::command]
#[tracing::instrument(skip(path), err, fields(%owner, %repo, git_ref = git_ref.as_deref().unwrap_or("")))]
pub async fn mcp_import_from_github(
    owner: String,
    repo: String,
    path: Option<String>,
    git_ref: Option<String>,
) -> CmdResult<tracepilot_orchestrator::mcp::import::McpImportResult> {
    blocking_cmd!(tracepilot_orchestrator::mcp::import::import_from_github(
        &owner,
        &repo,
        path.as_deref(),
        git_ref.as_deref(),
    ))
}

// -- Diff --

#[tauri::command]
#[tracing::instrument(skip(state, incoming), err, fields(incoming_count = incoming.len()))]
pub async fn mcp_compute_diff(
    state: tauri::State<'_, SharedConfig>,
    incoming: HashMap<String, tracepilot_orchestrator::mcp::types::McpServerConfig>,
) -> CmdResult<tracepilot_orchestrator::mcp::diff::McpConfigDiff> {
    let home = read_config(&state).copilot_home();
    blocking_cmd!({
        let config = tracepilot_orchestrator::mcp::config::load_config_in(&home)?;
        Ok::<_, crate::error::BindingsError>(tracepilot_orchestrator::mcp::diff::compute_diff(
            &config.mcp_servers,
            &incoming,
        ))
    })
}
