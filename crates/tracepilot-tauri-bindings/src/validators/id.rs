//! UUID-format identifier validation (sessions, tasks, jobs).

use crate::error::{BindingsError, CmdResult};
use tracepilot_core::ids::SessionId;

use super::rules::truncate_for_display;

/// Validate that a session ID is a well-formed UUID.
///
/// All Copilot CLI sessions use UUID directory names (enforced during
/// discovery by [`tracepilot_core::session::discovery`]).  Rejecting
/// malformed IDs at the IPC boundary provides:
///
/// * immediate, clear error messages instead of opaque "not found"
/// * fast rejection without filesystem I/O
/// * defence-in-depth regardless of downstream checks
///
/// Returns a [`SessionId`] newtype on success so downstream callers can
/// carry a type-level proof that validation has occurred.
pub(crate) fn validate_session_id(session_id: &str) -> CmdResult<SessionId> {
    uuid::Uuid::parse_str(session_id).map_err(|_| {
        BindingsError::Validation(format!(
            "Invalid session ID format: expected UUID, got '{}'",
            truncate_for_display(session_id, 64)
        ))
    })?;
    Ok(SessionId::from_validated(session_id))
}

/// Validate an optional session-ID filter (e.g. for search queries).
pub(crate) fn validate_optional_session_id(session_id: &Option<String>) -> CmdResult<()> {
    if let Some(id) = session_id {
        validate_session_id(id)?;
    }
    Ok(())
}

/// Validate every ID in a batch (e.g. multi-session export).
pub(crate) fn validate_session_id_list(session_ids: &[String]) -> CmdResult<()> {
    for id in session_ids {
        validate_session_id(id)?;
    }
    Ok(())
}

fn validate_uuid_id(id: &str, label: &str) -> CmdResult<()> {
    uuid::Uuid::parse_str(id).map_err(|_| {
        BindingsError::Validation(format!(
            "Invalid {label} format: expected UUID, got '{}'",
            truncate_for_display(id, 64)
        ))
    })?;
    Ok(())
}

/// Validate that a task ID is a well-formed UUID.
///
/// All orchestrator tasks use UUID identifiers (enforced by the task database
/// schema).  Rejecting malformed IDs at the IPC boundary provides:
///
/// * immediate, clear error messages instead of opaque database errors
/// * fast rejection without database I/O
/// * defence-in-depth regardless of downstream checks
pub(crate) fn validate_task_id(task_id: &str) -> CmdResult<()> {
    validate_uuid_id(task_id, "task ID")
}

/// Validate a job ID (UUID format, same as task IDs).
///
/// Jobs share the same UUID identifier format as tasks. This wrapper provides
/// a correctly-worded error message when validating the `job_id` parameter.
pub(crate) fn validate_job_id(job_id: &str) -> CmdResult<()> {
    validate_uuid_id(job_id, "job ID")
}
