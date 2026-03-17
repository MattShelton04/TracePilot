//! Parsing diagnostics — tracks unknown event types and deserialization failures
//! encountered during event parsing.
//!
//! ## Purpose
//!
//! As the Copilot CLI evolves (~4 releases/week, 41→62+ event types), TracePilot
//! will regularly encounter event types it doesn't recognize. This module provides
//! structured tracking of these situations so they can be surfaced in health scoring
//! and logged for debugging, rather than being silently swallowed.
//!
//! ## Usage
//!
//! [`ParseDiagnostics`] is accumulated during [`parse_typed_events`](super::events::parse_typed_events)
//! and returned alongside the parsed events in [`ParsedEvents`]. Callers that only
//! need events can access `.events` and ignore diagnostics. The health module
//! uses diagnostics for session health scoring.
//!
//! Diagnostics are **Rust-internal only** — they do not cross the Tauri FFI boundary.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Warning emitted during event parsing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum EventParseWarning {
    /// An event type string was not recognized (not in the known registry).
    UnknownEventType { event_type: String },
    /// A known event type's data field failed to deserialize into its typed struct.
    DeserializationFailed { event_type: String, error: String },
}

/// Info about deserialization failures for a specific event type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeserFailureInfo {
    /// Number of events of this type that failed deserialization.
    pub count: usize,
    /// Error message from the first failure (representative example).
    pub first_error: String,
}

/// Aggregated diagnostics from parsing an `events.jsonl` file.
///
/// Accumulated during parsing and returned alongside events in [`ParsedEvents`].
/// Provides visibility into unknown event types and deserialization failures
/// that would otherwise be silently swallowed.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseDiagnostics {
    /// Total events parsed (raw JSONL lines that produced valid JSON).
    pub total_events: usize,
    /// Events that were successfully deserialized into typed data.
    pub typed_events: usize,
    /// Events that fell back to `TypedEventData::Other` (unknown type or deser failure).
    pub fallback_events: usize,
    /// Count of malformed JSONL lines that were skipped (invalid JSON).
    pub malformed_lines: usize,
    /// Unknown event types encountered, with per-type occurrence counts.
    pub unknown_event_types: HashMap<String, usize>,
    /// Deserialization failures by event type, with count and first error.
    pub deserialization_failures: HashMap<String, DeserFailureInfo>,
}

impl ParseDiagnostics {
    /// Record a parsing warning, updating the appropriate counters.
    pub fn record_warning(&mut self, warning: &EventParseWarning) {
        match warning {
            EventParseWarning::UnknownEventType { event_type } => {
                *self.unknown_event_types.entry(event_type.clone()).or_insert(0) += 1;
            }
            EventParseWarning::DeserializationFailed { event_type, error } => {
                self.deserialization_failures
                    .entry(event_type.clone())
                    .and_modify(|info| info.count += 1)
                    .or_insert_with(|| DeserFailureInfo {
                        count: 1,
                        first_error: error.clone(),
                    });
            }
        }
    }

    /// Whether any warnings were recorded during parsing.
    pub fn has_warnings(&self) -> bool {
        !self.unknown_event_types.is_empty()
            || !self.deserialization_failures.is_empty()
            || self.malformed_lines > 0
    }

    /// Log a summary of diagnostics via `tracing`.
    ///
    /// Unknown event types are logged at `info` level (expected during CLI evolution).
    /// Deserialization failures and malformed lines are logged at `warn` level.
    pub fn log_summary(&self) {
        if self.malformed_lines > 0 {
            tracing::warn!(
                malformed_lines = self.malformed_lines,
                "Skipped {} malformed JSONL line(s) — events may be missing from analysis",
                self.malformed_lines,
            );
        }
        if !self.unknown_event_types.is_empty() {
            tracing::info!(
                unknown_types = ?self.unknown_event_types,
                "Encountered {} unknown event type(s) across {} event(s)",
                self.unknown_event_types.len(),
                self.unknown_event_types.values().sum::<usize>(),
            );
        }
        if !self.deserialization_failures.is_empty() {
            tracing::warn!(
                failures = ?self.deserialization_failures,
                "Failed to deserialize {} known event type(s) — data stored as raw JSON",
                self.deserialization_failures.len(),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_unknown_event_types() {
        let mut diag = ParseDiagnostics::default();
        diag.record_warning(&EventParseWarning::UnknownEventType {
            event_type: "agent.thinking".to_string(),
        });
        diag.record_warning(&EventParseWarning::UnknownEventType {
            event_type: "agent.thinking".to_string(),
        });
        diag.record_warning(&EventParseWarning::UnknownEventType {
            event_type: "mcp.request".to_string(),
        });

        assert!(diag.has_warnings());
        assert_eq!(diag.unknown_event_types.len(), 2);
        assert_eq!(diag.unknown_event_types["agent.thinking"], 2);
        assert_eq!(diag.unknown_event_types["mcp.request"], 1);
    }

    #[test]
    fn tracks_deserialization_failures() {
        let mut diag = ParseDiagnostics::default();
        diag.record_warning(&EventParseWarning::DeserializationFailed {
            event_type: "session.start".to_string(),
            error: "missing field `sessionId`".to_string(),
        });
        diag.record_warning(&EventParseWarning::DeserializationFailed {
            event_type: "session.start".to_string(),
            error: "different error".to_string(),
        });

        assert!(diag.has_warnings());
        assert_eq!(diag.deserialization_failures.len(), 1);
        let info = &diag.deserialization_failures["session.start"];
        assert_eq!(info.count, 2);
        assert_eq!(info.first_error, "missing field `sessionId`");
    }

    #[test]
    fn empty_diagnostics_has_no_warnings() {
        let diag = ParseDiagnostics::default();
        assert!(!diag.has_warnings());
        assert_eq!(diag.total_events, 0);
        assert_eq!(diag.typed_events, 0);
        assert_eq!(diag.fallback_events, 0);
        assert_eq!(diag.malformed_lines, 0);
    }

    #[test]
    fn malformed_lines_trigger_warnings() {
        let diag = ParseDiagnostics {
            malformed_lines: 2,
            ..Default::default()
        };
        assert!(diag.has_warnings());
    }
}
