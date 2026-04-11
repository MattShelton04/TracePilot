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
}

pub type Result<T> = std::result::Result<T, IndexerError>;

impl IndexerError {
    /// Create a DatabaseOpen error with context.
    pub fn database_open(path: impl std::fmt::Display, source: rusqlite::Error) -> Self {
        Self::DatabaseOpen {
            path: path.to_string(),
            source,
        }
    }

    /// Create a DatabaseConfiguration error with context.
    pub fn database_config(details: impl Into<String>, source: rusqlite::Error) -> Self {
        Self::DatabaseConfiguration {
            details: details.into(),
            source,
        }
    }

    /// Create a Database error with context for query failures.
    ///
    /// This helper provides additional context when database queries fail,
    /// making it easier to debug issues in logs and error reports.
    ///
    /// # Example
    /// ```ignore
    /// let count: i64 = conn
    ///     .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
    ///     .map_err(|e| IndexerError::query_failed("Failed to count sessions", e))?;
    /// ```
    pub fn query_failed(context: impl Into<String>, source: rusqlite::Error) -> Self {
        tracing::warn!("Database query failed: {} - {:?}", context.into(), source);
        Self::Database(source)
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
