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
    #[error("Export error: {0}")]
    Export(#[from] tracepilot_export::ExportError),
}

pub type Result<T> = std::result::Result<T, OrchestratorError>;
