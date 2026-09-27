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
            match serde_json::from_str::<RawEvent>(line) {
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
}
