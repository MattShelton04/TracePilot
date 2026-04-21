//! Generic validation rules: pagination clamping, display-truncation, timestamp bounds.

use crate::error::{BindingsError, CmdResult};

/// Maximum number of items per page for paginated event responses.
///
/// Applied only when a caller supplies an explicit `limit`; omitting the
/// parameter preserves the existing "return everything" behaviour.
pub(crate) const MAX_EVENTS_PAGE_LIMIT: u32 = 10_000;

/// Maximum reasonable Unix timestamp (year 3000-01-01).
///
/// Used to reject obviously invalid timestamps that would cause confusing
/// downstream behavior. Real session timestamps should never exceed this.
pub(super) const MAX_UNIX_TIMESTAMP: i64 = 32503680000; // 3000-01-01 00:00:00 UTC

/// Clamp an explicit pagination limit to a safe upper bound.
///
/// * `None` ⇒ `None` (preserve "return all" semantics for callers that
///   need it, like the events endpoint).
/// * `Some(n)` ⇒ `Some(min(n, max_limit))`.
pub(crate) fn clamp_limit(limit: Option<u32>, max_limit: u32) -> Option<u32> {
    limit.map(|l| l.min(max_limit))
}

/// Truncate a string for inclusion in error messages.
///
/// Truncates by **character count** (not byte count) for user-facing messages
/// where visual length matters. Appends "…" when truncation occurs.
pub(super) fn truncate_for_display(s: &str, max_chars: usize) -> String {
    let char_count = s.chars().count();
    if char_count <= max_chars {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_chars).collect();
        format!("{truncated}…")
    }
}

// ── Date / timestamp range validation ─────────────────────────────────────

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
