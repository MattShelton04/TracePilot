//! Shared test utilities for creating events, sessions, and test fixtures.
//!
//! This module provides builder helpers that reduce boilerplate across test files.
//! It is only compiled for `#[cfg(test)]`.

use crate::models::event_types::SessionEventType;
use crate::parsing::events::{RawEvent, TypedEvent};
use chrono::{TimeZone, Utc};

/// Build a [`RawEvent`] with the given type string and data JSON.
///
/// Generates a deterministic `id` from the event type and a fixed timestamp.
pub fn make_raw_event(event_type: &str, data: serde_json::Value) -> RawEvent {
    RawEvent {
        event_type: event_type.to_string(),
        data,
        id: Some(format!("test-{}", event_type.replace('.', "-"))),
        timestamp: Some(Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap()),
        parent_id: None,
    }
}

/// Build a [`TypedEvent`] by parsing a raw event type string and data JSON.
///
/// Uses the real parsing pipeline (`SessionEventType::parse_wire` + `typed_data_from_raw`)
/// to produce a fully-typed event, matching production behavior.
pub fn make_typed_event(event_type: &str, data: serde_json::Value) -> TypedEvent {
    let raw = make_raw_event(event_type, data.clone());
    let et = SessionEventType::parse_wire(event_type);
    let (typed_data, _warning) = crate::parsing::events::typed_data_from_raw(&et, &raw.data);
    TypedEvent {
        raw,
        event_type: et,
        typed_data,
    }
}

/// Create a temporary session directory with `workspace.yaml` and optional `events.jsonl`.
///
/// Returns `(TempDir, PathBuf)` — the `TempDir` guard must be kept alive for the
/// duration of the test, and the `PathBuf` points to the session directory.
///
/// # Example
///
/// ```ignore
/// let (dir, path) = temp_session(&[
///     ("session.start", json!({"model": "gpt-4"})),
///     ("user.message", json!({"content": "hello"})),
/// ]);
/// let parsed = parse_typed_events(&path.join("events.jsonl")).unwrap();
/// assert_eq!(parsed.events.len(), 2);
/// ```
pub fn temp_session(events: &[(&str, serde_json::Value)]) -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("failed to create temp dir");
    let session_path = dir.path().to_path_buf();

    // Minimal workspace.yaml with required id field
    std::fs::write(
        session_path.join("workspace.yaml"),
        "id: test-session-00000000\nconversationMode: ask\n",
    )
    .expect("failed to write workspace.yaml");

    // events.jsonl (if any events provided)
    if !events.is_empty() {
        let mut lines = Vec::new();
        for (i, (event_type, data)) in events.iter().enumerate() {
            let raw = serde_json::json!({
                "type": event_type,
                "data": data,
                "id": format!("e{}", i + 1),
                "timestamp": format!("2025-01-01T00:00:{:02}.000Z", i),
            });
            lines.push(serde_json::to_string(&raw).expect("failed to serialize event"));
        }
        std::fs::write(session_path.join("events.jsonl"), lines.join("\n"))
            .expect("failed to write events.jsonl");
    }

    (dir, session_path)
}
