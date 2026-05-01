//! Structural and security validation for imported archives.
//!
//! Runs after parsing to ensure the archive is safe and well-formed before
//! we attempt to write it to disk. Validation is intentionally strict:
//! we reject anything suspicious rather than silently accepting it.

mod archive;
mod issue;
mod safety;
mod session;

#[cfg(test)]
mod tests;

pub use archive::{collect_issues, validate_archive};
pub use issue::{IssueSeverity, ValidationIssue};
pub(crate) use safety::contains_path_traversal;

use crate::error::ExportError;

/// Maximum number of sessions in a single import archive.
pub const MAX_SESSIONS: usize = 100;

/// Maximum bytes for any single text section (plan, checkpoint content).
pub const MAX_SECTION_SIZE: usize = 50 * 1024 * 1024; // 50 MB

/// Maximum number of events per session.
pub const MAX_EVENTS: usize = 500_000;

/// Maximum length for a session ID.
pub const MAX_ID_LENGTH: usize = 256;

fn validation_err(message: &str) -> ExportError {
    ExportError::Validation {
        message: message.to_string(),
    }
}
