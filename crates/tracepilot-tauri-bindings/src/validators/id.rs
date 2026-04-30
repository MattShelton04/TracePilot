//! UUID-format identifier validation (sessions).

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
