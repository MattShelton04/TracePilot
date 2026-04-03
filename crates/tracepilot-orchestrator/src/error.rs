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
    #[error(transparent)]
    Mcp(#[from] crate::mcp::McpError),
    #[error(transparent)]
    Skills(#[from] crate::skills::SkillsError),
}

pub type Result<T> = std::result::Result<T, OrchestratorError>;

impl OrchestratorError {
    /// Construct a Launch error with context and source error.
    pub fn launch_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        OrchestratorError::Launch(format!("{context}: {source}"))
    }

    /// Construct a Git error with context and source error.
    pub fn git_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        OrchestratorError::Git(format!("{context}: {source}"))
    }

    /// Construct a Config error with context and source error.
    pub fn config_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        OrchestratorError::Config(format!("{context}: {source}"))
    }

    /// Construct a Version error with context and source error.
    pub fn version_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        OrchestratorError::Version(format!("{context}: {source}"))
    }

    /// Construct a Template error with context and source error.
    pub fn template_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        OrchestratorError::Template(format!("{context}: {source}"))
    }

    /// Construct a NotFound error with context and source error.
    pub fn not_found_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        OrchestratorError::NotFound(format!("{context}: {source}"))
    }

    /// Construct a Worktree error with context and source error.
    pub fn worktree_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        OrchestratorError::Worktree(format!("{context}: {source}"))
    }

    /// Construct a Registry error with context and source error.
    pub fn registry_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        OrchestratorError::Registry(format!("{context}: {source}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_ctx_creates_formatted_error() {
        let err = OrchestratorError::launch_ctx("Failed to spawn git", "permission denied");
        let msg = err.to_string();
        assert!(msg.contains("Launch error"));
        assert!(msg.contains("Failed to spawn git"));
        assert!(msg.contains("permission denied"));
    }

    #[test]
    fn git_ctx_creates_formatted_error() {
        let err = OrchestratorError::git_ctx("Failed to checkout branch", "branch not found");
        let msg = err.to_string();
        assert!(msg.contains("Git error"));
        assert!(msg.contains("Failed to checkout branch"));
        assert!(msg.contains("branch not found"));
    }

    #[test]
    fn config_ctx_creates_formatted_error() {
        let err = OrchestratorError::config_ctx("Invalid YAML", "unexpected token");
        let msg = err.to_string();
        assert!(msg.contains("Config error"));
        assert!(msg.contains("Invalid YAML"));
        assert!(msg.contains("unexpected token"));
    }

    #[test]
    fn version_ctx_creates_formatted_error() {
        let err = OrchestratorError::version_ctx("Failed to parse version", "invalid format");
        let msg = err.to_string();
        assert!(msg.contains("Version error"));
        assert!(msg.contains("Failed to parse version"));
        assert!(msg.contains("invalid format"));
    }

    #[test]
    fn template_ctx_creates_formatted_error() {
        let err = OrchestratorError::template_ctx("Failed to load template", "file not found");
        let msg = err.to_string();
        assert!(msg.contains("Template error"));
        assert!(msg.contains("Failed to load template"));
        assert!(msg.contains("file not found"));
    }

    #[test]
    fn not_found_ctx_creates_formatted_error() {
        let err = OrchestratorError::not_found_ctx("Repository", "not in registry");
        let msg = err.to_string();
        assert!(msg.contains("Not found"));
        assert!(msg.contains("Repository"));
        assert!(msg.contains("not in registry"));
    }

    #[test]
    fn worktree_ctx_creates_formatted_error() {
        let err = OrchestratorError::worktree_ctx("Failed to create worktree", "path exists");
        let msg = err.to_string();
        assert!(msg.contains("Worktree error"));
        assert!(msg.contains("Failed to create worktree"));
        assert!(msg.contains("path exists"));
    }

    #[test]
    fn registry_ctx_creates_formatted_error() {
        let err = OrchestratorError::registry_ctx("Failed to add repository", "duplicate entry");
        let msg = err.to_string();
        assert!(msg.contains("Registry error"));
        assert!(msg.contains("Failed to add repository"));
        assert!(msg.contains("duplicate entry"));
    }
}
