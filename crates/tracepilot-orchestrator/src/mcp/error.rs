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
    /// Configuration file I/O error.
    #[error("MCP config error: {0}")]
    Config(String),
    /// JSON serialization/deserialization error.
    #[error("MCP JSON error: {0}")]
    Json(String),
    /// Network/HTTP error.
    #[error("MCP network error: {0}")]
    Network(String),
}

// Manual `From` impls convert source errors to String because many call sites
// construct these variants with custom string messages directly.

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

impl From<crate::error::OrchestratorError> for McpError {
    fn from(e: crate::error::OrchestratorError) -> Self {
        match e {
            // Map IO errors to Config variant (MCP config file I/O)
            crate::error::OrchestratorError::Io(io_err) => McpError::Config(io_err.to_string()),
            // Map JSON errors to Json variant
            crate::error::OrchestratorError::Json(json_err) => McpError::Json(json_err.to_string()),
            // Map Config errors to Config variant (preserve meaning)
            crate::error::OrchestratorError::Config(msg) => McpError::Config(msg),
            // Map Launch errors to Import variant (external command failures)
            crate::error::OrchestratorError::Launch(msg) => McpError::Import(msg),
            // Map NotFound to Import (resource not found during import)
            crate::error::OrchestratorError::NotFound(msg) => McpError::Import(msg),
            // Pass through MCP errors unchanged
            crate::error::OrchestratorError::Mcp(mcp_err) => mcp_err,
            // Unexpected variants - these should not occur in MCP context
            // Map to Config with descriptive prefix to aid debugging
            crate::error::OrchestratorError::Git(msg) => {
                McpError::Config(format!("Unexpected git error in MCP context: {msg}"))
            }
            crate::error::OrchestratorError::Yaml(err) => {
                McpError::Config(format!("Unexpected YAML error in MCP context: {err}"))
            }
            crate::error::OrchestratorError::Version(msg) => {
                McpError::Config(format!("Unexpected version error in MCP context: {msg}"))
            }
            crate::error::OrchestratorError::Template(msg) => {
                McpError::Config(format!("Unexpected template error in MCP context: {msg}"))
            }
            crate::error::OrchestratorError::Worktree(msg) => {
                McpError::Config(format!("Unexpected worktree error in MCP context: {msg}"))
            }
            crate::error::OrchestratorError::Registry(msg) => {
                McpError::Config(format!("Unexpected registry error in MCP context: {msg}"))
            }
            crate::error::OrchestratorError::Skills(err) => {
                McpError::Config(format!("Unexpected skills error in MCP context: {err}"))
            }
        }
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
        assert!(matches!(mcp_err, McpError::Json(_)));
        assert!(!mcp_err.to_string().is_empty());
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let mcp_err: McpError = io_err.into();
        assert!(matches!(mcp_err, McpError::Config(_)));
        assert!(mcp_err.to_string().contains("file missing"));
    }

    #[test]
    fn from_orchestrator_error_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
        let orch_err = crate::error::OrchestratorError::Io(io_err);
        let mcp_err: McpError = orch_err.into();
        assert!(matches!(mcp_err, McpError::Config(_)));
        assert!(mcp_err.to_string().contains("access denied"));
    }

    #[test]
    fn from_orchestrator_error_json() {
        let json_err: serde_json::Error =
            serde_json::from_str::<String>("invalid").unwrap_err();
        let orch_err = crate::error::OrchestratorError::Json(json_err);
        let mcp_err: McpError = orch_err.into();
        assert!(matches!(mcp_err, McpError::Json(_)));
    }

    #[test]
    fn from_orchestrator_error_config() {
        let orch_err = crate::error::OrchestratorError::Config("bad config".into());
        let mcp_err: McpError = orch_err.into();
        assert!(matches!(mcp_err, McpError::Config(_)));
        assert!(mcp_err.to_string().contains("bad config"));
    }

    #[test]
    fn from_orchestrator_error_launch() {
        let orch_err = crate::error::OrchestratorError::Launch("command failed".into());
        let mcp_err: McpError = orch_err.into();
        assert!(matches!(mcp_err, McpError::Import(_)));
        assert!(mcp_err.to_string().contains("command failed"));
    }

    #[test]
    fn from_orchestrator_error_not_found() {
        let orch_err = crate::error::OrchestratorError::NotFound("resource missing".into());
        let mcp_err: McpError = orch_err.into();
        assert!(matches!(mcp_err, McpError::Import(_)));
        assert!(mcp_err.to_string().contains("resource missing"));
    }

    #[test]
    fn from_orchestrator_error_mcp_passthrough() {
        let original_mcp = McpError::DuplicateServer("test-server".into());
        let orch_err = crate::error::OrchestratorError::Mcp(original_mcp);
        let mcp_err: McpError = orch_err.into();
        assert!(matches!(mcp_err, McpError::DuplicateServer(_)));
        assert!(mcp_err.to_string().contains("test-server"));
    }

    #[test]
    fn from_orchestrator_error_unexpected_variants() {
        // Git error should be mapped with "Unexpected" prefix
        let orch_err = crate::error::OrchestratorError::Git("git command failed".into());
        let mcp_err: McpError = orch_err.into();
        assert!(matches!(mcp_err, McpError::Config(_)));
        let msg = mcp_err.to_string();
        assert!(msg.contains("Unexpected git error in MCP context"));
        assert!(msg.contains("git command failed"));
    }

    #[test]
    fn from_orchestrator_error_yaml_variant() {
        let yaml_err: serde_yml::Error = serde_yml::from_str::<String>("invalid: [").unwrap_err();
        let orch_err = crate::error::OrchestratorError::Yaml(yaml_err);
        let mcp_err: McpError = orch_err.into();
        assert!(matches!(mcp_err, McpError::Config(_)));
        assert!(mcp_err.to_string().contains("Unexpected YAML error in MCP context"));
    }

    #[test]
    fn from_orchestrator_error_skills_variant() {
        use crate::skills::SkillsError;
        let skills_err = SkillsError::NotFound("test-skill".into());
        let orch_err = crate::error::OrchestratorError::Skills(skills_err);
        let mcp_err: McpError = orch_err.into();
        assert!(matches!(mcp_err, McpError::Config(_)));
        assert!(mcp_err.to_string().contains("Unexpected skills error in MCP context"));
    }
}
