//! Raw JSONL line parsing — reads `events.jsonl` into [`RawEvent`] envelopes.

use crate::error::{Result, TracePilotError};
#[cfg(test)]
use crate::parsing::EVENTS_JSONL;
use crate::provider::NativeRecord;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::Path;

const READ_BUFFER_BYTES: usize = 256 * 1024;
const CANCELLATION_INTERVAL_BYTES: usize = 8 * 1024;

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
    /// The sanitized source record for events translated from another
    /// provider. Absent, and never serialized, for Copilot events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native: Option<NativeRecord>,
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

/// Visit envelopes one at a time, checking cancellation every 8 KiB scanned and
/// between JSON records. The parser never accumulates a second raw-event vector.
pub(super) fn visit_events_jsonl(
    path: &Path,
    is_cancelled: &impl Fn() -> bool,
    mut visit: impl FnMut(RawEvent),
) -> Result<usize> {
    let file = std::fs::File::open(path)
        .map_err(|e| TracePilotError::io_context("Failed to open", path.display(), e))?;
    let mut reader = BufReader::with_capacity(READ_BUFFER_BYTES, file);
    let mut bytes = Vec::new();
    let mut malformed = 0;
    let mut line_number = 0;
    loop {
        crate::parsing::snapshot::check_cancelled(is_cancelled)?;
        let buffer = reader.fill_buf()?;
        let buffer = &buffer[..buffer.len().min(CANCELLATION_INTERVAL_BYTES)];
        let at_end = buffer.is_empty();
        // The slice reader uses the standard library's optimized newline search.
        // Limit scanning independently of file reads to preserve cancellation.
        let mut rest = buffer;
        let count = rest.skip_until(b'\n')?;
        let complete = count > 0 && buffer[count - 1] == b'\n';
        bytes.extend_from_slice(&buffer[..count]);
        reader.consume(count);
        if !complete && !at_end {
            continue;
        }
        line_number += 1;
        // A line cut inside a multi-byte character (a CLI killed mid-append)
        // is malformed like any other: it loses only itself.
        let parsed = match std::str::from_utf8(&bytes).map(str::trim) {
            Ok("") => None,
            Ok(line) => Some(parse_raw_event_line(line).map_err(|error| error.to_string())),
            Err(error) => Some(Err(format!("not UTF-8: {error}"))),
        };
        match parsed {
            None => {}
            Some(Ok(event)) => visit(event),
            Some(Err(error)) => {
                malformed += 1;
                match recover_appended_record(&bytes, is_copilot_event) {
                    Some(event) => {
                        tracing::warn!(line = line_number, error = %error, "Kept the event appended after a cut-off line");
                        visit(event);
                    }
                    None => {
                        tracing::warn!(line = line_number, error = %error, "Skipping malformed event line");
                    }
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

/// A top-level Copilot event, not a payload object: the envelope's `type`
/// and `data` plus the `id` or `timestamp` every CLI-written event carries.
fn is_copilot_event(event: &RawEvent) -> bool {
    event.id.is_some() || event.timestamp.is_some()
}

/// Recover the record that a resumed CLI appended to a cut-off line.
///
/// A CLI killed mid-append leaves a line without its newline, so the first
/// record the resumed CLI writes lands on the same line, after the cut
/// bytes. Only a newline-terminated line qualifies: a crash never writes the
/// newline itself, so a cut last line is never searched. The record is the
/// first suffix starting at a later `{"` that parses through the end of the
/// line and passes `accept`. An object nested in the cut record cannot
/// qualify unless it ends exactly at the line's end; `accept` checks the
/// record shape for that case.
///
/// Invalid UTF-8 (a cut inside a character) and lone surrogate escapes are
/// repaired once for the whole line, and each candidate is a plain parse that
/// stops where its value ends, so the cost is the line's length times its
/// nesting depth, paid only for malformed lines.
pub(crate) fn recover_appended_record<T: serde::de::DeserializeOwned>(
    bytes: &[u8],
    accept: impl Fn(&T) -> bool,
) -> Option<T> {
    if bytes.last() != Some(&b'\n') {
        return None;
    }
    let text = String::from_utf8_lossy(bytes);
    let text = match replace_lone_surrogate_escapes(&text) {
        Some(repaired) => std::borrow::Cow::Owned(repaired),
        None => text,
    };
    let first = text.len() - text.trim_start().len();
    text.match_indices("{\"")
        .filter(|(at, _)| *at > first)
        .find_map(|(at, _)| {
            serde_json::from_str::<T>(&text[at..])
                .ok()
                .filter(|record| accept(record))
        })
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
    fn reads_records_across_scan_and_file_buffer_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(EVENTS_JSONL);
        let prefix = r#"{"type":"user.message","data":{"content":""#;
        let suffix = r#""}}"#;
        for boundary in [8usize * 1024, 256 * 1024] {
            for offset in [-1isize, 0, 1] {
                let target = boundary.wrapping_add_signed(offset);
                for align_newline in [false, true] {
                    // Include the initial blank line and serialized JSON overhead
                    // so the marker really lands at the requested byte offset.
                    let padding = if align_newline {
                        target - 2 - prefix.len() - "🧪".len() - suffix.len()
                    } else {
                        target - 1 - prefix.len()
                    };
                    let content = format!("{}🧪", "x".repeat(padding));
                    let record = format!("{prefix}{content}{suffix}");
                    let first_line = format!("\n{record}\r\n");
                    if align_newline {
                        assert_eq!(first_line.as_bytes()[target], b'\n');
                        assert_eq!(first_line.len(), target + 1);
                    } else {
                        assert_eq!(first_line.find('🧪'), Some(target));
                    }
                    for tail in ["", "\n"] {
                        // Blank lines, CRLF, a malformed line and a valid tail must
                        // retain the same ordering and diagnostic counts.
                        std::fs::write(&path, format!("{first_line}{{broken\n{record}{tail}"))
                            .unwrap();
                        let (events, malformed) = parse_events_jsonl(&path).unwrap();
                        assert_eq!(malformed, 1);
                        assert_eq!(events.len(), 2);
                        for event in events {
                            assert_eq!(event.data["content"], content);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn cancellation_still_interrupts_a_record_smaller_than_the_file_buffer() {
        use std::cell::Cell;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(EVENTS_JSONL);
        std::fs::write(
            &path,
            serde_json::json!({ "type": "user.message", "data": { "content": "x".repeat(32 * 1024) } }).to_string(),
        )
        .unwrap();
        let checks = Cell::new(0);
        let visited = Cell::new(0);
        let result = visit_events_jsonl(
            &path,
            &|| {
                checks.set(checks.get() + 1);
                checks.get() == 3
            },
            |_| visited.set(visited.get() + 1),
        );
        assert!(
            matches!(result, Err(TracePilotError::IoError(error)) if error.kind() == std::io::ErrorKind::Interrupted)
        );
        assert_eq!(visited.get(), 0);
    }

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

    /// A CLI killed mid-append can cut a line inside a multi-byte character.
    /// Only that line is lost, wherever it is in the file.
    #[test]
    fn lines_with_invalid_utf8_are_skipped_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(EVENTS_JSONL);
        let event = |n: u32| {
            format!(r#"{{"type":"user.message","id":"e{n}","data":{{"content":"{n} ✅"}}}}"#)
        };
        let cut = |n: u32| {
            let line = event(n);
            line.as_bytes()[..=line.find('✅').unwrap()].to_vec()
        };
        // A cut tail, the same cut on a line of its own, and the cut with a
        // resumed CLI's record appended right after it.
        let mut tail = format!("{}\n", event(1)).into_bytes();
        tail.extend(cut(2));
        let mut middle = tail.clone();
        middle.extend(format!("\n{}\n", event(3)).into_bytes());
        let mut glued = tail.clone();
        glued.extend(format!("{}\n", event(3)).into_bytes());
        for (bytes, last) in [(tail, "1 ✅"), (middle, "3 ✅"), (glued, "3 ✅")] {
            std::fs::write(&path, bytes).unwrap();
            let (events, malformed) = parse_events_jsonl(&path).unwrap();
            assert_eq!(malformed, 1);
            assert_eq!(events[0].data["content"], "1 ✅");
            assert_eq!(events.last().unwrap().data["content"], last);
        }
    }

    /// Recovery keeps only a whole top-level event that ends its line: never
    /// a payload object, and nothing from a cut last line.
    #[test]
    fn recovery_rejects_nested_objects_and_cut_last_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(EVENTS_JSONL);
        let nested =
            r#"{"type":"tool.execution_complete","id":"e1","data":{"type":"payload","data":{}}"#;
        let whole = r#"{"type":"user.message","id":"e2","data":{}}"#;
        for bytes in [
            format!("{nested}\n"),
            format!(r#"{{"type":"user.mess{whole}"#),
        ] {
            std::fs::write(&path, bytes).unwrap();
            let (events, malformed) = parse_events_jsonl(&path).unwrap();
            assert_eq!((events.len(), malformed), (0, 1));
        }
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
