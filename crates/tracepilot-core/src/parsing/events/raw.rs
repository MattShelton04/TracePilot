//! Raw JSONL line parsing — reads `events.jsonl` into [`RawEvent`] envelopes.

use crate::error::{Result, TracePilotError};
#[cfg(test)]
use crate::parsing::EVENTS_JSONL;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// Raw event envelope parsed from a single JSONL line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub data: Value,
    pub id: Option<String>,
    pub timestamp: Option<DateTime<Utc>>,
    #[serde(rename = "parentId")]
    pub parent_id: Option<String>,
    /// Owning agent instance identifier, distinct from the spawning tool-call
    /// ID in newer logs. Root and session-level events omit this field.
    #[serde(rename = "agentId")]
    pub agent_id: Option<String>,
}

/// Serialize a slice of events into a newline-delimited JSON string.
///
/// Each event is serialized to a single line. The resulting string does NOT
/// contain a trailing newline.
///
/// # Panics
/// Panics if a custom serializer supplies an invalid JSON value. Wire event
/// DTOs and `serde_json::Value` are JSON-compatible by construction.
#[allow(
    clippy::expect_used,
    reason = "JSON-compatible event DTO serialization is an invariant of this convenience API"
)]
pub fn events_to_jsonl<T: Serialize>(events: &[T]) -> String {
    let mut s = String::with_capacity(events.len() * 256);
    for (i, e) in events.iter().enumerate() {
        if i > 0 {
            s.push('\n');
        }
        let line = serde_json::to_string(e).expect("event serialization should be infallible");
        s.push_str(&line);
    }
    s
}

/// Visit envelopes one at a time, checking cancellation every 8 KiB read and
/// between JSON records. The parser never accumulates a second raw-event vector.
pub(super) fn visit_events_jsonl(
    path: &Path,
    is_cancelled: &impl Fn() -> bool,
    mut visit: impl FnMut(RawEvent),
) -> Result<usize> {
    let file = std::fs::File::open(path)
        .map_err(|e| TracePilotError::io_context("Failed to open", path.display(), e))?;
    let mut reader = BufReader::new(file);
    let mut bytes = Vec::new();
    let mut malformed = 0;
    let mut line_number = 0;
    loop {
        crate::parsing::snapshot::check_cancelled(is_cancelled)?;
        let buffer = reader.fill_buf()?;
        let at_end = buffer.is_empty();
        let consumed = buffer.iter().position(|byte| *byte == b'\n').map(|i| i + 1);
        let count = consumed.unwrap_or(buffer.len());
        bytes.extend_from_slice(&buffer[..count]);
        reader.consume(count);
        if consumed.is_none() && !at_end {
            continue;
        }
        line_number += 1;
        let line = std::str::from_utf8(&bytes)
            .map_err(|error| {
                TracePilotError::parse_context("UTF-8 event line", path.display(), error)
            })?
            .trim();
        if !line.is_empty() {
            match parse_raw_event_line(line) {
                Ok(event) => visit(event),
                Err(error) => {
                    tracing::warn!(line = line_number, error = %error, "Skipping malformed event line");
                    malformed += 1;
                }
            }
        }
        bytes.clear();
        if at_end {
            break;
        }
    }
    Ok(malformed)
}

/// Parse one JSONL record, recovering lines that contain unpaired UTF-16
/// surrogate escapes.
///
/// Copilot CLI writes events with JavaScript's `JSON.stringify`, which emits
/// a lone surrogate (for example, shell output truncated in the middle of an
/// emoji) as `\ud83d`. That is valid JSON syntax and `JSON.parse` accepts it,
/// but it cannot be represented as a Rust `String`, so serde_json rejects
/// the whole line. Only after that failure is each unpaired escape replaced
/// with U+FFFD, the same substitution a lossy UTF-16 decoder makes.
fn parse_raw_event_line(line: &str) -> serde_json::Result<RawEvent> {
    parse_json_line_lenient(line)
}

/// Parse one JSONL record into any shape, with the same lone-surrogate repair.
/// Claude Code transcripts are written by `JSON.stringify` too.
pub(crate) fn parse_json_line_lenient<T: serde::de::DeserializeOwned>(
    line: &str,
) -> serde_json::Result<T> {
    let error = match serde_json::from_str::<T>(line) {
        Ok(value) => return Ok(value),
        Err(error) => error,
    };
    // Report the original error if the repair does not help: it describes the
    // line as written, not our rewrite of it.
    replace_lone_surrogate_escapes(line)
        .and_then(|repaired| serde_json::from_str::<T>(&repaired).ok())
        .ok_or(error)
}

/// Replace `\uXXXX` escapes that encode an unpaired surrogate with `�`.
/// Returns `None` when the line has none. Escaped backslashes are skipped, so
/// literal text such as `\\ud83d` is left untouched.
fn replace_lone_surrogate_escapes(line: &str) -> Option<String> {
    fn escape_at(bytes: &[u8], at: usize) -> Option<u16> {
        let hex = bytes.get(at..at + 6)?;
        if hex[0] != b'\\' || hex[1] != b'u' {
            return None;
        }
        u16::from_str_radix(std::str::from_utf8(&hex[2..]).ok()?, 16).ok()
    }
    let is_high = |unit: u16| (0xD800..0xDC00).contains(&unit);
    let is_low = |unit: u16| (0xDC00..0xE000).contains(&unit);

    let bytes = line.as_bytes();
    let mut lone = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'\\' {
            i += 1;
            continue;
        }
        match escape_at(bytes, i) {
            Some(unit) if is_high(unit) => {
                if escape_at(bytes, i + 6).is_some_and(is_low) {
                    i += 12;
                } else {
                    lone.push(i);
                    i += 6;
                }
            }
            Some(unit) if is_low(unit) => {
                lone.push(i);
                i += 6;
            }
            Some(_) => i += 6,
            // Any other escape is two bytes, including `\\`.
            None => i += 2,
        }
    }
    if lone.is_empty() {
        return None;
    }
    let mut repaired = String::with_capacity(line.len());
    let mut copied = 0;
    for start in lone {
        repaired.push_str(&line[copied..start]);
        repaired.push_str("\\ufffd");
        copied = start + 6;
    }
    repaired.push_str(&line[copied..]);
    Some(repaired)
}

#[cfg(test)]
pub(super) fn parse_events_jsonl(path: &Path) -> Result<(Vec<RawEvent>, usize)> {
    let mut events = Vec::new();
    let malformed = visit_events_jsonl(path, &|| false, |raw| events.push(raw))?;
    Ok((events, malformed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_subagent_owner() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(EVENTS_JSONL);
        std::fs::write(
            &path,
            r#"{"type":"assistant.reasoning","data":{"content":"private"},"id":"evt-1","agentId":"subagent-call"}"#,
        )
        .unwrap();

        let (events, malformed) = parse_events_jsonl(&path).unwrap();
        assert_eq!(malformed, 0);
        assert_eq!(events[0].agent_id.as_deref(), Some("subagent-call"));
    }

    #[test]
    fn recovers_shell_output_truncated_inside_a_surrogate_pair() {
        // Shape observed in a real Copilot CLI tool.execution_complete record:
        // output cut between the two halves of an emoji.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(EVENTS_JSONL);
        std::fs::write(
            &path,
            concat!(
                r#"{"type":"tool.execution_complete","data":{"result":{"content":"<span>\ud83d\n<exited>"}},"id":"evt-1"}"#,
                "\n",
                r#"{"type":"user.message","data":{"content":"ok"},"id":"evt-2"}"#,
            ),
        )
        .unwrap();

        let (events, malformed) = parse_events_jsonl(&path).unwrap();
        assert_eq!(malformed, 0);
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0].data["result"]["content"],
            "<span>\u{fffd}\n<exited>"
        );
    }

    /// Test JSON with `|` standing in for a backslash, so escapes stay literal.
    fn esc(json: &str) -> String {
        json.replace('|', "\\")
    }

    #[test]
    fn lone_surrogate_repair_keeps_pairs_and_escaped_text() {
        let repair = |json: &str| replace_lone_surrogate_escapes(&esc(json));
        assert_eq!(repair(r#"{"a":"|ud83d|ude00"}"#), None);
        assert_eq!(repair(r#"{"a":"||ud83d"}"#), None);
        assert_eq!(
            repair(r#"{"a":"x|ud83d","b":"|ude00|||udc00"}"#),
            Some(esc(r#"{"a":"x|ufffd","b":"|ufffd|||ufffd"}"#))
        );
        assert_eq!(
            repair(r#"{"a":"|uD83D|uD83D|uDE00"}"#),
            Some(esc(r#"{"a":"|ufffd|uD83D|uDE00"}"#))
        );
    }

    #[test]
    fn genuinely_malformed_lines_are_still_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(EVENTS_JSONL);
        std::fs::write(&path, r#"{"type":"user.message","data":{"content":"\ud83d"#).unwrap();

        let (events, malformed) = parse_events_jsonl(&path).unwrap();
        assert!(events.is_empty());
        assert_eq!(malformed, 1);
    }
}
