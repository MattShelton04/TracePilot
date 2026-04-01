//! MCP server configuration management.
//!
//! Manages the `mcp-config.json` configuration file in the Copilot home directory.
//! Supports reading, adding, updating, removing, and toggling MCP servers.

use crate::json_io::{atomic_json_read, atomic_json_write};
use crate::launcher::copilot_home;
use crate::mcp::error::McpError;
use crate::mcp::types::{McpServerConfig, McpServerDetail, McpSummary};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
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
    Ok(copilot_home()?.join("mcp-config.json"))
}

/// Load the MCP configuration from disk.
pub fn load_config() -> crate::error::Result<McpConfigFile> {
    let path = mcp_config_path()?;
    atomic_json_read(&path)
}

/// Save the MCP configuration to disk atomically (caller must hold CONFIG_LOCK).
fn save_config_unlocked(config: &McpConfigFile) -> crate::error::Result<()> {
    let path = mcp_config_path()?;
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
    let mut config = load_config().map_err(|e| McpError::Config(e.to_string()))?;
    let result = f(&mut config)?;
    save_config_unlocked(&config).map_err(|e| McpError::Config(e.to_string()))?;
    Ok(result)
}

/// List all servers with their configurations.
pub fn list_servers() -> crate::error::Result<Vec<(String, McpServerConfig)>> {
    let config = load_config()?;
    let mut servers: Vec<_> = config.mcp_servers.into_iter().collect();
    servers.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(servers)
}

/// Get a single server by name.
pub fn get_server(name: &str) -> Result<McpServerConfig, McpError> {
    let config = load_config().map_err(|e| McpError::Config(e.to_string()))?;
    config
        .mcp_servers
        .get(name)
        .cloned()
        .ok_or_else(|| McpError::ServerNotFound(name.to_string()))
}

/// Add a new server. Returns error if name already exists.
pub fn add_server(name: &str, server: McpServerConfig) -> Result<(), McpError> {
    with_config_mut(|config| {
        if config.mcp_servers.contains_key(name) {
            return Err(McpError::DuplicateServer(name.to_string()));
        }
        config.mcp_servers.insert(name.to_string(), server);
        Ok(())
    })
}

/// Update an existing server. Returns error if name doesn't exist.
pub fn update_server(name: &str, server: McpServerConfig) -> Result<(), McpError> {
    with_config_mut(|config| {
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

    for (name, _server) in &config.mcp_servers {
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
    for (name, _server) in &config.mcp_servers {
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

    let tools = cached
        .map(|c| c.tools.clone())
        .unwrap_or_default();

    let total_tokens: u32 = tools.iter().map(|t| t.estimate_tokens()).sum();

    Ok(McpServerDetail {
        name: name.to_string(),
        config: config_entry,
        health: cached.map(|c| c.result.clone()),
        tools,
        total_tokens,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::types::McpServerConfig;
    use std::collections::HashMap;
    use tempfile::TempDir;

    fn setup_test_config(dir: &TempDir) -> PathBuf {
        let path = dir.path().join("mcp-config.json");
        let config = McpConfigFile {
            mcp_servers: HashMap::from([
                (
                    "test-server".to_string(),
                    McpServerConfig {
                        command: Some("npx".into()),
                        args: vec!["-y".into(), "@mcp/test".into()],
                        env: HashMap::new(),
                        url: None,
                        transport: None,
                        headers: HashMap::new(),
                        tools: vec![],
                        description: Some("Test MCP server".into()),
                        tags: vec!["test".into()],
                        enabled: true,
                    },
                ),
                (
                    "disabled-server".to_string(),
                    McpServerConfig {
                        command: Some("node".into()),
                        args: vec!["server.js".into()],
                        env: HashMap::new(),
                        url: None,
                        transport: None,
                        headers: HashMap::new(),
                        tools: vec![],
                        description: None,
                        tags: vec![],
                        enabled: false,
                    },
                ),
            ]),
        };
        atomic_json_write(&path, &config).unwrap();
        path
    }

    #[test]
    fn config_round_trip() {
        let dir = TempDir::new().unwrap();
        let path = setup_test_config(&dir);
        let loaded: McpConfigFile = atomic_json_read(&path).unwrap();
        assert_eq!(loaded.mcp_servers.len(), 2);
        assert!(loaded.mcp_servers.contains_key("test-server"));
    }

    #[test]
    fn empty_config_deserializes_to_default() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("empty.json");
        let config: McpConfigFile = atomic_json_read(&path).unwrap();
        assert!(config.mcp_servers.is_empty());
    }

    #[test]
    fn server_config_preserves_env_vars() {
        let mut env = HashMap::new();
        env.insert("API_KEY".into(), "test-key".into());
        env.insert("DEBUG".into(), "true".into());

        let cfg = McpServerConfig {
            command: Some("cmd".into()),
            args: vec![],
            env,
            url: None,
            transport: None,
            headers: HashMap::new(),
            tools: vec![],
            description: None,
            tags: vec![],
            enabled: true,
        };

        let json = serde_json::to_string(&cfg).unwrap();
        let parsed: McpServerConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.env.get("API_KEY").unwrap(), "test-key");
        assert_eq!(parsed.env.get("DEBUG").unwrap(), "true");
    }
}
