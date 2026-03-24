//! Unified error types for tracepilot-core.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum TracePilotError {
    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Parse error: {context}")]
    ParseError {
        context: String,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),

    #[error("YAML parse error: {0}")]
    YamlError(#[from] serde_yml::Error),

    #[error("JSON parse error: {0}")]
    JsonError(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, TracePilotError>;
