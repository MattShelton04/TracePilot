//! Reusable input validation for Tauri command parameters.
//!
//! Centralises boundary checks that were previously scattered (or missing)
//! across individual command handlers.  Every public helper returns
//! [`CmdResult`] so callers can propagate with `?`.

use crate::error::{BindingsError, CmdResult};
use tracepilot_core::ids::{PresetId, SessionId, SkillName};

/// Maximum number of items per page for paginated event responses.
///
/// Applied only when a caller supplies an explicit `limit`; omitting the
/// parameter preserves the existing "return everything" behaviour.
pub(crate) const MAX_EVENTS_PAGE_LIMIT: u32 = 10_000;

// ── Identifier validation ─────────────────────────────────────────────────

/// Validate a template ID.
///
/// Template IDs must be safe for use in filesystem operations and cannot
/// contain path traversal sequences. Alphanumeric characters, hyphens, and
/// underscores are allowed.
///
/// This uses the shared validation logic from `tracepilot_orchestrator::validation`
/// to ensure consistency across all identifier validation.
pub(crate) fn validate_template_id(id: &str) -> CmdResult<()> {
    tracepilot_orchestrator::validation::validate_identifier(
        id,
        tracepilot_orchestrator::validation::TEMPLATE_ID_RULES,
        "Template ID",
    )
    .map_err(BindingsError::Validation)
}

/// Validate a preset ID.
///
/// Preset IDs must be safe for use in filesystem operations and cannot
/// contain path traversal sequences. Alphanumeric characters, hyphens, and
/// underscores are allowed.
///
/// Returns a [`PresetId`] newtype — callers get a type-checked receipt that
/// validation has happened, instead of re-validating (or forgetting to) at
/// every downstream boundary.
pub(crate) fn validate_preset_id(id: &str) -> CmdResult<PresetId> {
    tracepilot_orchestrator::validation::validate_identifier(
        id,
        tracepilot_orchestrator::validation::TEMPLATE_ID_RULES,
        "Preset ID",
    )
    .map_err(BindingsError::Validation)?;
    Ok(PresetId::from_validated(id))
}

/// Validate a skill name.
///
/// Skill names must be safe for use in filesystem operations and cannot
/// contain path traversal sequences or path separators. Character restrictions
/// are more permissive than template/preset IDs to support existing skill
/// naming conventions.
///
/// Returns a [`SkillName`] newtype on success.
pub(crate) fn validate_skill_name(name: &str) -> CmdResult<SkillName> {
    tracepilot_orchestrator::validation::validate_identifier(
        name,
        tracepilot_orchestrator::validation::SKILL_NAME_RULES,
        "Skill name",
    )
    .map_err(BindingsError::Validation)?;
    Ok(SkillName::from_validated(name))
}

/// Validate an asset name for skills.
///
/// Asset names must be safe for use in filesystem operations. Uses the same
/// rules as skill names to allow flexibility while preventing path traversal.
pub(crate) fn validate_asset_name(name: &str) -> CmdResult<()> {
    tracepilot_orchestrator::skills::assets::validate_asset_name(name)
        .map_err(|e| BindingsError::Validation(e.to_string()))
}

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

// ── Task-ID validation ────────────────────────────────────────────────────

/// Validate that a task ID is a well-formed UUID.
///
/// All orchestrator tasks use UUID identifiers (enforced by the task database
/// schema).  Rejecting malformed IDs at the IPC boundary provides:
///
/// * immediate, clear error messages instead of opaque database errors
/// * fast rejection without database I/O
/// * defence-in-depth regardless of downstream checks
pub(crate) fn validate_task_id(task_id: &str) -> CmdResult<()> {
    uuid::Uuid::parse_str(task_id).map_err(|_| {
        BindingsError::Validation(format!(
            "Invalid task ID format: expected UUID, got '{}'",
            truncate_for_display(task_id, 64)
        ))
    })?;
    Ok(())
}

/// Validate a job ID (UUID format, same as task IDs).
///
/// Jobs share the same UUID identifier format as tasks. This wrapper provides
/// a correctly-worded error message when validating the `job_id` parameter.
pub(crate) fn validate_job_id(job_id: &str) -> CmdResult<()> {
    uuid::Uuid::parse_str(job_id).map_err(|_| {
        BindingsError::Validation(format!(
            "Invalid job ID format: expected UUID, got '{}'",
            truncate_for_display(job_id, 64)
        ))
    })?;
    Ok(())
}

// ── Date validation ───────────────────────────────────────────────────────

/// Maximum reasonable Unix timestamp (year 3000-01-01).
///
/// Used to reject obviously invalid timestamps that would cause confusing
/// downstream behavior. Real session timestamps should never exceed this.
const MAX_UNIX_TIMESTAMP: i64 = 32503680000; // 3000-01-01 00:00:00 UTC

/// Validate a single Unix timestamp is within reasonable bounds.
///
/// Rejects negative timestamps and dates far in the future (>= year 3000).
fn validate_unix_timestamp(timestamp: i64, param_name: &str) -> CmdResult<()> {
    if timestamp < 0 {
        return Err(BindingsError::Validation(format!(
            "Invalid {}: timestamp cannot be negative (got {})",
            param_name, timestamp
        )));
    }
    if timestamp >= MAX_UNIX_TIMESTAMP {
        return Err(BindingsError::Validation(format!(
            "Invalid {}: timestamp {} is too far in the future (max: {})",
            param_name, timestamp, MAX_UNIX_TIMESTAMP
        )));
    }
    Ok(())
}

/// Validate Unix timestamp date range (used by search commands).
///
/// Ensures:
/// * Individual timestamps are non-negative and < year 3000
/// * If both present: `from <= to`
///
/// Both parameters are optional; `None` values are always valid.
pub(crate) fn validate_unix_date_range(
    date_from: Option<i64>,
    date_to: Option<i64>,
) -> CmdResult<()> {
    // Validate individual timestamps
    if let Some(from) = date_from {
        validate_unix_timestamp(from, "date_from")?;
    }
    if let Some(to) = date_to {
        validate_unix_timestamp(to, "date_to")?;
    }

    // Validate range ordering
    if let (Some(from), Some(to)) = (date_from, date_to) {
        if from > to {
            return Err(BindingsError::Validation(format!(
                "Invalid date range: date_from ({}) is after date_to ({})",
                from, to
            )));
        }
    }
    Ok(())
}

/// Parse an ISO 8601 date string.
///
/// Accepts both full RFC 3339 datetimes (`2024-01-15T00:00:00Z`) and
/// date-only strings (`2024-01-15`) since the frontend sends `YYYY-MM-DD`
/// for analytics date range filters.
fn parse_iso_date(date_str: &str, param_name: &str) -> CmdResult<chrono::DateTime<chrono::Utc>> {
    let trimmed = date_str.trim();
    if trimmed.is_empty() {
        return Err(BindingsError::Validation(format!(
            "Invalid {}: cannot be empty or whitespace",
            param_name
        )));
    }

    // Try full RFC 3339 first (e.g. "2024-01-15T00:00:00Z")
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Ok(dt.with_timezone(&chrono::Utc));
    }

    // Fall back to date-only YYYY-MM-DD (frontend sends this format)
    if let Ok(nd) = chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        return Ok(nd
            .and_hms_opt(0, 0, 0)
            .expect("midnight is always valid")
            .and_utc());
    }

    Err(BindingsError::Validation(format!(
        "Invalid {}: '{}' is not a valid date (expected YYYY-MM-DD or RFC 3339 datetime)",
        param_name,
        truncate_for_display(date_str, 50),
    )))
}

/// Validate date range (used by analytics commands).
///
/// Ensures:
/// * Strings parse as valid dates (YYYY-MM-DD or RFC 3339 datetime)
/// * If both present: `from_date <= to_date`
///
/// Both parameters are optional; `None` values are always valid.
pub(crate) fn validate_iso_date_range(
    from_date: &Option<String>,
    to_date: &Option<String>,
) -> CmdResult<()> {
    // Parse and validate individual dates
    let from_parsed = if let Some(from) = from_date {
        Some(parse_iso_date(from, "from_date")?)
    } else {
        None
    };
    let to_parsed = if let Some(to) = to_date {
        Some(parse_iso_date(to, "to_date")?)
    } else {
        None
    };

    // Validate range ordering
    if let (Some(from), Some(to)) = (from_parsed, to_parsed) {
        if from > to {
            return Err(BindingsError::Validation(
                "Invalid date range: from_date is after to_date".to_string(),
            ));
        }
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
/// Truncates by **character count** (not byte count) for user-facing messages
/// where visual length matters. Appends "…" when truncation occurs.
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
    fn validate_session_id_returns_newtype_carrying_input() {
        let sid = validate_session_id("a1b2c3d4-e5f6-7890-abcd-ef1234567890").unwrap();
        assert_eq!(sid.as_str(), "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    }

    #[test]
    fn validate_preset_id_returns_newtype_carrying_input() {
        let pid = validate_preset_id("my-preset").unwrap();
        assert_eq!(pid.as_str(), "my-preset");
    }

    #[test]
    fn validate_skill_name_returns_newtype_carrying_input() {
        let sn = validate_skill_name("my.skill").unwrap();
        assert_eq!(sn.as_str(), "my.skill");
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

    // -- validate_task_id ---------------------------------------------------

    #[test]
    fn task_valid_uuid_passes() {
        assert!(validate_task_id("a1b2c3d4-e5f6-7890-abcd-ef1234567890").is_ok());
    }

    #[test]
    fn task_uppercase_uuid_passes() {
        assert!(validate_task_id("A1B2C3D4-E5F6-7890-ABCD-EF1234567890").is_ok());
    }

    #[test]
    fn task_invalid_uuid_fails_with_validation_error() {
        let err = validate_task_id("not-a-uuid").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Invalid task ID format"), "got: {msg}");
        assert!(msg.contains("not-a-uuid"), "should include input: {msg}");
    }

    #[test]
    fn task_empty_string_fails() {
        assert!(validate_task_id("").is_err());
    }

    #[test]
    fn task_partial_uuid_fails() {
        // Only the first segment of a valid UUID — not a full UUID.
        assert!(validate_task_id("a1b2c3d4").is_err());
    }

    // -- validate_job_id ------------------------------------------------------

    #[test]
    fn job_valid_uuid_passes() {
        assert!(validate_job_id("a1b2c3d4-e5f6-7890-abcd-ef1234567890").is_ok());
    }

    #[test]
    fn job_invalid_id_fails() {
        let err = validate_job_id("not-a-uuid").unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("job ID"),
            "error should say 'job ID', got: {msg}"
        );
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

    // -- validate_unix_date_range -------------------------------------------

    #[test]
    fn unix_range_both_none_passes() {
        assert!(validate_unix_date_range(None, None).is_ok());
    }

    #[test]
    fn unix_range_only_from_passes() {
        assert!(validate_unix_date_range(Some(1704067200), None).is_ok()); // 2024-01-01
    }

    #[test]
    fn unix_range_only_to_passes() {
        assert!(validate_unix_date_range(None, Some(1704067200)).is_ok());
    }

    #[test]
    fn unix_range_valid_range_passes() {
        assert!(validate_unix_date_range(Some(1704067200), Some(1704153600)).is_ok());
        // from: 2024-01-01, to: 2024-01-02
    }

    #[test]
    fn unix_range_equal_timestamps_passes() {
        let timestamp = 1704067200;
        assert!(validate_unix_date_range(Some(timestamp), Some(timestamp)).is_ok());
    }

    #[test]
    fn unix_range_swapped_fails() {
        let err = validate_unix_date_range(Some(1704153600), Some(1704067200)).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("date_from") && msg.contains("after"),
            "got: {msg}"
        );
    }

    #[test]
    fn unix_range_negative_from_fails() {
        let err = validate_unix_date_range(Some(-1), Some(1704067200)).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("negative") && msg.contains("date_from"),
            "got: {msg}"
        );
    }

    #[test]
    fn unix_range_negative_to_fails() {
        let err = validate_unix_date_range(Some(1704067200), Some(-100)).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("negative") && msg.contains("date_to"),
            "got: {msg}"
        );
    }

    #[test]
    fn unix_range_extreme_future_fails() {
        // Way beyond year 3000
        let err = validate_unix_date_range(Some(99999999999), None).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("too far in the future"), "got: {msg}");
    }

    #[test]
    fn unix_range_year_3000_boundary_fails() {
        // Exactly at MAX_UNIX_TIMESTAMP should fail
        let err = validate_unix_date_range(Some(32503680000), None).unwrap_err();
        assert!(err.to_string().contains("too far in the future"));
    }

    #[test]
    fn unix_range_just_before_year_3000_passes() {
        // One second before MAX should pass
        assert!(validate_unix_date_range(Some(32503679999), None).is_ok());
    }

    #[test]
    fn unix_range_epoch_zero_passes() {
        // 1970-01-01 00:00:00 is a valid edge case
        assert!(validate_unix_date_range(Some(0), Some(1704067200)).is_ok());
    }

    // -- validate_iso_date_range --------------------------------------------

    #[test]
    fn iso_range_both_none_passes() {
        assert!(validate_iso_date_range(&None, &None).is_ok());
    }

    #[test]
    fn iso_range_only_from_passes() {
        let from = Some("2024-01-01T00:00:00Z".to_string());
        assert!(validate_iso_date_range(&from, &None).is_ok());
    }

    #[test]
    fn iso_range_only_to_passes() {
        let to = Some("2024-12-31T23:59:59Z".to_string());
        assert!(validate_iso_date_range(&None, &to).is_ok());
    }

    #[test]
    fn iso_range_valid_range_passes() {
        let from = Some("2024-01-01T00:00:00Z".to_string());
        let to = Some("2024-12-31T23:59:59Z".to_string());
        assert!(validate_iso_date_range(&from, &to).is_ok());
    }

    #[test]
    fn iso_range_equal_dates_passes() {
        let date = Some("2024-06-15T12:00:00Z".to_string());
        assert!(validate_iso_date_range(&date, &date).is_ok());
    }

    #[test]
    fn iso_range_swapped_fails() {
        let from = Some("2024-12-31T00:00:00Z".to_string());
        let to = Some("2024-01-01T00:00:00Z".to_string());
        let err = validate_iso_date_range(&from, &to).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("from_date") && msg.contains("after"),
            "got: {msg}"
        );
    }

    #[test]
    fn iso_range_invalid_format_fails() {
        let invalid = Some("not-a-date".to_string());
        let err = validate_iso_date_range(&invalid, &None).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("not a valid date"), "got: {msg}");
        assert!(msg.contains("from_date"), "got: {msg}");
    }

    #[test]
    fn iso_range_empty_string_fails() {
        let empty = Some("".to_string());
        let err = validate_iso_date_range(&empty, &None).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("empty or whitespace"), "got: {msg}");
    }

    #[test]
    fn iso_range_whitespace_only_fails() {
        let whitespace = Some("   ".to_string());
        let err = validate_iso_date_range(&whitespace, &None).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("empty or whitespace"), "got: {msg}");
    }

    #[test]
    fn iso_range_with_timezone_offset_passes() {
        let from = Some("2024-01-01T00:00:00+05:30".to_string());
        let to = Some("2024-01-01T12:00:00-08:00".to_string());
        assert!(validate_iso_date_range(&from, &to).is_ok());
    }

    #[test]
    fn iso_range_date_only_format_passes() {
        // Frontend sends YYYY-MM-DD for analytics date ranges
        let date_only = Some("2024-01-01".to_string());
        assert!(validate_iso_date_range(&date_only, &None).is_ok());
    }

    #[test]
    fn iso_range_date_only_range_passes() {
        let from = Some("2024-01-01".to_string());
        let to = Some("2024-12-31".to_string());
        assert!(validate_iso_date_range(&from, &to).is_ok());
    }

    #[test]
    fn iso_range_mixed_formats_passes() {
        // Date-only from + RFC 3339 to should work
        let from = Some("2024-01-01".to_string());
        let to = Some("2024-12-31T23:59:59Z".to_string());
        assert!(validate_iso_date_range(&from, &to).is_ok());
    }

    #[test]
    fn iso_range_truncated_string_in_error() {
        let very_long = Some("not-a-date".repeat(20));
        let err = validate_iso_date_range(&very_long, &None).unwrap_err();
        let msg = err.to_string();
        // Should be truncated with ellipsis
        assert!(msg.contains("…") || msg.len() < very_long.as_ref().unwrap().len());
    }

    // -- validate_template_id -----------------------------------------------

    #[test]
    fn template_id_valid_passes() {
        assert!(validate_template_id("my-template").is_ok());
        assert!(validate_template_id("template_123").is_ok());
        assert!(validate_template_id("abc").is_ok());
    }

    #[test]
    fn template_id_path_traversal_fails() {
        let err = validate_template_id("../etc/passwd").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("path traversal"));
    }

    #[test]
    fn template_id_path_separator_fails() {
        assert!(validate_template_id("foo/bar").is_err());
        assert!(validate_template_id("foo\\bar").is_err());
    }

    #[test]
    fn template_id_empty_fails() {
        let err = validate_template_id("").unwrap_err();
        assert!(err.to_string().contains("cannot be empty"));
    }

    #[test]
    fn template_id_special_chars_fail() {
        assert!(validate_template_id("my@template").is_err());
        assert!(validate_template_id("my template").is_err());
    }

    // -- validate_preset_id -------------------------------------------------

    #[test]
    fn preset_id_valid_passes() {
        assert!(validate_preset_id("my-preset").is_ok());
        assert!(validate_preset_id("preset_v2").is_ok());
    }

    #[test]
    fn preset_id_path_traversal_fails() {
        let err = validate_preset_id("../../secrets").unwrap_err();
        assert!(err.to_string().contains("path traversal"));
    }

    // -- validate_skill_name ------------------------------------------------

    #[test]
    fn skill_name_valid_passes() {
        // Skill names are permissive - only path-safety checks
        assert!(validate_skill_name("my-skill").is_ok());
        assert!(validate_skill_name("skill_v2").is_ok());
        assert!(validate_skill_name("my skill").is_ok());
        assert!(validate_skill_name("my.skill").is_ok());
    }

    #[test]
    fn skill_name_path_traversal_fails() {
        let err = validate_skill_name("../malicious").unwrap_err();
        assert!(err.to_string().contains("path traversal"));
    }

    #[test]
    fn skill_name_path_separator_fails() {
        assert!(validate_skill_name("foo/bar").is_err());
        assert!(validate_skill_name("foo\\bar").is_err());
    }

    #[test]
    fn skill_name_empty_fails() {
        assert!(validate_skill_name("").is_err());
    }

    // -- validate_asset_name ------------------------------------------------

    #[test]
    fn asset_name_valid_passes() {
        assert!(validate_asset_name("logo.png").is_ok());
        assert!(validate_asset_name("data.json").is_ok());
        assert!(validate_asset_name("my asset.txt").is_ok());
    }

    #[test]
    fn asset_name_path_traversal_fails() {
        let err = validate_asset_name("../../../etc/passwd").unwrap_err();
        assert!(err.to_string().contains("path traversal"));
    }

    #[test]
    fn asset_name_nested_path_passes() {
        assert!(validate_asset_name("subdir/file.txt").is_ok());
        assert!(validate_asset_name("deep/nested/file.md").is_ok());
    }

    #[test]
    fn asset_name_leading_separator_fails() {
        assert!(validate_asset_name("/etc/passwd").is_err());
        assert!(validate_asset_name("\\Windows\\file").is_err());
    }

    #[test]
    fn asset_name_skill_md_fails() {
        assert!(validate_asset_name("SKILL.md").is_err());
    }
}
