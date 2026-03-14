//! Parser for `events.jsonl` — the line-delimited JSON event log.
//!
//! Each line is a JSON object with at minimum: `{ type, data, id, timestamp }`.
//! Events form a tree via `parentId` and are linked by `interactionId`, `toolCallId`, `turnId`.

use anyhow::{Context, Result};
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

/// Parse all events from an `events.jsonl` file.
/// Uses streaming to handle large files without loading everything into memory.
pub fn parse_events_jsonl(path: &Path) -> Result<Vec<RawEvent>> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("Failed to open {}", path.display()))?;
    let reader = BufReader::new(file);
    let mut events = Vec::new();

    for (line_num, line) in reader.lines().enumerate() {
        let line = line.with_context(|| format!("Failed to read line {}", line_num + 1))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<RawEvent>(trimmed) {
            Ok(event) => events.push(event),
            Err(e) => {
                tracing::warn!(line = line_num + 1, error = %e, "Skipping malformed event line");
            }
        }
    }

    Ok(events)
}

/// Count events without fully parsing them (fast scan).
pub fn count_events(path: &Path) -> Result<usize> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("Failed to open {}", path.display()))?;
    let reader = BufReader::new(file);
    Ok(reader.lines().filter(|l| l.as_ref().is_ok_and(|s| !s.trim().is_empty())).count())
}
