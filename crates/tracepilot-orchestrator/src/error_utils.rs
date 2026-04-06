//! Shared error utilities for building error messages with context.
//!
//! This module provides helper functions that eliminate duplication across
//! error types that need to format error messages as "{context}: {source}".

/// Format an error message with context and source.
///
/// # Examples
///
/// ```
/// use tracepilot_orchestrator::error_utils::format_error_with_context;
///
/// let msg = format_error_with_context("Failed to read config", "file not found");
/// assert_eq!(msg, "Failed to read config: file not found");
/// ```
pub fn format_error_with_context(
    context: impl std::fmt::Display,
    source: impl std::fmt::Display,
) -> String {
    format!("{context}: {source}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_context_and_source() {
        let result = format_error_with_context("Operation failed", "timeout");
        assert_eq!(result, "Operation failed: timeout");
    }

    #[test]
    fn handles_display_trait_types() {
        let result = format_error_with_context(
            String::from("Context"),
            std::io::Error::new(std::io::ErrorKind::NotFound, "file missing"),
        );
        assert!(result.starts_with("Context: "));
        assert!(result.contains("file missing"));
    }

    #[test]
    fn works_with_error_types() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
        let result = format_error_with_context("Failed to write", io_err);
        assert!(result.starts_with("Failed to write: "));
        assert!(result.contains("access denied"));
    }

    #[test]
    fn preserves_exact_formatting() {
        // Verify the format matches the original implementations
        let result = format_error_with_context("prefix", "suffix");
        assert_eq!(result, "prefix: suffix");
        assert!(result.contains(": "));
        assert!(!result.contains(" : ")); // No extra spaces
    }
}
