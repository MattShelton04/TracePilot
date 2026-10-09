//! Format drift: the record and attachment types the parser has no mapping
//! for, and the Claude Code versions that wrote a session (implementation
//! plan Q3).
//!
//! Every name is checked before it is counted, so what reaches diagnostics,
//! the index and the census report is a type name or a version, never a path,
//! an id or content: anything else counts under a placeholder.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use super::records::Rec;
use crate::provider::FormatObservations;

/// Counted in place of a type name that does not look like one.
pub const OTHER_NAME: &str = "(unrecognized name)";
/// Counted in place of a version that does not look like one.
pub const OTHER_VERSION: &str = "(unrecognized version)";
/// Counted for a record or attachment with no type at all.
pub const MISSING_NAME: &str = "(missing)";

/// Count `raw` under its safe name in `counts`.
pub(super) fn count_type(counts: &mut BTreeMap<String, usize>, raw: &str) {
    *counts.entry(safe_type_name(raw).to_string()).or_default() += 1;
}

/// Count the record's `version`, if it has one.
pub(super) fn count_version(counts: &mut BTreeMap<String, usize>, rec: Rec<'_>) {
    if let Some(raw) = rec.str("version") {
        *counts.entry(safe_version(raw).to_string()).or_default() += 1;
    }
}

/// `raw` when it looks like a type name: a letter, then up to 47 letters,
/// digits, `_`, `-`, `.` or `:`, with no run of 8 or more hex digits (an id).
pub fn safe_type_name(raw: &str) -> &str {
    if raw.is_empty() {
        return MISSING_NAME;
    }
    let mut hex_run = 0;
    let mut chars = raw.chars();
    let first_is_letter = chars.next().is_some_and(|c| c.is_ascii_alphabetic());
    let shaped = raw.len() <= 48
        && first_is_letter
        && raw.chars().all(|c| {
            hex_run = if c.is_ascii_hexdigit() {
                hex_run + 1
            } else {
                0
            };
            hex_run < 8 && (c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':'))
        });
    if shaped { raw } else { OTHER_NAME }
}

/// `raw` when it looks like a version: 2–4 dot-separated numbers of up to six
/// digits, optionally followed by `-` or `+` and up to 24 letters, digits or
/// dots (`2.1.289`, `2.2.0-beta.1`).
pub fn safe_version(raw: &str) -> &str {
    let (core, suffix) = match raw.find(['-', '+']) {
        Some(at) => (&raw[..at], Some(&raw[at + 1..])),
        None => (raw, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    let core_ok = (2..=4).contains(&parts.len())
        && parts
            .iter()
            .all(|p| (1..=6).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_digit()));
    let suffix_ok = suffix.is_none_or(|s| {
        (1..=24).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.')
    });
    if core_ok && suffix_ok {
        raw
    } else {
        OTHER_VERSION
    }
}

/// Numeric order for versions (`2.1.99` before `2.1.100`), then by text.
pub fn version_order(a: &str, b: &str) -> Ordering {
    let key = |v: &str| -> Vec<u64> {
        v.split(['-', '+'])
            .next()
            .unwrap_or("")
            .split('.')
            .map(|part| part.parse().unwrap_or(0))
            .collect()
    };
    key(a).cmp(&key(b)).then_with(|| a.cmp(b))
}

impl super::ClaudeDiagnostics {
    /// The drift this parse observed, for the index.
    pub fn format_observations(&self) -> FormatObservations {
        FormatObservations {
            unmapped_record_types: self.unknown_record_types.clone(),
            unmapped_attachment_types: self.unknown_attachment_types.clone(),
            versions: self.versions.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn type_names_pass_and_anything_else_is_replaced() {
        for name in ["ai-title", "deferred_tools_delta", "cost-state", "x:y.z"] {
            assert_eq!(safe_type_name(name), name);
        }
        for raw in [
            "C:\\Users\\someone\\repo",
            "/home/someone/repo",
            "11111111-1111-4111-8111-111111111111",
            "a1b2c3d4e5f6",
            "fix the login bug",
            "1-starts-with-digit",
            &"a".repeat(49),
        ] {
            assert_eq!(safe_type_name(raw), OTHER_NAME, "{raw}");
        }
        assert_eq!(safe_type_name(""), MISSING_NAME);
    }

    #[test]
    fn versions_pass_and_anything_else_is_replaced() {
        for version in ["2.1.289", "2.2.0-beta.1", "1.0", "10.20.30.40+build7"] {
            assert_eq!(safe_version(version), version);
        }
        for raw in [
            "",
            "2",
            "v2.1.0",
            "2.1.0 (secret)",
            "C:\\tools\\2.1.0",
            "2.1.0-with space",
            "1.2.3.4.5",
        ] {
            assert_eq!(safe_version(raw), OTHER_VERSION, "{raw}");
        }
    }
}
