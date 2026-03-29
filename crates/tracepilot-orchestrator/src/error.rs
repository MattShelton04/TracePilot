//! Orchestrator error types.

#[derive(Debug, thiserror::Error)]
pub enum OrchestratorError {
    #[error("Git error: {0}")]
    Git(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("YAML parse error: {0}")]
    Yaml(#[from] serde_yml::Error),
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Config error: {0}")]
    Config(String),
    #[error("Launch error: {0}")]
    Launch(String),
    #[error("Version error: {0}")]
    Version(String),
    #[error("Template error: {0}")]
    Template(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Worktree error: {0}")]
    Worktree(String),
    #[error("Registry error: {0}")]
    Registry(String),
}

pub type Result<T> = std::result::Result<T, OrchestratorError>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::error::Error;

    #[test]
    fn test_error_display_git() {
        let err = OrchestratorError::Git("repository not found".to_string());
        let msg = err.to_string();
        assert!(msg.contains("Git error"));
        assert!(msg.contains("repository not found"));
    }

    #[test]
    fn test_error_display_config() {
        let err = OrchestratorError::Config("invalid model name".to_string());
        let msg = err.to_string();
        assert!(msg.contains("Config error"));
        assert!(msg.contains("invalid model name"));
    }

    #[test]
    fn test_error_display_launch() {
        let err = OrchestratorError::Launch("failed to spawn process".to_string());
        let msg = err.to_string();
        assert!(msg.contains("Launch error"));
        assert!(msg.contains("failed to spawn process"));
    }

    #[test]
    fn test_error_display_version() {
        let err = OrchestratorError::Version("version 1.0.0 not found".to_string());
        let msg = err.to_string();
        assert!(msg.contains("Version error"));
        assert!(msg.contains("version 1.0.0 not found"));
    }

    #[test]
    fn test_error_display_template() {
        let err = OrchestratorError::Template("template id already exists".to_string());
        let msg = err.to_string();
        assert!(msg.contains("Template error"));
        assert!(msg.contains("template id already exists"));
    }

    #[test]
    fn test_error_display_not_found() {
        let err = OrchestratorError::NotFound("agent definition missing".to_string());
        let msg = err.to_string();
        assert!(msg.contains("Not found"));
        assert!(msg.contains("agent definition missing"));
    }

    #[test]
    fn test_error_display_worktree() {
        let err = OrchestratorError::Worktree("worktree locked".to_string());
        let msg = err.to_string();
        assert!(msg.contains("Worktree error"));
        assert!(msg.contains("worktree locked"));
    }

    #[test]
    fn test_error_display_registry() {
        let err = OrchestratorError::Registry("duplicate repository path".to_string());
        let msg = err.to_string();
        assert!(msg.contains("Registry error"));
        assert!(msg.contains("duplicate repository path"));
    }

    #[test]
    fn test_error_from_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let orch_err: OrchestratorError = io_err.into();
        assert!(matches!(orch_err, OrchestratorError::Io(_)));
        let msg = orch_err.to_string();
        assert!(msg.contains("IO error"));
    }

    #[test]
    fn test_error_from_yaml() {
        let yaml_str = "invalid: yaml: content: [";
        let yaml_err = serde_yml::from_str::<serde_yml::Value>(yaml_str).unwrap_err();
        let orch_err: OrchestratorError = yaml_err.into();
        assert!(matches!(orch_err, OrchestratorError::Yaml(_)));
        let msg = orch_err.to_string();
        assert!(msg.contains("YAML parse error"));
    }

    #[test]
    fn test_error_from_json() {
        let json_str = r#"{"invalid": json}"#;
        let json_err = serde_json::from_str::<serde_json::Value>(json_str).unwrap_err();
        let orch_err: OrchestratorError = json_err.into();
        assert!(matches!(orch_err, OrchestratorError::Json(_)));
        let msg = orch_err.to_string();
        assert!(msg.contains("JSON parse error"));
    }

    #[test]
    fn test_error_source_chain_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
        let orch_err: OrchestratorError = io_err.into();
        // Io variant has #[from] which preserves source
        assert!(orch_err.source().is_some());
    }

    #[test]
    fn test_error_source_chain_yaml() {
        let yaml_str = "invalid: [unclosed";
        let yaml_err = serde_yml::from_str::<serde_yml::Value>(yaml_str).unwrap_err();
        let orch_err: OrchestratorError = yaml_err.into();
        // Yaml variant has #[from] which preserves source
        assert!(orch_err.source().is_some());
    }

    #[test]
    fn test_error_source_chain_json() {
        let json_str = r#"{"unclosed": "#;
        let json_err = serde_json::from_str::<serde_json::Value>(json_str).unwrap_err();
        let orch_err: OrchestratorError = json_err.into();
        // Json variant has #[from] which preserves source
        assert!(orch_err.source().is_some());
    }
}
