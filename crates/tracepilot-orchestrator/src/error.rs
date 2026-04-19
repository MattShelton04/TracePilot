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
    #[error("Process timed out after {secs}s")]
    Timeout { secs: u64 },
    #[error("Version error: {0}")]
    Version(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Worktree error: {0}")]
    Worktree(String),
    #[error("Registry error: {0}")]
    Registry(String),
    #[error("Task error: {0}")]
    Task(String),
    #[error("Task database error: {0}")]
    TaskDb(#[from] rusqlite::Error),
    #[error("Preset error: {0}")]
    Preset(String),
    #[error("Core error: {0}")]
    Core(#[from] tracepilot_core::TracePilotError),
    #[error(transparent)]
    Mcp(#[from] crate::mcp::McpError),
    #[error(transparent)]
    Skills(#[from] crate::skills::SkillsError),
    #[error("Copilot SDK bridge error: {0}")]
    Bridge(#[from] crate::bridge::BridgeError),
    #[error("Export error: {0}")]
    Export(#[from] tracepilot_export::ExportError),
}

impl From<tracepilot_core::utils::backup::BackupError> for OrchestratorError {
    fn from(e: tracepilot_core::utils::backup::BackupError) -> Self {
        use tracepilot_core::utils::backup::BackupError;
        match e {
            BackupError::Io(source) => OrchestratorError::Io(source),
            BackupError::PathEscape => {
                OrchestratorError::NotFound("Path is outside the backup directory".to_string())
            }
            BackupError::NotFound(path) => {
                OrchestratorError::NotFound(format!("Backup not found: {}", path.display()))
            }
        }
    }
}

pub type Result<T> = std::result::Result<T, OrchestratorError>;

impl OrchestratorError {
    /// Construct a Launch error with context and source error.
    pub fn launch_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        OrchestratorError::Launch(format!("{context}: {source}"))
    }

    /// Construct a Config error with context and source error.
    pub fn config_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        OrchestratorError::Config(format!("{context}: {source}"))
    }

    /// Construct a Task error with context and source error.
    pub fn task_ctx(context: impl std::fmt::Display, source: impl std::fmt::Display) -> Self {
        OrchestratorError::Task(format!("{context}: {source}"))
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
    fn config_ctx_creates_formatted_error() {
        let err = OrchestratorError::config_ctx("Invalid YAML", "unexpected token");
        let msg = err.to_string();
        assert!(msg.contains("Config error"));
        assert!(msg.contains("Invalid YAML"));
        assert!(msg.contains("unexpected token"));
    }

    #[test]
    fn task_ctx_creates_formatted_error() {
        let err = OrchestratorError::task_ctx("Invalid JSON in input_params", "unexpected end");
        let msg = err.to_string();
        assert!(msg.contains("Task error"));
        assert!(msg.contains("Invalid JSON in input_params"));
        assert!(msg.contains("unexpected end"));
    }
}
