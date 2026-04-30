//! Tests for `validators` — split across id/path/rules seams.

use super::rules::truncate_for_display;
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

// -- validate_path_segment ----------------------------------------------
//
// Defence-in-depth checks for single path segments that flow into
// `parent.join(value)`. All of these must reject at the boundary so that
// no filesystem operation sees a traversal/injection attempt.

#[test]
fn path_segment_accepts_plain_name() {
    assert!(super::validate_path_segment("2.0.0", "Version").is_ok());
    assert!(super::validate_path_segment("agent.yaml", "file_name").is_ok());
    assert!(super::validate_path_segment("my-preset_1", "file_name").is_ok());
}

#[test]
fn path_segment_rejects_empty() {
    let err = super::validate_path_segment("", "Version").unwrap_err();
    assert!(err.to_string().contains("cannot be empty"));
}

#[test]
fn path_segment_rejects_null_byte() {
    let err = super::validate_path_segment("ok\0bad", "file_name").unwrap_err();
    assert!(err.to_string().contains("NULL"));
}

#[test]
fn path_segment_rejects_dotdot_traversal() {
    assert!(super::validate_path_segment("..", "Version").is_err());
    assert!(super::validate_path_segment("../etc", "Version").is_err());
    assert!(super::validate_path_segment("foo..bar", "Version").is_err());
}

#[test]
fn path_segment_rejects_forward_slash() {
    let err = super::validate_path_segment("nested/name", "Version").unwrap_err();
    assert!(err.to_string().contains("path separators"));
}

#[test]
fn path_segment_rejects_backslash() {
    let err = super::validate_path_segment("nested\\name", "Version").unwrap_err();
    assert!(err.to_string().contains("path separators"));
}

#[test]
fn path_segment_rejects_absolute_unix_path() {
    // `/etc/passwd` starts with `/`, which is caught by the path-separator
    // check; also covered by Path::is_absolute.
    let err = super::validate_path_segment("/etc/passwd", "file_name").unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("path separators") || msg.contains("absolute path"));
}

#[cfg(windows)]
#[test]
fn path_segment_rejects_windows_unc_path() {
    // UNC paths like `\\server\share` start with a backslash and are
    // also recognised as absolute by Path::is_absolute on Windows.
    assert!(super::validate_path_segment(r"\\server\share", "file_name").is_err());
    assert!(super::validate_path_segment(r"\\?\C:\Windows", "file_name").is_err());
}

#[cfg(windows)]
#[test]
fn path_segment_rejects_windows_drive_path() {
    // Drive-qualified absolute paths — Path::is_absolute returns true on
    // Windows even when no leading slash is present.
    let err = super::validate_path_segment(r"C:\Windows", "file_name").unwrap_err();
    assert!(err.to_string().contains("path separators"));
}

#[test]
fn path_segment_carries_context_in_error() {
    let err = super::validate_path_segment("", "from_version").unwrap_err();
    assert!(err.to_string().contains("from_version"));
}
