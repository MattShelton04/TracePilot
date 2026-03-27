//! Error types for the export/import pipeline.

use std::path::PathBuf;

/// All errors that can occur during export or import operations.
#[derive(Debug, thiserror::Error)]
pub enum ExportError {
    /// Filesystem I/O failure (reading session files, writing output).
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        source: std::io::Error,
    },

    /// JSON serialization or deserialization failure.
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// Failed to load or parse session data from the core crate.
    #[error("session data error: {message}")]
    SessionData { message: String },

    /// Error during the build phase (assembling SessionArchive).
    #[error("builder error: {message}")]
    Builder { message: String },

    /// Error during rendering to a specific format.
    #[error("render error for {format}: {message}")]
    Render { format: String, message: String },

    /// The schema version in the file is not supported by this reader.
    #[error("unsupported schema version {major}.{minor} (minimum reader: {min_major}.{min_minor})")]
    UnsupportedVersion {
        major: u32,
        minor: u32,
        min_major: u32,
        min_minor: u32,
    },

    /// Structural validation failure during import.
    #[error("validation error: {message}")]
    Validation { message: String },

    /// The session directory was not found or is missing workspace.yaml.
    #[error("session not found: {0}")]
    SessionNotFound(PathBuf),
}

/// Convenience alias for export/import results.
pub type Result<T> = std::result::Result<T, ExportError>;

impl ExportError {
    /// Create an I/O error with path context.
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }

    /// Wrap an anyhow error as a session data error.
    pub fn session_data(err: impl std::fmt::Display) -> Self {
        Self::SessionData {
            message: err.to_string(),
        }
    }
}
