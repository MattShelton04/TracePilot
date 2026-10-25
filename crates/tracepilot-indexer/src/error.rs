//! Typed error types for tracepilot-indexer.
//!
//! This module provides structured error types that align with the error
//! handling patterns used in `tracepilot-core` and `tracepilot-orchestrator`.
//! All errors implement `std::error::Error` and can be serialized for display
//! in the Tauri frontend via `BindingsError`.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum IndexerError {
    /// Failed to open index database.
    #[error("Failed to open index database: {path}")]
    DatabaseOpen {
        path: String,
        #[source]
        source: rusqlite::Error,
    },

    /// Failed to set database pragmas or configuration.
    #[error("Failed to configure database: {details}")]
    DatabaseConfiguration {
        details: String,
        #[source]
        source: rusqlite::Error,
    },

    /// General database operation failed.
    #[error(transparent)]
    Database(#[from] rusqlite::Error),

    /// File system I/O error.
    #[error(transparent)]
    Io(#[from] std::io::Error),

    /// Session parsing error (from tracepilot-core).
    #[error(transparent)]
    SessionParse(#[from] tracepilot_core::TracePilotError),

    /// JSON parsing failed for structured analytics payloads stored in the index.
    #[error(transparent)]
    Json(#[from] serde_json::Error),

    /// A session id is already indexed from another source. The existing row
    /// is kept.
    #[error("session {session_id} is indexed from source '{existing}', not '{incoming}'")]
    SourceConflict {
        session_id: String,
        existing: String,
        incoming: String,
    },

    /// The source's configuration changed while a pass ran; the pass's
    /// writes for it were rolled back.
    #[error("configuration of source '{name}' changed during indexing")]
    StaleSource { name: String },

    /// A source's sessions could not all be listed, so an index rebuilt now
    /// would lose its rows. `name` is the source's display label.
    #[error(
        "{name} sessions can't all be read, so the existing index was kept. Make their folder available and try again."
    )]
    IncompleteInventory { name: String },
}

pub type Result<T> = std::result::Result<T, IndexerError>;

/// A source's name as users see it.
pub(crate) fn source_label(source: tracepilot_core::provider::SessionSource) -> &'static str {
    use tracepilot_core::provider::SessionSource;
    match source {
        SessionSource::Copilot => "Copilot",
        SessionSource::ClaudeCode => "Claude Code",
    }
}

impl IndexerError {
    /// Create a DatabaseOpen error with context.
    pub fn database_open(path: impl std::fmt::Display, source: rusqlite::Error) -> Self {
        Self::DatabaseOpen {
            path: path.to_string(),
            source,
        }
    }

    /// Whether SQLite refused because another connection holds the database
    /// (`SQLITE_BUSY` / `SQLITE_LOCKED`), for example the indexer writing.
    pub fn is_busy(&self) -> bool {
        let source = match self {
            Self::Database(source)
            | Self::DatabaseOpen { source, .. }
            | Self::DatabaseConfiguration { source, .. } => source,
            _ => return false,
        };
        matches!(
            source.sqlite_error_code(),
            Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
        )
    }

    /// Create a DatabaseConfiguration error with context.
    pub fn database_config(details: impl Into<String>, source: rusqlite::Error) -> Self {
        Self::DatabaseConfiguration {
            details: details.into(),
            source,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::error::Error;

    #[test]
    fn test_error_display_database_open() {
        let err = IndexerError::database_open(
            "/path/to/index.db",
            rusqlite::Error::InvalidPath("/path/to/index.db".into()),
        );
        let msg = err.to_string();
        assert!(msg.contains("Failed to open index database"));
        assert!(msg.contains("/path/to/index.db"));
    }

    #[test]
    fn test_error_from_rusqlite() {
        let sql_err = rusqlite::Error::InvalidQuery;
        let indexer_err: IndexerError = sql_err.into();
        assert!(matches!(indexer_err, IndexerError::Database(_)));
    }

    #[test]
    fn test_error_from_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let indexer_err: IndexerError = io_err.into();
        assert!(matches!(indexer_err, IndexerError::Io(_)));
    }

    #[test]
    fn test_error_source_chain() {
        let sql_err = rusqlite::Error::InvalidQuery;
        let err = IndexerError::database_config("Test config error", sql_err);
        // DatabaseConfiguration variant has an explicit source field
        assert!(err.source().is_some());
    }
}
