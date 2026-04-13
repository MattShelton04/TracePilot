//! MCP-specific error types.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum McpError {
    /// A server with this name already exists.
    #[error("MCP server '{0}' already exists")]
    DuplicateServer(String),
    /// Server not found in configuration.
    #[error("MCP server '{0}' not found")]
    ServerNotFound(String),
    /// Health check failure.
    #[error("MCP health check failed: {0}")]
    HealthCheck(String),
    /// Import/parse failure.
    #[error("MCP import error: {0}")]
    Import(String),
    /// Configuration file I/O error (with custom message).
    #[error("MCP config error: {0}")]
    Config(String),
    /// JSON serialization/deserialization error (with custom message).
    #[error("MCP JSON error: {0}")]
    Json(String),
    /// Network/HTTP error.
    #[error("MCP network error: {0}")]
    Network(String),
    /// I/O error with preserved source chain.
    #[error("MCP I/O error: {0}")]
    IoSource(#[from] std::io::Error),
    /// JSON error with preserved source chain.
    #[error("MCP JSON error: {0}")]
    JsonSource(#[from] serde_json::Error),
}

impl McpError {
    /// Convert an `OrchestratorError` into the closest `McpError` variant,
    /// preserving typed sources for I/O and JSON errors.
    pub fn from_orchestrator(e: crate::error::OrchestratorError) -> Self {
        match e {
            crate::error::OrchestratorError::Io(io_err) => McpError::IoSource(io_err),
            crate::error::OrchestratorError::Json(json_err) => McpError::JsonSource(json_err),
            other => McpError::Config(other.to_string()),
        }
    }

    /// Construct a HealthCheck error with context and source error.
    pub fn health_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        McpError::HealthCheck(format!("{context}: {source}"))
    }

    /// Construct an Import error with context and source error.
    pub fn import_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        McpError::Import(format!("{context}: {source}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_duplicate_server() {
        let err = McpError::DuplicateServer("my-server".into());
        let msg = err.to_string();
        assert!(msg.contains("my-server"));
        assert!(msg.contains("already exists"));
    }

    #[test]
    fn display_server_not_found() {
        let err = McpError::ServerNotFound("missing-srv".into());
        let msg = err.to_string();
        assert!(msg.contains("missing-srv"));
        assert!(msg.contains("not found"));
    }

    #[test]
    fn display_health_check() {
        let err = McpError::HealthCheck("timeout after 5s".into());
        let msg = err.to_string();
        assert!(msg.contains("health check failed"));
        assert!(msg.contains("timeout after 5s"));
    }

    #[test]
    fn display_import() {
        let err = McpError::Import("bad format".into());
        assert!(err.to_string().contains("bad format"));
    }

    #[test]
    fn display_config() {
        let err = McpError::Config("permission denied".into());
        assert!(err.to_string().contains("permission denied"));
    }

    #[test]
    fn display_json() {
        let err = McpError::Json("unexpected token".into());
        assert!(err.to_string().contains("unexpected token"));
    }

    #[test]
    fn display_network() {
        let err = McpError::Network("connection refused".into());
        assert!(err.to_string().contains("connection refused"));
    }

    #[test]
    fn from_serde_json_error() {
        let json_err: serde_json::Error = serde_json::from_str::<String>("invalid").unwrap_err();
        let mcp_err: McpError = json_err.into();
        assert!(matches!(mcp_err, McpError::JsonSource(_)));
        assert!(!mcp_err.to_string().is_empty());
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let mcp_err: McpError = io_err.into();
        assert!(matches!(mcp_err, McpError::IoSource(_)));
        assert!(mcp_err.to_string().contains("file missing"));
    }

    #[test]
    fn io_error_preserves_source_chain() {
        use std::error::Error;
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
        let mcp_err: McpError = io_err.into();
        assert!(matches!(mcp_err, McpError::IoSource(_)));
        assert!(
            mcp_err.source().is_some(),
            "source chain should be preserved"
        );
        assert!(mcp_err.to_string().contains("MCP I/O error"));
    }

    #[test]
    fn json_error_preserves_source_chain() {
        use std::error::Error;
        let json_err: serde_json::Error =
            serde_json::from_str::<String>("{{invalid}}").unwrap_err();
        let mcp_err: McpError = json_err.into();
        assert!(matches!(mcp_err, McpError::JsonSource(_)));
        assert!(
            mcp_err.source().is_some(),
            "source chain should be preserved"
        );
        assert!(mcp_err.to_string().contains("MCP JSON error"));
    }

    #[test]
    fn health_ctx_creates_formatted_error() {
        let err = McpError::health_ctx("JSON error", "unexpected token");
        let msg = err.to_string();
        assert!(msg.contains("health check failed"));
        assert!(msg.contains("JSON error"));
        assert!(msg.contains("unexpected token"));
    }

    #[test]
    fn import_ctx_creates_formatted_error() {
        let err = McpError::import_ctx("Failed to read", "permission denied");
        let msg = err.to_string();
        assert!(msg.contains("import error"));
        assert!(msg.contains("Failed to read"));
        assert!(msg.contains("permission denied"));
    }
}
