//! MCP-specific error types.

use std::fmt;

#[derive(Debug)]
pub enum McpError {
    /// A server with this name already exists.
    DuplicateServer(String),
    /// Server not found in configuration.
    ServerNotFound(String),
    /// Health check failure.
    HealthCheck(String),
    /// Import/parse failure.
    Import(String),
    /// Configuration file I/O error.
    Config(String),
    /// JSON serialization/deserialization error.
    Json(String),
    /// Network/HTTP error.
    Network(String),
}

impl fmt::Display for McpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            McpError::DuplicateServer(name) => {
                write!(f, "MCP server '{name}' already exists")
            }
            McpError::ServerNotFound(name) => {
                write!(f, "MCP server '{name}' not found")
            }
            McpError::HealthCheck(msg) => write!(f, "MCP health check failed: {msg}"),
            McpError::Import(msg) => write!(f, "MCP import error: {msg}"),
            McpError::Config(msg) => write!(f, "MCP config error: {msg}"),
            McpError::Json(msg) => write!(f, "MCP JSON error: {msg}"),
            McpError::Network(msg) => write!(f, "MCP network error: {msg}"),
        }
    }
}

impl std::error::Error for McpError {}

impl From<serde_json::Error> for McpError {
    fn from(e: serde_json::Error) -> Self {
        McpError::Json(e.to_string())
    }
}

impl From<std::io::Error> for McpError {
    fn from(e: std::io::Error) -> Self {
        McpError::Config(e.to_string())
    }
}
