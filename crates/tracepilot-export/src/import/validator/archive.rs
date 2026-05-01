use std::collections::HashSet;

use crate::document::SessionArchive;
use crate::error::Result;

use super::issue::ValidationIssue;
use super::session::check_session;
use super::{MAX_SESSIONS, validation_err};

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
