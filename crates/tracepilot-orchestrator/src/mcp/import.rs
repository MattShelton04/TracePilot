//! MCP configuration import from external sources.
//!
//! Supports importing from:
//! - JSON files (MCP config format)
//! - Claude Desktop `claude_desktop_config.json`
//! - VS Code `settings.json` (under `mcp.servers` or `mcpServers`)
//! - Cursor `.cursor/mcp.json`
//! - GitHub repositories (via `gh` CLI)

use crate::mcp::error::McpError;
use crate::mcp::types::McpServerConfig;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

/// The source type for an MCP import operation.
#[derive(Debug, Clone)]
pub enum McpImportSource {
    /// A local JSON file path.
    File(String),
    /// A GitHub repository (owner/repo, optional path, optional ref).
    GitHub {
        owner: String,
        repo: String,
        path: Option<String>,
        git_ref: Option<String>,
    },
    /// Raw JSON text.
    RawJson(String),
}

/// Result of parsing an import source — servers found and any warnings.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpImportResult {
    pub servers: HashMap<String, McpServerConfig>,
    pub warnings: Vec<String>,
    pub source_label: String,
}

/// Import MCP servers from a file path.
///
/// Auto-detects the format based on file content:
/// - Direct MCP config (has `servers` or `mcpServers` key)
/// - Claude Desktop config (has `mcpServers` key)
/// - VS Code settings (has `mcp.servers` or `mcpServers` in settings)
pub fn import_from_file(path: &Path) -> Result<McpImportResult, McpError> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| McpError::import_ctx(format!("Failed to read {}", path.display()), e))?;

    let filename = path
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("unknown");

    import_from_json(&content, filename)
}

/// Import from raw JSON text with a source label.
pub fn import_from_json(json: &str, source_label: &str) -> Result<McpImportResult, McpError> {
    let value: Value = serde_json::from_str(json)?;
    parse_mcp_config(&value, source_label)
}

/// Parse MCP server configurations from a JSON value.
///
/// Handles multiple formats:
/// 1. `{ "servers": { ... } }` — standard MCP config
/// 2. `{ "mcpServers": { ... } }` — Claude Desktop format
/// 3. `{ "mcp": { "servers": { ... } } }` — VS Code settings
/// 4. Direct server map `{ "name": { "command": "..." } }` — flat format
fn parse_mcp_config(value: &Value, source_label: &str) -> Result<McpImportResult, McpError> {
    let mut warnings = Vec::new();

    // Try standard format: { servers: { ... } }
    if let Some(servers) = value.get("servers").and_then(|v| v.as_object()) {
        let parsed = parse_server_map(servers, &mut warnings);
        return Ok(McpImportResult {
            servers: parsed,
            warnings,
            source_label: source_label.to_string(),
        });
    }

    // Try Claude Desktop format: { mcpServers: { ... } }
    if let Some(servers) = value.get("mcpServers").and_then(|v| v.as_object()) {
        let parsed = parse_server_map(servers, &mut warnings);
        return Ok(McpImportResult {
            servers: parsed,
            warnings,
            source_label: format!("{source_label} (Claude Desktop format)"),
        });
    }

    // Try VS Code format: { mcp: { servers: { ... } } }
    if let Some(mcp) = value.get("mcp").and_then(|v| v.as_object())
        && let Some(servers) = mcp.get("servers").and_then(|v| v.as_object()) {
            let parsed = parse_server_map(servers, &mut warnings);
            return Ok(McpImportResult {
                servers: parsed,
                warnings,
                source_label: format!("{source_label} (VS Code format)"),
            });
        }

    // Try flat format: treat the entire object as a server map
    if let Some(obj) = value.as_object() {
        // Check if any key looks like a server entry (has "command" or "url")
        let has_server_like = obj.values().any(|v| {
            v.get("command").is_some() || v.get("url").is_some()
        });
        if has_server_like {
            let parsed = parse_server_map(obj, &mut warnings);
            return Ok(McpImportResult {
                servers: parsed,
                warnings,
                source_label: format!("{source_label} (flat format)"),
            });
        }
    }

    Err(McpError::Import(
        "Could not detect MCP server configuration in file".to_string(),
    ))
}

/// Parse individual server entries from a JSON object map.
fn parse_server_map(
    map: &serde_json::Map<String, Value>,
    warnings: &mut Vec<String>,
) -> HashMap<String, McpServerConfig> {
    let mut result = HashMap::new();

    for (name, value) in map {
        match serde_json::from_value::<McpServerConfig>(value.clone()) {
            Ok(config) => {
                result.insert(name.clone(), config);
            }
            Err(e) => {
                warnings.push(format!("Skipped server '{name}': {e}"));
            }
        }
    }

    result
}

/// Import from a GitHub repository using the `gh` CLI.
pub fn import_from_github(
    owner: &str,
    repo: &str,
    path: Option<&str>,
    git_ref: Option<&str>,
) -> Result<McpImportResult, McpError> {
    let ref_ = git_ref.unwrap_or("HEAD");
    let file_path = path.unwrap_or("mcp.json");

    let content = crate::github::gh_get_file(owner, repo, file_path, ref_)
        .map_err(|e| McpError::import_ctx("GitHub fetch failed", e))?;

    let source = format!("{owner}/{repo}/{file_path}");
    import_from_json(&content, &source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_standard_format() {
        let json = r#"{
            "servers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem"],
                    "env": {}
                }
            }
        }"#;
        let result = import_from_json(json, "test").unwrap();
        assert_eq!(result.servers.len(), 1);
        assert!(result.servers.contains_key("filesystem"));
    }

    #[test]
    fn parse_claude_desktop_format() {
        let json = r#"{
            "mcpServers": {
                "github": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"]
                }
            }
        }"#;
        let result = import_from_json(json, "claude_desktop").unwrap();
        assert_eq!(result.servers.len(), 1);
        assert!(result.source_label.contains("Claude Desktop"));
    }

    #[test]
    fn parse_vscode_format() {
        let json = r#"{
            "mcp": {
                "servers": {
                    "sqlite": {
                        "command": "uvx",
                        "args": ["mcp-server-sqlite", "--db-path", "test.db"]
                    }
                }
            }
        }"#;
        let result = import_from_json(json, "settings.json").unwrap();
        assert_eq!(result.servers.len(), 1);
        assert!(result.source_label.contains("VS Code"));
    }

    #[test]
    fn parse_flat_format() {
        let json = r#"{
            "my-server": {
                "command": "node",
                "args": ["server.js"]
            }
        }"#;
        let result = import_from_json(json, "flat.json").unwrap();
        assert_eq!(result.servers.len(), 1);
    }

    #[test]
    fn invalid_server_entry_produces_warning() {
        let json = r#"{
            "servers": {
                "valid": { "command": "echo" },
                "invalid": "not an object"
            }
        }"#;
        let result = import_from_json(json, "test").unwrap();
        assert_eq!(result.servers.len(), 1);
        assert!(!result.warnings.is_empty());
    }

    #[test]
    fn empty_object_errors() {
        let json = "{}";
        let result = import_from_json(json, "test");
        assert!(result.is_err());
    }

    #[test]
    fn preserves_all_fields() {
        let json = r#"{
            "servers": {
                "full": {
                    "command": "cmd",
                    "args": ["--flag"],
                    "env": {"KEY": "VAL"},
                    "description": "A full server",
                    "tags": ["prod"],
                    "enabled": false
                }
            }
        }"#;
        let result = import_from_json(json, "test").unwrap();
        let server = result.servers.get("full").unwrap();
        assert_eq!(server.command.as_deref(), Some("cmd"));
        assert_eq!(server.args, vec!["--flag"]);
        assert_eq!(server.env.get("KEY").unwrap(), "VAL");
        assert_eq!(server.description.as_deref(), Some("A full server"));
        assert_eq!(server.tags, vec!["prod"]);
        assert!(!server.enabled);
    }
}
