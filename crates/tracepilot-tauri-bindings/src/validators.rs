//! Reusable input validation for Tauri command parameters.
//!
//! Centralises boundary checks that were previously scattered (or missing)
//! across individual command handlers.  Every public helper returns
//! [`CmdResult`] so callers can propagate with `?`.

use crate::error::{BindingsError, CmdResult};

/// Maximum number of items per page for paginated event responses.
///
/// Applied only when a caller supplies an explicit `limit`; omitting the
/// parameter preserves the existing "return everything" behaviour.
pub(crate) const MAX_EVENTS_PAGE_LIMIT: u32 = 10_000;

// ── Session-ID validation ─────────────────────────────────────────────────

/// Validate that a session ID is a well-formed UUID.
///
/// All Copilot CLI sessions use UUID directory names (enforced during
/// discovery by [`tracepilot_core::session::discovery`]).  Rejecting
/// malformed IDs at the IPC boundary provides:
///
/// * immediate, clear error messages instead of opaque "not found"
/// * fast rejection without filesystem I/O
/// * defence-in-depth regardless of downstream checks
pub(crate) fn validate_session_id(session_id: &str) -> CmdResult<()> {
    uuid::Uuid::parse_str(session_id).map_err(|_| {
        BindingsError::Validation(format!(
            "Invalid session ID format: expected UUID, got '{}'",
            truncate_for_display(session_id, 64)
        ))
    })?;
    Ok(())
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

// ── Pagination helpers ────────────────────────────────────────────────────

/// Clamp an explicit pagination limit to a safe upper bound.
///
/// * `None` ⇒ `None` (preserve "return all" semantics for callers that
///   need it, like the events endpoint).
/// * `Some(n)` ⇒ `Some(min(n, max_limit))`.
pub(crate) fn clamp_limit(limit: Option<u32>, max_limit: u32) -> Option<u32> {
    limit.map(|l| l.min(max_limit))
}

// ── Display helpers ───────────────────────────────────────────────────────

/// Truncate a string for inclusion in error messages.
///
/// Uses **character** (not byte) boundaries to avoid panicking on
/// multi-byte UTF-8 input.  Appends "…" when truncation occurs.
fn truncate_for_display(s: &str, max_chars: usize) -> String {
    let char_count = s.chars().count();
    if char_count <= max_chars {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_chars).collect();
        format!("{truncated}…")
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // -- validate_session_id ------------------------------------------------

    #[test]
    fn valid_uuid_passes() {
        assert!(validate_session_id("a1b2c3d4-e5f6-7890-abcd-ef1234567890").is_ok());
    }

    #[test]
    fn uppercase_uuid_passes() {
        assert!(validate_session_id("A1B2C3D4-E5F6-7890-ABCD-EF1234567890").is_ok());
    }

    #[test]
    fn invalid_uuid_fails_with_validation_error() {
        let err = validate_session_id("not-a-uuid").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Invalid session ID format"), "got: {msg}");
        assert!(msg.contains("not-a-uuid"), "should include input: {msg}");
    }

    #[test]
    fn empty_string_fails() {
        assert!(validate_session_id("").is_err());
    }

    #[test]
    fn partial_uuid_fails() {
        // Only the first segment of a valid UUID — not a full UUID.
        assert!(validate_session_id("a1b2c3d4").is_err());
    }

    // -- validate_optional_session_id ---------------------------------------

    #[test]
    fn optional_none_passes() {
        assert!(validate_optional_session_id(&None).is_ok());
    }

    #[test]
    fn optional_valid_passes() {
        let id = Some("a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_string());
        assert!(validate_optional_session_id(&id).is_ok());
    }

    #[test]
    fn optional_invalid_fails() {
        let id = Some("garbage".to_string());
        assert!(validate_optional_session_id(&id).is_err());
    }

    // -- validate_session_id_list -------------------------------------------

    #[test]
    fn list_all_valid() {
        let ids = vec![
            "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_string(),
            "b2c3d4e5-f6a7-8901-bcde-f12345678901".to_string(),
        ];
        assert!(validate_session_id_list(&ids).is_ok());
    }

    #[test]
    fn list_one_invalid_fails() {
        let ids = vec![
            "a1b2c3d4-e5f6-7890-abcd-ef1234567890".to_string(),
            "invalid".to_string(),
        ];
        assert!(validate_session_id_list(&ids).is_err());
    }

    #[test]
    fn empty_list_passes() {
        assert!(validate_session_id_list(&[]).is_ok());
    }

    // -- clamp_limit --------------------------------------------------------

    #[test]
    fn clamp_none_returns_none() {
        assert_eq!(clamp_limit(None, 500), None);
    }

    #[test]
    fn clamp_within_bounds_unchanged() {
        assert_eq!(clamp_limit(Some(50), 500), Some(50));
    }

    #[test]
    fn clamp_over_max_is_capped() {
        assert_eq!(clamp_limit(Some(99_999), 500), Some(500));
    }

    #[test]
    fn clamp_at_boundary() {
        assert_eq!(clamp_limit(Some(500), 500), Some(500));
    }

    // -- truncate_for_display -----------------------------------------------

    #[test]
    fn short_string_unchanged() {
        assert_eq!(truncate_for_display("abc", 10), "abc");
    }

    #[test]
    fn long_string_truncated_with_ellipsis() {
        let long = "a".repeat(100);
        let result = truncate_for_display(&long, 10);
        assert!(result.ends_with('…'), "should end with ellipsis: {result}");
        // 10 'a' chars + 1 '…' char = 11 chars
        assert_eq!(result.chars().count(), 11);
    }

    #[test]
    fn multibyte_characters_safe() {
        // Each 'é' is 2 bytes in UTF-8; byte-slicing at 5 bytes would panic.
        let s = "ééééé_extra";
        let result = truncate_for_display(s, 5);
        assert_eq!(result.chars().count(), 6); // 5 chars + '…'
        assert!(result.ends_with('…'));
    }

    #[test]
    fn emoji_safe() {
        let s = "🎉🎊🎃🎄🎅🎆🎇";
        let result = truncate_for_display(s, 3);
        assert_eq!(result.chars().count(), 4); // 3 emojis + '…'
        assert!(result.starts_with("🎉🎊🎃"));
    }

    #[test]
    fn exact_length_unchanged() {
        let result = truncate_for_display("abcde", 5);
        assert_eq!(result, "abcde");
    }
}
