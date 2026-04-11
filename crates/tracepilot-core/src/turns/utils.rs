//! Utility functions for turn reconstruction.

use chrono::{DateTime, Utc};

/// Compute duration in milliseconds between two timestamps.
///
/// Returns `None` if either timestamp is `None`, or if end < start (negative duration).
pub(crate) fn duration_ms(start: Option<DateTime<Utc>>, end: Option<DateTime<Utc>>) -> Option<u64> {
    let (Some(start), Some(end)) = (start, end) else {
        return None;
    };

    let millis = end.signed_duration_since(start).num_milliseconds();
    (millis >= 0).then_some(millis as u64)
}

/// Convert a JSON value to a string.
///
/// If the value is already a string, returns it as-is.
/// Otherwise, serializes the value to JSON.
pub(crate) fn json_value_to_string(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| value.to_string())
}

const RESULT_PREVIEW_MAX_BYTES: usize = 1024;

/// Truncate a string to a maximum byte length, respecting UTF-8 boundaries.
///
/// This is a thin wrapper around [`crate::utils::truncate_utf8_with_marker`]
/// that preserves the existing "…[truncated]" suffix for turn result previews.
pub(crate) fn truncate_str(s: &str, max_bytes: usize) -> String {
    crate::utils::truncate_utf8_with_marker(s, max_bytes, Some("…[truncated]"))
}

/// Extract a truncated result preview from a polymorphic `result` field.
///
/// The result can be a plain string, an object with `content`/`detailedContent`, or other shapes.
pub(crate) fn extract_result_preview(result: &serde_json::Value) -> Option<String> {
    match result {
        serde_json::Value::String(s) => {
            if s.trim().is_empty() {
                None
            } else {
                Some(truncate_str(s, RESULT_PREVIEW_MAX_BYTES))
            }
        }
        serde_json::Value::Object(obj) => {
            let text = obj
                .get("content")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .or_else(|| {
                    obj.get("detailedContent")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.trim().is_empty())
                });
            text.map(|s| truncate_str(s, RESULT_PREVIEW_MAX_BYTES))
        }
        _ => None,
    }
}
