//! Raw JSONL line parsing — reads `events.jsonl` into [`RawEvent`] envelopes.

use crate::error::{Result, TracePilotError};
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
}

/// Parse all events from an `events.jsonl` file into raw envelopes.
///
/// PERF: I/O + CPU bound — reads entire file line-by-line, deserializes each JSON line.
/// Uses `Vec::with_capacity` based on file size estimate. For large sessions (>1MB),
/// this is the primary bottleneck (~5ms per 100KB). Consider memory-mapped I/O for >10MB files.
///
/// Reads line-by-line, skipping empty lines and logging malformed JSON.
/// Returns `(events, malformed_line_count)` so the caller can track parse quality.
#[tracing::instrument(skip_all, fields(path = %path.display()))]
pub(super) fn parse_events_jsonl(path: &Path) -> Result<(Vec<RawEvent>, usize)> {
    let file = std::fs::File::open(path)
        .map_err(|e| TracePilotError::io_context("Failed to open", path.display(), e))?;
    // Estimate event count from file size (~1KB per event) to reduce Vec reallocations
    let estimated_events = file
        .metadata()
        .map(|m| m.len() as usize / 1000)
        .unwrap_or(0);
    let reader = BufReader::new(file);
    let mut events = Vec::with_capacity(estimated_events.max(16));
    let mut malformed = 0usize;

    for (line_num, line) in reader.lines().enumerate() {
        let line = line.map_err(|e| {
            TracePilotError::io_context("Failed to read line", format!("{}", line_num + 1), e)
        })?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<RawEvent>(trimmed) {
            Ok(event) => events.push(event),
            Err(e) => {
                tracing::warn!(line = line_num + 1, error = %e, "Skipping malformed event line");
                malformed += 1;
            }
        }
    }

    Ok((events, malformed))
}
