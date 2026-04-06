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
    #[error(transparent)]
    IoError(#[from] std::io::Error),
    /// JSON error with preserved source chain.
    #[error(transparent)]
    JsonError(#[from] serde_json::Error),
}

impl McpError {
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
        let json_err: serde_json::Error =
            serde_json::from_str::<String>("invalid").unwrap_err();
        let mcp_err: McpError = json_err.into();
        assert!(matches!(mcp_err, McpError::JsonError(_)));
        assert!(!mcp_err.to_string().is_empty());
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let mcp_err: McpError = io_err.into();
        assert!(matches!(mcp_err, McpError::IoError(_)));
        assert!(mcp_err.to_string().contains("file missing"));
    }

    #[test]
    fn io_error_preserves_source_chain() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
        let mcp_err: McpError = io_err.into();
        // Transparent errors forward to the inner error. std::io::Error itself may not have a source.
        // What matters is that the error is the IoError variant, not a String variant.
        assert!(matches!(mcp_err, McpError::IoError(_)));
    }

    #[test]
    fn json_error_preserves_source_chain() {
        let json_err: serde_json::Error =
            serde_json::from_str::<String>("{{invalid}}").unwrap_err();
        let mcp_err: McpError = json_err.into();
        // Transparent errors forward to the inner error.
        assert!(matches!(mcp_err, McpError::JsonError(_)));
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
