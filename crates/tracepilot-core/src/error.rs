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

impl TracePilotError {
    /// Create a parse error from an I/O operation with path context.
    ///
    /// # Examples
    ///
    /// ```
    /// # use tracepilot_core::error::TracePilotError;
    /// # use std::io;
    /// let err = TracePilotError::io_context(
    ///     "Failed to read",
    ///     "/path/to/file.yaml",
    ///     io::Error::new(io::ErrorKind::NotFound, "file not found")
    /// );
    /// assert!(err.to_string().contains("Failed to read"));
    /// assert!(err.to_string().contains("/path/to/file.yaml"));
    /// ```
    pub fn io_context(
        operation: &str,
        path: impl std::fmt::Display,
        source: std::io::Error,
    ) -> Self {
        Self::ParseError {
            context: format!("{} {}", operation, path),
            source: Some(Box::new(source)),
        }
    }

    /// Create a parse error from a deserialization operation with path context.
    ///
    /// # Examples
    ///
    /// ```
    /// # use tracepilot_core::error::TracePilotError;
    /// # use serde_json::Error as JsonError;
    /// let json_err = serde_json::from_str::<i32>("invalid").unwrap_err();
    /// let err = TracePilotError::parse_context(
    ///     "YAML",
    ///     "/path/to/config.yaml",
    ///     json_err
    /// );
    /// assert!(err.to_string().contains("Failed to parse YAML"));
    /// assert!(err.to_string().contains("/path/to/config.yaml"));
    /// ```
    pub fn parse_context(
        format: &str,
        path: impl std::fmt::Display,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::ParseError {
            context: format!("Failed to parse {} {}", format, path),
            source: Some(Box::new(source)),
        }
    }

    /// Read a file to string with context-rich errors.
    pub fn read_to_string(path: &std::path::Path) -> Result<String> {
        std::fs::read_to_string(path)
            .map_err(|e| Self::io_context("Failed to read", path.display(), e))
    }

    /// Read and parse a JSON file with context-rich errors.
    pub fn read_json<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> Result<T> {
        let file = std::fs::File::open(path)
            .map_err(|e| Self::io_context("Failed to read", path.display(), e))?;
        let reader = std::io::BufReader::new(file);
        serde_json::from_reader(reader).map_err(|e| Self::parse_context("JSON", path.display(), e))
    }

    /// Read and parse a YAML file with context-rich errors.
    pub fn read_yaml<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> Result<T> {
        let file = std::fs::File::open(path)
            .map_err(|e| Self::io_context("Failed to read", path.display(), e))?;
        let reader = std::io::BufReader::new(file);
        serde_yml::from_reader(reader).map_err(|e| Self::parse_context("YAML", path.display(), e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    #[test]
    fn test_io_context_creates_formatted_error() {
        let io_err = io::Error::new(io::ErrorKind::NotFound, "no such file");
        let err = TracePilotError::io_context("Failed to read", "/tmp/test.yaml", io_err);

        let msg = err.to_string();
        assert!(msg.contains("Parse error"));
        assert!(msg.contains("Failed to read"));
        assert!(msg.contains("/tmp/test.yaml"));

        // Verify source error is preserved
        match &err {
            TracePilotError::ParseError { context, source } => {
                assert_eq!(context, "Failed to read /tmp/test.yaml");
                assert!(source.is_some());
                let source_msg = source.as_ref().unwrap().to_string();
                assert!(source_msg.contains("no such file"));
            }
            _ => panic!("Expected ParseError, got {:?}", err),
        }
    }

    #[test]
    fn test_parse_context_creates_formatted_error() {
        let json_err = serde_json::from_str::<i32>("not a number").unwrap_err();
        let err = TracePilotError::parse_context("JSON", "/data/config.json", json_err);

        let msg = err.to_string();
        assert!(msg.contains("Parse error"));
        assert!(msg.contains("Failed to parse JSON"));
        assert!(msg.contains("/data/config.json"));

        // Verify source error is preserved
        match &err {
            TracePilotError::ParseError { context, source } => {
                assert_eq!(context, "Failed to parse JSON /data/config.json");
                assert!(source.is_some());
            }
            _ => panic!("Expected ParseError, got {:?}", err),
        }
    }

    #[test]
    fn test_parse_context_with_yaml_error() {
        let yaml_err = serde_yml::from_str::<i32>("not: valid: yaml:").unwrap_err();
        let err = TracePilotError::parse_context("YAML", "/config/app.yaml", yaml_err);

        match &err {
            TracePilotError::ParseError { context, source } => {
                assert_eq!(context, "Failed to parse YAML /config/app.yaml");
                assert!(source.is_some());
            }
            _ => panic!("Expected ParseError, got {:?}", err),
        }
    }

    #[test]
    fn test_io_context_with_display_trait() {
        use std::path::PathBuf;
        let path = PathBuf::from("/home/user/workspace.yaml");
        let io_err = io::Error::new(io::ErrorKind::PermissionDenied, "access denied");
        let err = TracePilotError::io_context("Failed to open", path.display(), io_err);

        match &err {
            TracePilotError::ParseError { context, .. } => {
                assert!(context.contains("/home/user/workspace.yaml"));
            }
            _ => panic!("Expected ParseError, got {:?}", err),
        }
    }
}
