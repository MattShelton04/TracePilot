use std::collections::HashSet;

use crate::document::PortableSession;

use super::issue::ValidationIssue;
use super::safety::{contains_path_traversal, looks_like_uuid, validate_filename_with_prefix};
use super::{MAX_EVENTS, MAX_ID_LENGTH, MAX_SECTION_SIZE};

/// Run all session-level validation checks, collecting issues into `issues`.
///
/// This is the single source of truth for per-session validation. Both the
/// fast-fail import path (`validate_archive`) and the collect-all preview
/// path (`collect_issues`) delegate here, ensuring the two can never diverge.
pub(super) fn check_session(
    session: &PortableSession,
    idx: usize,
    issues: &mut Vec<ValidationIssue>,
) {
    let prefix = format!("Session {}", idx);
    let id = &session.metadata.id;

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

    if let Some(checkpoints) = &session.checkpoints {
        let mut seen_filenames = HashSet::new();
        for cp in checkpoints {
            if let Err(e) = validate_filename_with_prefix(&cp.filename, &prefix) {
                issues.push(ValidationIssue::error(&e.to_string()));
            }
            if !seen_filenames.insert(&cp.filename) {
                issues.push(ValidationIssue::error(&format!(
                    "{}: duplicate checkpoint filename: {:?}",
                    prefix, cp.filename
                )));
            }
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

    if session.conversation.is_none() && session.events.is_none() {
        issues.push(ValidationIssue::warning(&format!(
            "{}: no conversation or events data",
            prefix
        )));
    }
}
