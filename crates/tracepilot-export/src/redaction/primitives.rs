use super::patterns::RedactionPattern;
use super::stats::RedactionStats;

/// Redact a `String` field in place. Tracks per-field and per-match counts.
pub(crate) fn redact_string(
    s: &mut String,
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    if let Some((redacted, match_count)) = apply_patterns(s, patterns) {
        *s = redacted;
        stats.fields_redacted += 1;
        stats.total_replacements += match_count;
    }
}

/// Redact an `Option<String>` field in place.
pub(crate) fn redact_opt_string(
    s: &mut Option<String>,
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    if let Some(value) = s {
        redact_string(value, patterns, stats);
    }
}

/// Recursively redact string values within a `serde_json::Value`.
pub(crate) fn redact_json_value(
    value: &mut serde_json::Value,
    patterns: &[&RedactionPattern],
    stats: &mut RedactionStats,
) {
    match value {
        serde_json::Value::String(s) => {
            redact_string(s, patterns, stats);
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                redact_json_value(item, patterns, stats);
            }
        }
        serde_json::Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                redact_json_value(v, patterns, stats);
            }
        }
        _ => {}
    }
}

/// Apply patterns to a string. Returns `None` if no patterns matched,
/// otherwise returns the redacted string and the total number of individual
/// regex matches that were replaced.
fn apply_patterns(text: &str, patterns: &[&RedactionPattern]) -> Option<(String, usize)> {
    let any_match = patterns.iter().any(|p| p.regex.is_match(text));
    if !any_match {
        return None;
    }

    let mut result = text.to_string();
    let mut total_matches: usize = 0;

    for pattern in patterns {
        let match_count = pattern.regex.find_iter(&result).count();
        if match_count > 0 {
            total_matches += match_count;
            let after = pattern.regex.replace_all(&result, pattern.replacement);
            result = after.into_owned();
        }
    }

    if total_matches > 0 {
        Some((result, total_matches))
    } else {
        None
    }
}
