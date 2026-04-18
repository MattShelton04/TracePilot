//! Structural and security validation for imported archives.
//!
//! Runs after parsing to ensure the archive is safe and well-formed before
//! we attempt to write it to disk. Validation is intentionally strict:
//! we reject anything suspicious rather than silently accepting it.

use std::collections::HashSet;

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
/// Returns `Ok(())` if all checks pass, or the first blocking error found.
/// Delegates to [`collect_issues`] to ensure both the fast-fail import path
/// and the collect-all preview path apply identical validation rules.
pub fn validate_archive(archive: &SessionArchive) -> Result<()> {
    let issues = collect_issues(archive);
    match issues.iter().find(|i| i.is_error()) {
        Some(issue) => Err(validation_err(&issue.message)),
        None => Ok(()),
    }
}

/// Collect all validation issues without short-circuiting.
///
/// Returns a list of human-readable warning/error messages. Useful for
/// preview mode where the user wants to see everything before deciding.
///
/// This is the single source of truth for archive validation.
/// [`validate_archive`] delegates to this function, so both the fast-fail
/// import path and the collect-all preview path run identical checks.
#[must_use]
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

    let mut seen_ids = HashSet::new();
    for (i, session) in archive.sessions.iter().enumerate() {
        if !seen_ids.insert(&session.metadata.id) {
            issues.push(ValidationIssue::error(&format!(
                "Duplicate session ID: {:?}",
                session.metadata.id
            )));
        }
        check_session(session, i, &mut issues);
    }

    issues
}

// ── Per-session validation ─────────────────────────────────────────────────

/// Run all session-level validation checks, collecting issues into `issues`.
///
/// This is the single source of truth for per-session validation. Both the
/// fast-fail import path (`validate_archive`) and the collect-all preview
/// path (`collect_issues`) delegate here, ensuring the two can never diverge.
fn check_session(session: &PortableSession, idx: usize, issues: &mut Vec<ValidationIssue>) {
    let prefix = format!("Session {}", idx);
    let id = &session.metadata.id;

    // ── Session ID checks ──────────────────────────────────────────

    if id.is_empty() {
        issues.push(ValidationIssue::error(&format!("{}: ID is empty", prefix)));
    }
    if id.len() > MAX_ID_LENGTH {
        issues.push(ValidationIssue::error(&format!(
            "{}: ID too long ({} chars, max {})",
            prefix,
            id.len(),
            MAX_ID_LENGTH
        )));
    }
    if contains_path_traversal(id) {
        issues.push(ValidationIssue::error(&format!(
            "{}: ID contains path traversal: {:?}",
            prefix, id
        )));
    }

    // Warn if the ID doesn't look like a UUID — session discovery may not find it
    if !id.is_empty() && !looks_like_uuid(id) {
        issues.push(ValidationIssue::warning(&format!(
            "{}: ID {:?} is not a UUID — imported session may not appear in session list",
            prefix, id
        )));
    }

    // ── Checkpoint checks ──────────────────────────────────────────

    if let Some(checkpoints) = &session.checkpoints {
        let mut seen_filenames = HashSet::new();
        for cp in checkpoints {
            // Run the same validation as validate_filename (path traversal,
            // path separators, reserved names, dangerous characters)
            if let Err(e) = validate_filename_with_prefix(&cp.filename, &prefix) {
                issues.push(ValidationIssue::error(&e.to_string()));
            }
            if !seen_filenames.insert(&cp.filename) {
                issues.push(ValidationIssue::error(&format!(
                    "{}: duplicate checkpoint filename: {:?}",
                    prefix, cp.filename
                )));
            }
            // Size limit check
            if let Some(content) = &cp.content
                && content.len() > MAX_SECTION_SIZE
            {
                issues.push(ValidationIssue::error(&format!(
                    "{}: checkpoint '{}' content too large: {} bytes (max {})",
                    prefix,
                    cp.filename,
                    content.len(),
                    MAX_SECTION_SIZE
                )));
            }
        }
    }

    // ── Size limit checks ──────────────────────────────────────────

    if let Some(plan) = &session.plan
        && plan.len() > MAX_SECTION_SIZE
    {
        issues.push(ValidationIssue::error(&format!(
            "{}: plan too large: {} bytes (max {})",
            prefix,
            plan.len(),
            MAX_SECTION_SIZE
        )));
    }

    if let Some(events) = &session.events
        && events.len() > MAX_EVENTS
    {
        issues.push(ValidationIssue::error(&format!(
            "{}: too many events: {} (max {})",
            prefix,
            events.len(),
            MAX_EVENTS
        )));
    }

    // ── Warnings (non-blocking) ────────────────────────────────────

    if session.conversation.is_none() && session.events.is_none() {
        issues.push(ValidationIssue::warning(&format!(
            "{}: no conversation or events data",
            prefix
        )));
    }
}

// ── Security helpers ───────────────────────────────────────────────────────

/// Check if a string contains path traversal sequences or absolute paths.
pub(crate) fn contains_path_traversal(s: &str) -> bool {
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

/// Check if a string looks like a standard UUID (8-4-4-4-12 hex pattern).
fn looks_like_uuid(s: &str) -> bool {
    if s.len() != 36 {
        return false;
    }
    s.bytes().enumerate().all(|(i, b)| match i {
        8 | 13 | 18 | 23 => b == b'-',
        _ => b.is_ascii_hexdigit(),
    })
}

/// Validate a filename with a prefix for error messages.
fn validate_filename_with_prefix(name: &str, prefix: &str) -> Result<()> {
    let pfx = if prefix.is_empty() {
        String::new()
    } else {
        format!("{}: ", prefix)
    };
    if name.is_empty() {
        return Err(validation_err(&format!("{}filename is empty", pfx)));
    }
    // Reject path separators — filenames must be flat, not nested
    if name.contains('/') || name.contains('\\') {
        return Err(validation_err(&format!(
            "{}checkpoint filename contains path separator: {}",
            pfx, name
        )));
    }
    if contains_path_traversal(name) {
        return Err(validation_err(&format!(
            "{}filename contains path traversal: {:?}",
            pfx, name
        )));
    }
    // Reject reserved names that would collide with generated files
    let reserved = ["index.md", "index.html", "index.json"];
    if reserved.iter().any(|r| name.eq_ignore_ascii_case(r)) {
        return Err(validation_err(&format!(
            "{}filename {:?} is reserved and cannot be used for checkpoints",
            pfx, name
        )));
    }
    // Reject control characters and common shell-dangerous chars
    if name.contains(|c: char| c.is_control() || matches!(c, '|' | '>' | '<' | '&' | ';' | '`')) {
        return Err(validation_err(&format!(
            "{}filename contains dangerous characters: {:?}",
            pfx, name
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

    #[test]
    fn rejects_duplicate_session_ids() {
        let s1 = minimal_session();
        let s2 = minimal_session(); // same ID as s1
        let mut archive = test_archive(s1);
        archive.sessions.push(s2);

        let err = validate_archive(&archive).unwrap_err();
        assert!(err.to_string().contains("Duplicate session ID"));
    }

    #[test]
    fn collect_issues_reports_duplicate_ids() {
        let s1 = minimal_session();
        let s2 = minimal_session();
        let mut archive = test_archive(s1);
        archive.sessions.push(s2);

        let issues = collect_issues(&archive);
        assert!(
            issues
                .iter()
                .any(|i| i.is_error() && i.message.contains("Duplicate session ID"))
        );
    }

    #[test]
    fn rejects_reserved_checkpoint_filename() {
        let mut session = minimal_session();
        session.checkpoints = Some(vec![CheckpointExport {
            number: 1,
            title: "sneaky".to_string(),
            filename: "index.md".to_string(),
            content: Some("overwrite the index".to_string()),
        }]);
        let archive = test_archive(session);
        let err = validate_archive(&archive).unwrap_err();
        assert!(err.to_string().contains("reserved"));
    }

    #[test]
    fn warns_on_non_uuid_session_id() {
        let mut session = minimal_session();
        session.metadata.id = "not-a-uuid".to_string();
        let archive = test_archive(session);

        let issues = collect_issues(&archive);
        assert!(
            issues.iter().any(|i| {
                i.severity == IssueSeverity::Warning && i.message.contains("not a UUID")
            })
        );
    }

    #[test]
    fn no_warning_for_valid_uuid() {
        let mut session = minimal_session();
        session.metadata.id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_string();
        let archive = test_archive(session);
        let issues = collect_issues(&archive);
        assert!(!issues.iter().any(|i| i.message.contains("not a UUID")));
    }

    #[test]
    fn reports_duplicate_checkpoint_filenames() {
        let mut session = minimal_session();
        session.checkpoints = Some(vec![
            CheckpointExport {
                number: 1,
                title: "first".to_string(),
                filename: "001-first.md".to_string(),
                content: None,
            },
            CheckpointExport {
                number: 2,
                title: "dup".to_string(),
                filename: "001-first.md".to_string(),
                content: None,
            },
        ]);
        let archive = test_archive(session);
        let issues = collect_issues(&archive);
        assert!(
            issues
                .iter()
                .any(|i| i.is_error() && i.message.contains("duplicate checkpoint filename"))
        );
    }

    #[test]
    fn rejects_path_separator_in_checkpoint_filename() {
        let mut session = minimal_session();
        session.checkpoints = Some(vec![CheckpointExport {
            number: 1,
            title: "nested".to_string(),
            filename: "nested/file.md".to_string(),
            content: None,
        }]);
        let archive = test_archive(session);
        let err = validate_archive(&archive).unwrap_err();
        assert!(err.to_string().contains("path separator"));
    }

    #[test]
    fn rejects_backslash_in_checkpoint_filename() {
        let mut session = minimal_session();
        session.checkpoints = Some(vec![CheckpointExport {
            number: 1,
            title: "nested".to_string(),
            filename: r"nested\file.md".to_string(),
            content: None,
        }]);
        let archive = test_archive(session);
        let err = validate_archive(&archive).unwrap_err();
        assert!(err.to_string().contains("path separator"));
    }

    #[test]
    fn collect_issues_rejects_path_separator_in_checkpoint_filename() {
        let mut session = minimal_session();
        session.checkpoints = Some(vec![CheckpointExport {
            number: 1,
            title: "nested".to_string(),
            filename: "sub/dir.md".to_string(),
            content: None,
        }]);
        let archive = test_archive(session);
        let issues = collect_issues(&archive);
        assert!(
            issues
                .iter()
                .any(|i| i.is_error() && i.message.contains("path separator"))
        );
    }

    #[test]
    fn collect_issues_reports_reserved_checkpoint_filename() {
        let mut session = minimal_session();
        session.checkpoints = Some(vec![CheckpointExport {
            number: 1,
            title: "sneaky".to_string(),
            filename: "index.md".to_string(),
            content: Some("overwrite the index".to_string()),
        }]);
        let archive = test_archive(session);
        let issues = collect_issues(&archive);
        assert!(
            issues
                .iter()
                .any(|i| i.is_error() && i.message.contains("reserved"))
        );
    }

    #[test]
    fn collect_issues_reports_dangerous_chars_in_checkpoint_filename() {
        let mut session = minimal_session();
        session.checkpoints = Some(vec![CheckpointExport {
            number: 1,
            title: "bad".to_string(),
            filename: "file|bad.md".to_string(),
            content: None,
        }]);
        let archive = test_archive(session);
        let issues = collect_issues(&archive);
        assert!(
            issues
                .iter()
                .any(|i| i.is_error() && i.message.contains("dangerous characters"))
        );
    }

    // ── Tests for previously-missing checks (fixed by unification) ──

    #[test]
    fn validate_archive_rejects_duplicate_checkpoint_filenames() {
        // Previously only collect_issues checked this — validate_archive did not.
        let mut session = minimal_session();
        session.checkpoints = Some(vec![
            CheckpointExport {
                number: 1,
                title: "first".to_string(),
                filename: "001-first.md".to_string(),
                content: None,
            },
            CheckpointExport {
                number: 2,
                title: "dup".to_string(),
                filename: "001-first.md".to_string(),
                content: None,
            },
        ]);
        let archive = test_archive(session);
        let err = validate_archive(&archive).unwrap_err();
        assert!(err.to_string().contains("duplicate checkpoint filename"));
    }

    #[test]
    fn collect_issues_reports_plan_too_large() {
        // Previously only validate_session checked plan size — collect_issues did not.
        let mut session = minimal_session();
        session.plan = Some("x".repeat(MAX_SECTION_SIZE + 1));
        let archive = test_archive(session);

        let issues = collect_issues(&archive);
        assert!(
            issues
                .iter()
                .any(|i| i.is_error() && i.message.contains("plan too large"))
        );
    }

    #[test]
    fn collect_issues_reports_too_many_events() {
        // Previously only validate_session checked event count — collect_issues did not.
        use crate::document::RawEvent;

        let event = RawEvent {
            event_type: "test".to_string(),
            data: serde_json::Value::Null,
            id: None,
            timestamp: None,
            parent_id: None,
        };
        let mut session = minimal_session();
        session.events = Some(vec![event; MAX_EVENTS + 1]);
        let archive = test_archive(session);
        let issues = collect_issues(&archive);
        assert!(
            issues
                .iter()
                .any(|i| i.is_error() && i.message.contains("too many events"))
        );
    }

    #[test]
    fn preview_and_import_agree_on_plan_too_large() {
        // Regression guard: both paths must reject an oversized plan.
        let mut session = minimal_session();
        session.plan = Some("x".repeat(MAX_SECTION_SIZE + 1));
        let archive = test_archive(session);

        let issues = collect_issues(&archive);
        let validate_result = validate_archive(&archive);

        assert!(issues.iter().any(|i| i.is_error()));
        assert!(validate_result.is_err());
    }

    #[test]
    fn preview_and_import_agree_on_duplicate_checkpoint_filenames() {
        // Regression guard: both paths must reject duplicate checkpoint filenames.
        let mut session = minimal_session();
        session.checkpoints = Some(vec![
            CheckpointExport {
                number: 1,
                title: "first".to_string(),
                filename: "dup.md".to_string(),
                content: None,
            },
            CheckpointExport {
                number: 2,
                title: "second".to_string(),
                filename: "dup.md".to_string(),
                content: None,
            },
        ]);
        let archive = test_archive(session);

        let issues = collect_issues(&archive);
        let validate_result = validate_archive(&archive);

        assert!(issues.iter().any(|i| i.is_error()));
        assert!(validate_result.is_err());
    }

    #[test]
    fn warnings_do_not_block_import() {
        // Warnings (non-UUID ID, missing conversation/events) must not cause
        // validate_archive to fail — only errors should block.
        let mut session = minimal_session();
        session.metadata.id = "not-a-uuid".to_string();
        session.conversation = None;
        session.events = None;
        let archive = test_archive(session);

        let issues = collect_issues(&archive);
        // Should have warnings but no errors
        assert!(issues.iter().any(|i| i.severity == IssueSeverity::Warning));
        assert!(!issues.iter().any(|i| i.is_error()));
        // Import should succeed
        assert!(validate_archive(&archive).is_ok());
    }
}
