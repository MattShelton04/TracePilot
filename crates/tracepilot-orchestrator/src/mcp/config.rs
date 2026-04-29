//! MCP server configuration management.
//!
//! Manages the `mcp-config.json` configuration file in the Copilot home directory.
//! Supports reading, adding, updating, removing, and toggling MCP servers.

use crate::json_io::{atomic_json_read, atomic_json_write};
use crate::mcp::error::McpError;
use crate::mcp::headers::validate_configured_http_headers;
use crate::mcp::types::{McpServerConfig, McpServerDetail, McpSummary};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Static mutex to serialize config file writes (mirrors repo_registry pattern).
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

/// The on-disk format for `mcp-config.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigFile {
    /// Primary key used by Copilot CLI. Also accepts `servers` (VS Code format) on read.
    #[serde(default, alias = "servers")]
    pub mcp_servers: HashMap<String, McpServerConfig>,
}

/// Get the path to the MCP config file (`~/.copilot/mcp-config.json`).
pub fn mcp_config_path() -> crate::error::Result<PathBuf> {
    mcp_config_path_in(&crate::launcher::copilot_home()?)
}

pub fn mcp_config_path_in(copilot_home: &Path) -> crate::error::Result<PathBuf> {
    Ok(tracepilot_core::paths::CopilotPaths::from_home(copilot_home).mcp_config_json())
}

/// Load the MCP configuration from disk.
pub fn load_config() -> crate::error::Result<McpConfigFile> {
    let path = mcp_config_path()?;
    atomic_json_read(&path)
}

pub fn load_config_in(copilot_home: &Path) -> crate::error::Result<McpConfigFile> {
    let path = mcp_config_path_in(copilot_home)?;
    atomic_json_read(&path)
}

/// Save the MCP configuration to disk atomically (caller must hold CONFIG_LOCK).
fn save_config_unlocked(config: &McpConfigFile) -> crate::error::Result<()> {
    let path = mcp_config_path()?;
    atomic_json_write(&path, config)
}

fn save_config_unlocked_in(
    copilot_home: &Path,
    config: &McpConfigFile,
) -> crate::error::Result<()> {
    let path = mcp_config_path_in(copilot_home)?;
    atomic_json_write(&path, config)
}

/// Save the MCP configuration to disk atomically.
pub fn save_config(config: &McpConfigFile) -> crate::error::Result<()> {
    let _lock = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    save_config_unlocked(config)
}

/// Execute a read-modify-write transaction under the config lock.
fn with_config_mut<F, T>(f: F) -> Result<T, McpError>
where
    F: FnOnce(&mut McpConfigFile) -> Result<T, McpError>,
{
    let _lock = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut config = load_config().map_err(McpError::from_orchestrator)?;
    let result = f(&mut config)?;
    save_config_unlocked(&config).map_err(McpError::from_orchestrator)?;
    Ok(result)
}

fn with_config_mut_in<F, T>(copilot_home: &Path, f: F) -> Result<T, McpError>
where
    F: FnOnce(&mut McpConfigFile) -> Result<T, McpError>,
{
    let _lock = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut config = load_config_in(copilot_home).map_err(McpError::from_orchestrator)?;
    let result = f(&mut config)?;
    save_config_unlocked_in(copilot_home, &config).map_err(McpError::from_orchestrator)?;
    Ok(result)
}

/// List all servers with their configurations.
pub fn list_servers() -> crate::error::Result<Vec<(String, McpServerConfig)>> {
    let config = load_config()?;
    servers_from_config(config)
}

pub fn list_servers_in(
    copilot_home: &Path,
) -> crate::error::Result<Vec<(String, McpServerConfig)>> {
    let config = load_config_in(copilot_home)?;
    servers_from_config(config)
}

fn servers_from_config(
    config: McpConfigFile,
) -> crate::error::Result<Vec<(String, McpServerConfig)>> {
    let mut servers: Vec<_> = config.mcp_servers.into_iter().collect();
    servers.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(servers)
}

/// Get a single server by name.
pub fn get_server(name: &str) -> Result<McpServerConfig, McpError> {
    let config = load_config().map_err(McpError::from_orchestrator)?;
    get_server_from_config(config, name)
}

pub fn get_server_in(copilot_home: &Path, name: &str) -> Result<McpServerConfig, McpError> {
    let config = load_config_in(copilot_home).map_err(McpError::from_orchestrator)?;
    get_server_from_config(config, name)
}

fn get_server_from_config(config: McpConfigFile, name: &str) -> Result<McpServerConfig, McpError> {
    config
        .mcp_servers
        .get(name)
        .cloned()
        .ok_or_else(|| McpError::ServerNotFound(name.to_string()))
}

/// Add a new server. Returns error if name already exists.
pub fn add_server(name: &str, server: McpServerConfig) -> Result<(), McpError> {
    validate_configured_http_headers(&server.headers)?;
    with_config_mut(|config| {
        if config.mcp_servers.contains_key(name) {
            return Err(McpError::DuplicateServer(name.to_string()));
        }
        config.mcp_servers.insert(name.to_string(), server);
        Ok(())
    })
}

pub fn add_server_in(
    copilot_home: &Path,
    name: &str,
    server: McpServerConfig,
) -> Result<(), McpError> {
    validate_configured_http_headers(&server.headers)?;
    with_config_mut_in(copilot_home, |config| {
        if config.mcp_servers.contains_key(name) {
            return Err(McpError::DuplicateServer(name.to_string()));
        }
        config.mcp_servers.insert(name.to_string(), server);
        Ok(())
    })
}

/// Update an existing server. Returns error if name doesn't exist.
pub fn update_server(name: &str, server: McpServerConfig) -> Result<(), McpError> {
    validate_configured_http_headers(&server.headers)?;
    with_config_mut(|config| {
        if !config.mcp_servers.contains_key(name) {
            return Err(McpError::ServerNotFound(name.to_string()));
        }
        config.mcp_servers.insert(name.to_string(), server);
        Ok(())
    })
}

pub fn update_server_in(
    copilot_home: &Path,
    name: &str,
    server: McpServerConfig,
) -> Result<(), McpError> {
    validate_configured_http_headers(&server.headers)?;
    with_config_mut_in(copilot_home, |config| {
        if !config.mcp_servers.contains_key(name) {
            return Err(McpError::ServerNotFound(name.to_string()));
        }
        config.mcp_servers.insert(name.to_string(), server);
        Ok(())
    })
}

/// Remove a server by name.
pub fn remove_server(name: &str) -> Result<McpServerConfig, McpError> {
    with_config_mut(|config| {
        config
            .mcp_servers
            .remove(name)
            .ok_or_else(|| McpError::ServerNotFound(name.to_string()))
    })
}

pub fn remove_server_in(copilot_home: &Path, name: &str) -> Result<McpServerConfig, McpError> {
    with_config_mut_in(copilot_home, |config| {
        config
            .mcp_servers
            .remove(name)
            .ok_or_else(|| McpError::ServerNotFound(name.to_string()))
    })
}

/// Toggle a server's enabled/disabled state.
pub fn toggle_server(name: &str) -> Result<bool, McpError> {
    with_config_mut(|config| {
        let server = config
            .mcp_servers
            .get_mut(name)
            .ok_or_else(|| McpError::ServerNotFound(name.to_string()))?;
        server.enabled = !server.enabled;
        Ok(server.enabled)
    })
}

pub fn toggle_server_in(copilot_home: &Path, name: &str) -> Result<bool, McpError> {
    with_config_mut_in(copilot_home, |config| {
        let server = config
            .mcp_servers
            .get_mut(name)
            .ok_or_else(|| McpError::ServerNotFound(name.to_string()))?;
        server.enabled = !server.enabled;
        Ok(server.enabled)
    })
}

/// Get a summary of all MCP servers (for dashboard display).
pub fn get_summary(
    health_results: &HashMap<String, super::health::McpHealthResultCached>,
) -> crate::error::Result<McpSummary> {
    let config = load_config()?;
    let total_servers = config.mcp_servers.len();
    let enabled_servers = config.mcp_servers.values().filter(|s| s.enabled).count();

    let mut healthy_servers = 0;
    let mut total_tools = 0;
    let mut total_tokens: u32 = 0;

    for name in config.mcp_servers.keys() {
        if let Some(cached) = health_results.get(name) {
            if cached.result.status == super::types::McpHealthStatus::Healthy {
                healthy_servers += 1;
            }
            if let Some(tc) = cached.result.tool_count {
                total_tools += tc;
            }
        }
    }

    // Estimate tokens from cached tool data (only for servers still in config)
    for name in config.mcp_servers.keys() {
        if let Some(cached) = health_results.get(name) {
            for tool in &cached.tools {
                total_tokens += tool.estimate_tokens();
            }
        }
    }

    Ok(McpSummary {
        total_servers,
        enabled_servers,
        healthy_servers,
        total_tools,
        total_tokens,
    })
}

/// Build the detail view for a single server.
pub fn get_server_detail(
    name: &str,
    health_cache: &HashMap<String, super::health::McpHealthResultCached>,
) -> Result<McpServerDetail, McpError> {
    let config_entry = get_server(name)?;
    let cached = health_cache.get(name);

    let tools = cached.map(|c| c.tools.clone()).unwrap_or_default();

    let total_tokens: u32 = tools.iter().map(|t| t.estimate_tokens()).sum();

    Ok(McpServerDetail {
        name: name.to_string(),
        config: config_entry,
        health: cached.map(|c| c.result.clone()),
        tools,
        total_tokens,
    })
}
