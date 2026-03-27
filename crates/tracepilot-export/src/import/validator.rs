//! Structural and security validation for imported archives.
//!
//! Runs after parsing to ensure the archive is safe and well-formed before
//! we attempt to write it to disk. Validation is intentionally strict:
//! we reject anything suspicious rather than silently accepting it.

use crate::document::{PortableSession, SessionArchive};
use crate::error::{ExportError, Result};

/// Maximum number of sessions in a single import archive.
pub const MAX_SESSIONS: usize = 100;

/// Maximum bytes for any single text section (plan, checkpoint content).
pub const MAX_SECTION_SIZE: usize = 50 * 1024 * 1024; // 50 MB

/// Maximum number of events per session.
pub const MAX_EVENTS: usize = 500_000;

/// Maximum length for a session ID.
pub const MAX_ID_LENGTH: usize = 256;

/// Validate an entire archive for import safety.
///
/// Returns `Ok(())` if all checks pass, or the first error found.
pub fn validate_archive(archive: &SessionArchive) -> Result<()> {
    // Archive-level checks
    if archive.sessions.is_empty() {
        return Err(validation_err("archive contains no sessions"));
    }
    if archive.sessions.len() > MAX_SESSIONS {
        return Err(validation_err(&format!(
            "too many sessions: {} (max {})",
            archive.sessions.len(),
            MAX_SESSIONS
        )));
    }

    // Per-session checks
    for (i, session) in archive.sessions.iter().enumerate() {
        validate_session(session)
            .map_err(|e| validation_err(&format!("session {}: {}", i, e)))?;
    }

    Ok(())
}

/// Collect all validation issues without short-circuiting.
///
/// Returns a list of human-readable warning/error messages. Useful for
/// preview mode where the user wants to see everything before deciding.
pub fn collect_issues(archive: &SessionArchive) -> Vec<ValidationIssue> {
    let mut issues = Vec::new();

    if archive.sessions.is_empty() {
        issues.push(ValidationIssue::error("Archive contains no sessions"));
    }
    if archive.sessions.len() > MAX_SESSIONS {
        issues.push(ValidationIssue::error(&format!(
            "Too many sessions: {} (max {})",
            archive.sessions.len(),
            MAX_SESSIONS
        )));
    }

    for (i, session) in archive.sessions.iter().enumerate() {
        collect_session_issues(session, i, &mut issues);
    }

    issues
}

// ── Per-session validation ─────────────────────────────────────────────────

fn validate_session(session: &PortableSession) -> Result<()> {
    let id = &session.metadata.id;

    // Required: session ID
    if id.is_empty() {
        return Err(validation_err("session ID is empty"));
    }
    if id.len() > MAX_ID_LENGTH {
        return Err(validation_err(&format!(
            "session ID too long: {} chars (max {})",
            id.len(),
            MAX_ID_LENGTH
        )));
    }

    // Security: path traversal in ID
    if contains_path_traversal(id) {
        return Err(validation_err(&format!(
            "session ID contains path traversal: {:?}",
            id
        )));
    }

    // Security: check checkpoint filenames and content sizes
    if let Some(checkpoints) = &session.checkpoints {
        for cp in checkpoints {
            validate_filename(&cp.filename)?;
            if let Some(content) = &cp.content {
                if content.len() > MAX_SECTION_SIZE {
                    return Err(validation_err(&format!(
                        "checkpoint '{}' content too large: {} bytes (max {})",
                        cp.filename,
                        content.len(),
                        MAX_SECTION_SIZE
                    )));
                }
            }
        }
    }

    // Size limits on text sections
    if let Some(plan) = &session.plan {
        if plan.len() > MAX_SECTION_SIZE {
            return Err(validation_err(&format!(
                "plan too large: {} bytes (max {})",
                plan.len(),
                MAX_SECTION_SIZE
            )));
        }
    }

    if let Some(events) = &session.events {
        if events.len() > MAX_EVENTS {
            return Err(validation_err(&format!(
                "too many events: {} (max {})",
                events.len(),
                MAX_EVENTS
            )));
        }
    }

    Ok(())
}

fn collect_session_issues(session: &PortableSession, idx: usize, issues: &mut Vec<ValidationIssue>) {
    let prefix = format!("Session {}", idx);
    let id = &session.metadata.id;

    if id.is_empty() {
        issues.push(ValidationIssue::error(&format!("{}: ID is empty", prefix)));
    }
    if id.len() > MAX_ID_LENGTH {
        issues.push(ValidationIssue::error(&format!(
            "{}: ID too long ({} chars)",
            prefix,
            id.len()
        )));
    }
    if contains_path_traversal(id) {
        issues.push(ValidationIssue::error(&format!(
            "{}: ID contains path traversal",
            prefix
        )));
    }

    if let Some(checkpoints) = &session.checkpoints {
        for cp in checkpoints {
            if contains_path_traversal(&cp.filename) {
                issues.push(ValidationIssue::error(&format!(
                    "{}: checkpoint filename contains path traversal: {:?}",
                    prefix, cp.filename
                )));
            }
        }
    }

    // Warnings (non-blocking)
    if session.conversation.is_none() && session.events.is_none() {
        issues.push(ValidationIssue::warning(&format!(
            "{}: no conversation or events data",
            prefix
        )));
    }
}

// ── Security helpers ───────────────────────────────────────────────────────

/// Check if a string contains path traversal sequences or absolute paths.
fn contains_path_traversal(s: &str) -> bool {
    use std::path::{Component, Path};

    let path = Path::new(s);

    // Reject absolute paths (covers `/`, `\`, `C:\`, `\\server`, etc.)
    if path.is_absolute() {
        return true;
    }

    // Reject any component that is `..` or a Windows prefix (e.g. `C:`)
    for component in path.components() {
        match component {
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => return true,
            _ => {}
        }
    }

    // Belt-and-suspenders: also catch `://` and bare `..` in the string
    s.contains("..") || s.contains(":/")
}

/// Validate a filename is safe for filesystem use.
fn validate_filename(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(validation_err("filename is empty"));
    }
    if contains_path_traversal(name) {
        return Err(validation_err(&format!(
            "filename contains path traversal: {:?}",
            name
        )));
    }
    // Reject control characters and common shell-dangerous chars
    if name.contains(|c: char| c.is_control() || matches!(c, '|' | '>' | '<' | '&' | ';' | '`')) {
        return Err(validation_err(&format!(
            "filename contains dangerous characters: {:?}",
            name
        )));
    }
    Ok(())
}

fn validation_err(message: &str) -> ExportError {
    ExportError::Validation {
        message: message.to_string(),
    }
}

// ── Validation issue types ─────────────────────────────────────────────────

/// A validation finding — either blocking (error) or advisory (warning).
#[derive(Debug, Clone)]
pub struct ValidationIssue {
    pub severity: IssueSeverity,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssueSeverity {
    Error,
    Warning,
}

impl ValidationIssue {
    pub fn error(msg: &str) -> Self {
        Self {
            severity: IssueSeverity::Error,
            message: msg.to_string(),
        }
    }
    pub fn warning(msg: &str) -> Self {
        Self {
            severity: IssueSeverity::Warning,
            message: msg.to_string(),
        }
    }
    pub fn is_error(&self) -> bool {
        self.severity == IssueSeverity::Error
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::CheckpointExport;
    use crate::test_helpers::{minimal_session, test_archive};

    #[test]
    fn valid_archive_passes() {
        let archive = test_archive(minimal_session());
        assert!(validate_archive(&archive).is_ok());
    }

    #[test]
    fn rejects_empty_archive() {
        let mut archive = test_archive(minimal_session());
        archive.sessions.clear();
        assert!(validate_archive(&archive).is_err());
    }

    #[test]
    fn rejects_empty_session_id() {
        let mut session = minimal_session();
        session.metadata.id = String::new();
        let archive = test_archive(session);
        assert!(validate_archive(&archive).is_err());
    }

    #[test]
    fn rejects_path_traversal_in_id() {
        let mut session = minimal_session();
        session.metadata.id = "../../../etc/passwd".to_string();
        let archive = test_archive(session);
        let err = validate_archive(&archive).unwrap_err();
        assert!(err.to_string().contains("path traversal"));
    }

    #[test]
    fn rejects_absolute_unix_path_in_id() {
        let mut session = minimal_session();
        session.metadata.id = "/etc/evil".to_string();
        let archive = test_archive(session);
        assert!(validate_archive(&archive).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_absolute_path_in_id() {
        let mut session = minimal_session();
        session.metadata.id = r"C:\evil\pwn".to_string();
        let archive = test_archive(session);
        assert!(validate_archive(&archive).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn rejects_unc_path_in_id() {
        let mut session = minimal_session();
        session.metadata.id = r"\\server\share".to_string();
        let archive = test_archive(session);
        assert!(validate_archive(&archive).is_err());
    }

    #[test]
    fn rejects_path_traversal_in_checkpoint_filename() {
        let mut session = minimal_session();
        session.checkpoints = Some(vec![CheckpointExport {
            number: 1,
            title: "evil".to_string(),
            filename: "../../evil.sh".to_string(),
            content: None,
        }]);
        let archive = test_archive(session);
        assert!(validate_archive(&archive).is_err());
    }

    #[test]
    fn rejects_dangerous_filename_chars() {
        let mut session = minimal_session();
        session.checkpoints = Some(vec![CheckpointExport {
            number: 1,
            title: "bad".to_string(),
            filename: "file|bad.md".to_string(),
            content: None,
        }]);
        let archive = test_archive(session);
        assert!(validate_archive(&archive).is_err());
    }

    #[test]
    fn collect_issues_finds_warnings() {
        let mut session = minimal_session();
        session.conversation = None;
        session.events = None;
        let archive = test_archive(session);

        let issues = collect_issues(&archive);
        assert!(issues.iter().any(|i| i.severity == IssueSeverity::Warning));
    }

    #[test]
    fn collect_issues_finds_errors() {
        let mut session = minimal_session();
        session.metadata.id = String::new();
        let archive = test_archive(session);

        let issues = collect_issues(&archive);
        assert!(issues.iter().any(|i| i.is_error()));
    }
}
