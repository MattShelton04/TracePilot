//! MCP type definitions for server configuration and metadata.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The transport type used to communicate with an MCP server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum McpTransport {
    #[serde(rename = "stdio", alias = "local")]
    Stdio,
    #[serde(rename = "sse")]
    Sse,
    #[serde(rename = "http", alias = "streamable-http", alias = "streamable")]
    StreamableHttp,
}

impl std::fmt::Display for McpTransport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            McpTransport::Stdio => write!(f, "stdio"),
            McpTransport::Sse => write!(f, "sse"),
            McpTransport::StreamableHttp => write!(f, "http"),
        }
    }
}

/// An individual MCP server entry as stored in configuration.
///
/// Field naming matches the Copilot CLI `mcp-config.json` format where the
/// transport discriminator is called `"type"` (not `"transport"`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    /// The command to run (for stdio transport).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,

    /// Arguments passed to the command.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,

    /// Environment variables to set for the server process.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub env: HashMap<String, String>,

    /// URL for SSE or Streamable HTTP transport.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,

    /// The transport type. Serializes as `"type"` in JSON to match the Copilot
    /// CLI format. Also accepts `"transport"` on deserialization for backward
    /// compatibility with earlier TracePilot configs.
    #[serde(
        rename = "type",
        alias = "transport",
        skip_serializing_if = "Option::is_none"
    )]
    pub transport: Option<McpTransport>,

    /// HTTP headers to pass to remote MCP servers.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub headers: HashMap<String, String>,

    /// Tool filter patterns (e.g. `["*"]` for all tools).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<String>,

    /// User-facing description of what this server provides.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Tags for filtering/categorization.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,

    /// Whether this server is enabled (participating in sessions).
    /// TracePilot-only field — only written when `false` to avoid polluting
    /// the shared Copilot CLI mcp-config.json with unknown fields.
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

fn is_true(v: &bool) -> bool {
    *v
}

impl McpServerConfig {
    /// Infer the effective transport type from config fields.
    ///
    /// Precedence:
    /// 1. Explicit `type` / `transport` field
    /// 2. URL present → StreamableHttp (SSE is deprecated)
    /// 3. Fallback → Stdio
    pub fn effective_transport(&self) -> McpTransport {
        if let Some(t) = &self.transport {
            return t.clone();
        }
        if self.url.is_some() {
            McpTransport::StreamableHttp
        } else {
            McpTransport::Stdio
        }
    }
}

/// A tool exposed by an MCP server, discovered via the tools/list method.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// JSON Schema for the tool's input parameters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<serde_json::Value>,
    /// Estimated token cost of the tool definition.
    #[serde(default)]
    pub estimated_tokens: u32,
}

impl McpTool {
    /// Construct a tool and cache its estimated token count.
    pub fn new(
        name: String,
        description: Option<String>,
        input_schema: Option<serde_json::Value>,
    ) -> Self {
        let estimated_tokens =
            crate::tokens::estimate_tool_tokens(&name, description.as_deref().unwrap_or(""));
        Self {
            name,
            description,
            input_schema,
            estimated_tokens,
        }
    }

    /// Estimate the token cost of this tool's definition.
    ///
    /// Uses the tool name and description (empty string if `None`) to calculate
    /// an approximate token count via the shared `estimate_tool_tokens` function.
    pub fn estimate_tokens(&self) -> u32 {
        crate::tokens::estimate_tool_tokens(&self.name, self.description.as_deref().unwrap_or(""))
    }
}

/// Health check result for a single MCP server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHealthResult {
    pub server_name: String,
    pub status: McpHealthStatus,
    pub latency_ms: Option<u64>,
    pub tool_count: Option<usize>,
    pub error_message: Option<String>,
    pub checked_at: DateTime<Utc>,
}

/// Health status of an MCP server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum McpHealthStatus {
    Healthy,
    Degraded,
    Unreachable,
    Unknown,
    Disabled,
}

/// Summary of all MCP servers for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSummary {
    pub total_servers: usize,
    pub enabled_servers: usize,
    pub healthy_servers: usize,
    pub total_tools: usize,
    pub total_tokens: u32,
}

/// Complete state returned to the frontend for a single server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerDetail {
    pub name: String,
    pub config: McpServerConfig,
    pub health: Option<McpHealthResult>,
    pub tools: Vec<McpTool>,
    pub total_tokens: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_transport_defaults_stdio() {
        let cfg = McpServerConfig {
            command: Some("npx".into()),
            args: vec![],
            env: HashMap::new(),
            url: None,
            transport: None,
            headers: HashMap::new(),
            tools: vec![],
            description: None,
            tags: vec![],
            enabled: true,
        };
        assert_eq!(cfg.effective_transport(), McpTransport::Stdio);
    }

    #[test]
    fn effective_transport_infers_streamable_http_from_url() {
        let cfg = McpServerConfig {
            command: None,
            args: vec![],
            env: HashMap::new(),
            url: Some("http://localhost:8080/mcp".into()),
            transport: None,
            headers: HashMap::new(),
            tools: vec![],
            description: None,
            tags: vec![],
            enabled: true,
        };
        // URL without explicit type defaults to StreamableHttp (SSE is deprecated)
        assert_eq!(cfg.effective_transport(), McpTransport::StreamableHttp);
    }

    #[test]
    fn explicit_transport_wins() {
        let cfg = McpServerConfig {
            command: Some("cmd".into()),
            args: vec![],
            env: HashMap::new(),
            url: Some("http://localhost".into()),
            transport: Some(McpTransport::StreamableHttp),
            headers: HashMap::new(),
            tools: vec![],
            description: None,
            tags: vec![],
            enabled: true,
        };
        assert_eq!(cfg.effective_transport(), McpTransport::StreamableHttp);
    }

    #[test]
    fn health_status_serializes_lowercase() {
        let json = serde_json::to_string(&McpHealthStatus::Healthy).unwrap();
        assert_eq!(json, "\"healthy\"");
    }

    #[test]
    fn server_config_round_trip() {
        let cfg = McpServerConfig {
            command: Some("npx".into()),
            args: vec!["-y".into(), "@mcp/server".into()],
            env: HashMap::from([("API_KEY".into(), "secret".into())]),
            url: None,
            transport: None,
            headers: HashMap::new(),
            tools: vec![],
            description: Some("Test server".into()),
            tags: vec!["test".into()],
            enabled: true,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let parsed: McpServerConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.command, cfg.command);
        assert_eq!(parsed.args, cfg.args);
        assert_eq!(parsed.tags, cfg.tags);
    }

    #[test]
    fn copilot_cli_http_config_deserializes() {
        // Real Copilot CLI format uses "type": "http"
        let json = r#"{
            "type": "http",
            "url": "https://mcp.deepwiki.com/mcp",
            "headers": {},
            "tools": ["*"]
        }"#;
        let cfg: McpServerConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.transport, Some(McpTransport::StreamableHttp));
        assert_eq!(cfg.url.as_deref(), Some("https://mcp.deepwiki.com/mcp"));
        assert_eq!(cfg.tools, vec!["*"]);
        assert!(cfg.headers.is_empty());
        assert_eq!(cfg.effective_transport(), McpTransport::StreamableHttp);
    }

    #[test]
    fn copilot_cli_stdio_config_deserializes() {
        // Stdio config — no "type" field, just command
        let json = r#"{
            "command": "npx",
            "args": ["-y", "@mcp/server"]
        }"#;
        let cfg: McpServerConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.transport.is_none());
        assert_eq!(cfg.effective_transport(), McpTransport::Stdio);
    }

    #[test]
    fn serializes_type_not_transport() {
        let cfg = McpServerConfig {
            command: None,
            args: vec![],
            env: HashMap::new(),
            url: Some("https://example.com/mcp".into()),
            transport: Some(McpTransport::StreamableHttp),
            headers: HashMap::from([("Authorization".into(), "Bearer tok".into())]),
            tools: vec!["*".into()],
            description: None,
            tags: vec![],
            enabled: true,
        };
        let json = serde_json::to_string_pretty(&cfg).unwrap();
        // JSON key should be "type" not "transport"
        assert!(json.contains(r#""type":"#) || json.contains(r#""type" :"#), "Expected 'type' key: {json}");
        assert!(!json.contains(r#""transport""#), "Should NOT have 'transport' key: {json}");
        // Value should be "http" (not "streamable-http") to match Copilot CLI format
        assert!(json.contains(r#""http""#), "Expected 'http' value: {json}");
        assert!(!json.contains(r#""streamable-http""#), "Should NOT serialize as 'streamable-http': {json}");
        assert!(json.contains(r#""headers""#));
        assert!(json.contains(r#""tools""#));
    }

    #[test]
    fn mcp_tool_estimate_tokens_with_description() {
        let tool = McpTool {
            name: "file_search".to_string(),
            description: Some("Search for files in the workspace".to_string()),
            input_schema: None,
            estimated_tokens: 0,
        };
        let tokens = tool.estimate_tokens();
        // Should be non-zero for a tool with name and description
        assert!(tokens > 0);
        // Verify it matches direct call to estimate_tool_tokens
        let expected = crate::tokens::estimate_tool_tokens(
            "file_search",
            "Search for files in the workspace",
        );
        assert_eq!(tokens, expected);
    }

    #[test]
    fn mcp_tool_estimate_tokens_with_none_description() {
        let tool = McpTool {
            name: "get_user".to_string(),
            description: None,
            input_schema: None,
            estimated_tokens: 0,
        };
        let tokens = tool.estimate_tokens();
        // Should still work with None description (treats as empty string)
        assert!(tokens > 0);
        // Verify it matches direct call with empty string
        let expected = crate::tokens::estimate_tool_tokens("get_user", "");
        assert_eq!(tokens, expected);
    }

    #[test]
    fn mcp_tool_estimate_tokens_with_empty_description() {
        let tool = McpTool {
            name: "ping".to_string(),
            description: Some("".to_string()),
            input_schema: None,
            estimated_tokens: 0,
        };
        let tokens = tool.estimate_tokens();
        // Empty description should be treated same as None
        let expected = crate::tokens::estimate_tool_tokens("ping", "");
        assert_eq!(tokens, expected);
    }

    #[test]
    fn mcp_tool_estimate_tokens_consistency() {
        // Verify that calling estimate_tokens() multiple times returns the same value
        let tool = McpTool {
            name: "complex_operation".to_string(),
            description: Some("This is a longer description with multiple words".to_string()),
            input_schema: None,
            estimated_tokens: 0,
        };
        let tokens1 = tool.estimate_tokens();
        let tokens2 = tool.estimate_tokens();
        assert_eq!(tokens1, tokens2, "Token estimation should be consistent");
    }
}
