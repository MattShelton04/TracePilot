//! Format drift for Copilot CLI sessions: event types the parser does not
//! know, and the Copilot CLI versions that wrote the session.
//!
//! Collected from the parse indexing already does, so nothing is reread.
//! (Known types whose payload fails to decode are not counted: indexing
//! refuses such a snapshot and keeps the last good rows.)
//!
//! Names go through the same checks as Claude Code's, so only type names and
//! versions are counted, never paths, ids or content.

use std::collections::BTreeMap;

use crate::parsing::diagnostics::ParseDiagnostics;
use crate::parsing::events::{TypedEvent, TypedEventData};
use crate::provider::FormatObservations;
use crate::provider::claude_code::{safe_type_name, safe_version};

/// The drift one parse of a session observed.
pub(super) fn format_observations(
    events: Option<&[TypedEvent]>,
    diagnostics: Option<&ParseDiagnostics>,
) -> FormatObservations {
    let mut out = FormatObservations::default();
    if let Some(diagnostics) = diagnostics {
        for (name, count) in &diagnostics.unknown_event_types {
            add(&mut out.unmapped_record_types, safe_type_name(name), *count);
        }
    }
    for event in events.unwrap_or_default() {
        let version = match &event.typed_data {
            TypedEventData::SessionStart(data) => data.copilot_version.as_deref(),
            TypedEventData::SessionResume(data) => data.copilot_version.as_deref(),
            _ => None,
        };
        if let Some(version) = version.filter(|v| !v.is_empty()) {
            add(&mut out.versions, safe_version(version), 1);
        }
    }
    out
}

fn add(counts: &mut BTreeMap<String, usize>, name: &str, count: usize) {
    *counts.entry(name.to_string()).or_default() += count;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsing::events::parse_typed_events;
    use serde_json::json;

    fn parse(lines: &[serde_json::Value]) -> (Vec<TypedEvent>, ParseDiagnostics) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        let body: Vec<String> = lines.iter().map(|line| line.to_string()).collect();
        std::fs::write(&path, body.join("\n")).unwrap();
        let parsed = parse_typed_events(&path).unwrap();
        (parsed.events, parsed.diagnostics)
    }

    fn event(kind: &str, data: serde_json::Value) -> serde_json::Value {
        json!({
            "type": kind,
            "id": "e",
            "timestamp": "2026-01-01T00:00:00Z",
            "data": data,
        })
    }

    #[test]
    fn counts_unknown_types_and_versions() {
        let (events, diagnostics) = parse(&[
            event("session.start", json!({ "copilotVersion": "1.0.83" })),
            event("brand.new_event", json!({})),
            event("brand.new_event", json!({})),
            event("session.resume", json!({ "copilotVersion": "1.0.90" })),
            event("session.resume", json!({ "copilotVersion": "1.0.90" })),
            event("session.start", json!({ "copilotVersion": "" })),
        ]);
        let observed = format_observations(Some(&events), Some(&diagnostics));
        assert_eq!(
            observed.unmapped_record_types,
            BTreeMap::from([("brand.new_event".to_string(), 2)])
        );
        assert_eq!(
            observed.versions,
            BTreeMap::from([("1.0.83".to_string(), 1), ("1.0.90".to_string(), 2)])
        );
        assert!(observed.unmapped_attachment_types.is_empty());
    }

    #[test]
    fn names_that_are_not_types_or_versions_are_replaced() {
        let (events, diagnostics) = parse(&[
            event(
                "session.start",
                json!({ "copilotVersion": "C:\\tools\\copilot" }),
            ),
            event("/home/someone/repo", json!({})),
        ]);
        let observed = format_observations(Some(&events), Some(&diagnostics));
        assert_eq!(
            observed.versions,
            BTreeMap::from([("(unrecognized version)".to_string(), 1)])
        );
        assert_eq!(
            observed.unmapped_record_types,
            BTreeMap::from([("(unrecognized name)".to_string(), 1)])
        );
    }

    #[test]
    fn no_event_log_observes_nothing() {
        assert_eq!(
            format_observations(None, None),
            FormatObservations::default()
        );
    }
}
