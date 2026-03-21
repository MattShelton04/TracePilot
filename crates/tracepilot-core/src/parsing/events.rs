//! Parser for `events.jsonl` — the line-delimited JSON event log.
//!
//! ## Pipeline
//!
//! ```text
//! events.jsonl
//!   → parse_events_jsonl()  → Vec<RawEvent>  (skip malformed lines)
//!   → parse_typed_events()  → ParsedEvents { events: Vec<TypedEvent>, diagnostics }
//! ```
//!
//! Each line is a JSON object with at minimum: `{ type, data, id, timestamp }`.
//! Events form a tree via `parentId` and are linked by `interactionId`, `toolCallId`, `turnId`.
//!
//! Unknown event types and deserialization failures are tracked in [`ParseDiagnostics`]
//! rather than being silently swallowed, enabling health scoring and debugging.

use crate::error::{Result, TracePilotError};
use crate::models::event_types::{
    AbortData, AssistantMessageData, AssistantReasoningData, CodeChanges, CompactionCompleteData,
    CompactionStartData, HookEndData, HookStartData, ModelChangeData, ModelMetricDetail,
    PlanChangedData, RequestMetrics, SessionContext, SessionErrorData, SessionEventType,
    SessionHandoffData, SessionImportLegacyData, SessionInfoData, SessionModeChangedData,
    SessionResumeData, SessionStartData, SessionTaskCompleteData, SessionTruncationData,
    SessionWarningData, ShutdownData, SkillInvokedData, SubagentCompletedData,
    SubagentDeselectedData, SubagentFailedData, SubagentSelectedData, SubagentStartedData,
    SystemMessageData, SystemNotificationData, ToolExecCompleteData, ToolExecStartData,
    ToolUserRequestedData, TurnEndData, TurnStartData, UsageMetrics, UserMessageData,
    WorkspaceFileChangedData,
};
use crate::parsing::diagnostics::{EventParseWarning, ParseDiagnostics};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
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

/// A fully typed event with parsed data.
#[derive(Debug, Clone)]
pub struct TypedEvent {
    pub raw: RawEvent,
    pub event_type: SessionEventType,
    pub typed_data: TypedEventData,
}

/// Typed variants for known event data, with `Other` as a catch-all.
///
/// Each variant corresponds to a [`SessionEventType`] and wraps a strongly-typed
/// data struct. When deserialization of the typed struct fails (e.g. due to schema
/// evolution), the raw JSON `Value` is preserved as `Other`.
#[derive(Debug, Clone)]
pub enum TypedEventData {
    SessionStart(SessionStartData),
    SessionShutdown(ShutdownData),
    UserMessage(UserMessageData),
    AssistantMessage(AssistantMessageData),
    TurnStart(TurnStartData),
    TurnEnd(TurnEndData),
    ToolExecutionStart(ToolExecStartData),
    ToolExecutionComplete(ToolExecCompleteData),
    SubagentStarted(SubagentStartedData),
    SubagentCompleted(SubagentCompletedData),
    SubagentFailed(SubagentFailedData),
    CompactionComplete(CompactionCompleteData),
    CompactionStart(CompactionStartData),
    ModelChange(ModelChangeData),
    SessionError(SessionErrorData),
    SessionResume(SessionResumeData),
    SystemNotification(SystemNotificationData),
    SkillInvoked(SkillInvokedData),
    Abort(AbortData),
    PlanChanged(PlanChangedData),
    SessionInfo(SessionInfoData),
    ContextChanged(SessionContext),
    WorkspaceFileChanged(WorkspaceFileChangedData),
    ToolUserRequested(ToolUserRequestedData),
    // New typed variants
    SessionTruncation(SessionTruncationData),
    AssistantReasoning(AssistantReasoningData),
    SystemMessage(SystemMessageData),
    SessionWarning(SessionWarningData),
    SessionModeChanged(SessionModeChangedData),
    SessionTaskComplete(SessionTaskCompleteData),
    SubagentSelected(SubagentSelectedData),
    SubagentDeselected(SubagentDeselectedData),
    HookStart(HookStartData),
    HookEnd(HookEndData),
    SessionHandoff(SessionHandoffData),
    SessionImportLegacy(SessionImportLegacyData),
    Other(Value),
}

/// Result of parsing an `events.jsonl` file.
///
/// Contains both the typed events and parsing diagnostics (unknown event types,
/// deserialization failures, malformed line counts). Callers that only need events
/// can access `.events` directly.
pub struct ParsedEvents {
    /// The parsed and typed events.
    pub events: Vec<TypedEvent>,
    /// Diagnostics about parsing issues encountered.
    pub diagnostics: ParseDiagnostics,
}

/// A typed event with its byte position in the source file.
#[derive(Debug)]
pub struct TypedEventWithOffset {
    pub event: TypedEvent,
    pub byte_offset: u64,
    pub line_length: u64,
}

/// Result of parsing with byte offsets.
pub struct ParsedEventsWithOffsets {
    pub events: Vec<TypedEventWithOffset>,
    /// Byte offset after the last complete line (checkpoint for incremental parsing).
    pub final_byte_offset: u64,
    pub diagnostics: ParseDiagnostics,
}

/// Parse all events from an `events.jsonl` file into raw envelopes.
///
/// Reads line-by-line, skipping empty lines and logging malformed JSON.
/// Returns `(events, malformed_line_count)` so the caller can track parse quality.
fn parse_events_jsonl(path: &Path) -> Result<(Vec<RawEvent>, usize)> {
    let file = std::fs::File::open(path).map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to open {}", path.display()),
        source: Some(Box::new(e)),
    })?;
    let reader = BufReader::new(file);
    let mut events = Vec::new();
    let mut malformed = 0usize;

    for (line_num, line) in reader.lines().enumerate() {
        let line = line.map_err(|e| TracePilotError::ParseError {
            context: format!("Failed to read line {}", line_num + 1),
            source: Some(Box::new(e)),
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

/// A parsed event together with its byte position in the source file.
#[derive(Debug)]
pub struct EventWithOffset {
    pub event: RawEvent,
    /// Absolute byte offset of the start of this event's line in the file.
    pub byte_offset: u64,
    /// Byte length of the complete line (including the trailing `\n`).
    pub line_length: u64,
}

/// Parse all events from an `events.jsonl` file, tracking byte offsets.
///
/// Returns each event with its `(byte_offset, line_length)` for direct seeking.
/// Empty and malformed lines are skipped (advancing the position) but don't
/// produce entries. The final `new_byte_offset` is the position after the last
/// complete newline-terminated line (safe checkpoint for incremental parsing).
pub fn parse_events_with_offsets(path: &Path) -> Result<(Vec<EventWithOffset>, u64, usize)> {
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to open {}", path.display()),
        source: Some(Box::new(e)),
    })?;

    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to read {}", path.display()),
        source: Some(Box::new(e)),
    })?;

    let mut events = Vec::new();
    let mut malformed = 0usize;
    let mut consumed = 0u64;

    for line_bytes in buf.split_inclusive(|&b| b == b'\n') {
        let line_start = consumed;
        let line_len = line_bytes.len() as u64;

        // Partial trailing line (no \n) — stop here
        if !line_bytes.ends_with(b"\n") {
            break;
        }

        consumed += line_len;

        let line = match std::str::from_utf8(line_bytes) {
            Ok(s) => s.trim(),
            Err(_) => {
                malformed += 1;
                continue;
            }
        };

        if line.is_empty() {
            continue;
        }

        match serde_json::from_str::<RawEvent>(line) {
            Ok(event) => events.push(EventWithOffset {
                event,
                byte_offset: line_start,
                line_length: line_len,
            }),
            Err(e) => {
                tracing::warn!(line_offset = line_start, error = %e, "Skipping malformed event line");
                malformed += 1;
            }
        }
    }

    Ok((events, consumed, malformed))
}

/// Result of an incremental JSONL parse from a byte offset.
pub struct IncrementalParseResult {
    /// Newly parsed raw events (only those after the offset).
    pub events: Vec<RawEvent>,
    /// Byte offset just past the last successfully parsed, newline-terminated line.
    /// Safe to use as the starting offset for the next incremental parse.
    pub new_byte_offset: u64,
    /// Number of malformed lines encountered (excluding a potential partial trailing line).
    pub malformed_lines: usize,
}

/// Parse events.jsonl starting from a byte offset (incremental mode).
///
/// Used for checkpointed parsing of append-only JSONL files. Only reads bytes
/// from `byte_offset` to EOF, parsing each newline-terminated line as a [`RawEvent`].
///
/// **Safety guarantees:**
/// - If the file size is less than `byte_offset`, returns an error indicating the
///   file was truncated/rewritten (caller should trigger a full re-parse).
/// - The returned `new_byte_offset` only advances past fully newline-terminated,
///   successfully parsed lines. A partial trailing line (no `\n`) is never consumed.
/// - Malformed but newline-terminated lines are skipped and counted.
pub fn parse_events_jsonl_from_offset(
    path: &Path,
    byte_offset: u64,
) -> Result<IncrementalParseResult> {
    use std::io::{Read, Seek, SeekFrom};

    let mut file = std::fs::File::open(path).map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to open {}", path.display()),
        source: Some(Box::new(e)),
    })?;

    let file_len = file
        .metadata()
        .map_err(|e| TracePilotError::ParseError {
            context: format!("Failed to stat {}", path.display()),
            source: Some(Box::new(e)),
        })?
        .len();

    // If file is smaller than our checkpoint, it was truncated/rewritten.
    if file_len < byte_offset {
        return Err(TracePilotError::ParseError {
            context: format!(
                "events.jsonl was truncated (size {} < offset {}): {}",
                file_len,
                byte_offset,
                path.display()
            ),
            source: None,
        });
    }

    // If no new bytes, return empty result.
    if file_len == byte_offset {
        return Ok(IncrementalParseResult {
            events: Vec::new(),
            new_byte_offset: byte_offset,
            malformed_lines: 0,
        });
    }

    file.seek(SeekFrom::Start(byte_offset)).map_err(|e| {
        TracePilotError::ParseError {
            context: format!("Failed to seek to offset {}", byte_offset),
            source: Some(Box::new(e)),
        }
    })?;

    // Read the remaining bytes into a buffer.
    let remaining = (file_len - byte_offset) as usize;
    let mut buf = Vec::with_capacity(remaining);
    file.read_to_end(&mut buf).map_err(|e| {
        TracePilotError::ParseError {
            context: format!("Failed to read from offset {}", byte_offset),
            source: Some(Box::new(e)),
        }
    })?;

    let mut events = Vec::new();
    let mut malformed = 0usize;
    let mut consumed = 0u64; // bytes consumed relative to byte_offset

    // Process only complete newline-terminated lines.
    for line_bytes in buf.split_inclusive(|&b| b == b'\n') {
        // If the last chunk doesn't end with \n, it's a partial write — stop here.
        if !line_bytes.ends_with(b"\n") {
            break;
        }

        consumed += line_bytes.len() as u64;

        let line = match std::str::from_utf8(line_bytes) {
            Ok(s) => s.trim(),
            Err(_) => {
                malformed += 1;
                continue;
            }
        };

        if line.is_empty() {
            continue;
        }

        match serde_json::from_str::<RawEvent>(line) {
            Ok(event) => events.push(event),
            Err(e) => {
                tracing::warn!(error = %e, "Skipping malformed event line in incremental parse");
                malformed += 1;
            }
        }
    }

    Ok(IncrementalParseResult {
        events,
        new_byte_offset: byte_offset + consumed,
        malformed_lines: malformed,
    })
}

/// Deserialize the `data` field of a [`RawEvent`] into the appropriate typed variant.
///
/// Returns `(typed_data, optional_warning)`. On success, the warning is `None`.
/// On failure (unknown type or deserialization error), the raw JSON `Value` is
/// preserved as [`TypedEventData::Other`] and a warning is returned.
///
/// The `ContextChanged` variant wraps `SessionContext` — the same struct used
/// by `session.start` and `session.resume`.
pub fn typed_data_from_raw(
    event_type: &SessionEventType,
    data: &Value,
) -> (TypedEventData, Option<EventParseWarning>) {
    /// Helper: attempt deserialization, return warning on failure.
    macro_rules! try_deser {
        ($variant:ident, $data_type:ty, $wire:expr, $data:expr) => {{
            match serde_json::from_value::<$data_type>($data.clone()) {
                Ok(typed) => (TypedEventData::$variant(typed), None),
                Err(e) => (
                    TypedEventData::Other($data.clone()),
                    Some(EventParseWarning::DeserializationFailed {
                        event_type: $wire.to_string(),
                        error: e.to_string(),
                    }),
                ),
            }
        }};
    }

    match event_type {
        SessionEventType::SessionStart => {
            try_deser!(SessionStart, SessionStartData, "session.start", data)
        }
        SessionEventType::SessionShutdown => {
            try_deser!(SessionShutdown, ShutdownData, "session.shutdown", data)
        }
        SessionEventType::UserMessage => {
            try_deser!(UserMessage, UserMessageData, "user.message", data)
        }
        SessionEventType::AssistantMessage => {
            try_deser!(AssistantMessage, AssistantMessageData, "assistant.message", data)
        }
        SessionEventType::AssistantTurnStart => {
            try_deser!(TurnStart, TurnStartData, "assistant.turn_start", data)
        }
        SessionEventType::AssistantTurnEnd => {
            try_deser!(TurnEnd, TurnEndData, "assistant.turn_end", data)
        }
        SessionEventType::ToolExecutionStart => {
            try_deser!(ToolExecutionStart, ToolExecStartData, "tool.execution_start", data)
        }
        SessionEventType::ToolExecutionComplete => {
            try_deser!(ToolExecutionComplete, ToolExecCompleteData, "tool.execution_complete", data)
        }
        SessionEventType::SubagentStarted => {
            try_deser!(SubagentStarted, SubagentStartedData, "subagent.started", data)
        }
        SessionEventType::SubagentCompleted => {
            try_deser!(SubagentCompleted, SubagentCompletedData, "subagent.completed", data)
        }
        SessionEventType::SubagentFailed => {
            try_deser!(SubagentFailed, SubagentFailedData, "subagent.failed", data)
        }
        SessionEventType::SessionCompactionComplete => {
            try_deser!(CompactionComplete, CompactionCompleteData, "session.compaction_complete", data)
        }
        SessionEventType::SessionCompactionStart => {
            try_deser!(CompactionStart, CompactionStartData, "session.compaction_start", data)
        }
        SessionEventType::SessionModelChange => {
            try_deser!(ModelChange, ModelChangeData, "session.model_change", data)
        }
        SessionEventType::SessionError => {
            try_deser!(SessionError, SessionErrorData, "session.error", data)
        }
        SessionEventType::SessionResume => {
            try_deser!(SessionResume, SessionResumeData, "session.resume", data)
        }
        SessionEventType::SystemNotification => {
            try_deser!(SystemNotification, SystemNotificationData, "system.notification", data)
        }
        SessionEventType::SkillInvoked => {
            try_deser!(SkillInvoked, SkillInvokedData, "skill.invoked", data)
        }
        SessionEventType::Abort => {
            try_deser!(Abort, AbortData, "abort", data)
        }
        SessionEventType::SessionPlanChanged => {
            try_deser!(PlanChanged, PlanChangedData, "session.plan_changed", data)
        }
        SessionEventType::SessionInfo => {
            try_deser!(SessionInfo, SessionInfoData, "session.info", data)
        }
        SessionEventType::SessionContextChanged => {
            try_deser!(ContextChanged, SessionContext, "session.context_changed", data)
        }
        SessionEventType::SessionWorkspaceFileChanged => {
            try_deser!(WorkspaceFileChanged, WorkspaceFileChangedData, "session.workspace_file_changed", data)
        }
        SessionEventType::ToolUserRequested => {
            try_deser!(ToolUserRequested, ToolUserRequestedData, "tool.user_requested", data)
        }
        // New event types
        SessionEventType::SessionTruncation => {
            try_deser!(SessionTruncation, SessionTruncationData, "session.truncation", data)
        }
        SessionEventType::AssistantReasoning => {
            try_deser!(AssistantReasoning, AssistantReasoningData, "assistant.reasoning", data)
        }
        SessionEventType::SystemMessage => {
            try_deser!(SystemMessage, SystemMessageData, "system.message", data)
        }
        SessionEventType::SessionWarning => {
            try_deser!(SessionWarning, SessionWarningData, "session.warning", data)
        }
        SessionEventType::SessionModeChanged => {
            try_deser!(SessionModeChanged, SessionModeChangedData, "session.mode_changed", data)
        }
        SessionEventType::SessionTaskComplete => {
            try_deser!(SessionTaskComplete, SessionTaskCompleteData, "session.task_complete", data)
        }
        SessionEventType::SubagentSelected => {
            try_deser!(SubagentSelected, SubagentSelectedData, "subagent.selected", data)
        }
        SessionEventType::SubagentDeselected => {
            try_deser!(SubagentDeselected, SubagentDeselectedData, "subagent.deselected", data)
        }
        SessionEventType::HookStart => {
            try_deser!(HookStart, HookStartData, "hook.start", data)
        }
        SessionEventType::HookEnd => {
            try_deser!(HookEnd, HookEndData, "hook.end", data)
        }
        SessionEventType::SessionHandoff => {
            try_deser!(SessionHandoff, SessionHandoffData, "session.handoff", data)
        }
        SessionEventType::SessionImportLegacy => {
            try_deser!(SessionImportLegacy, SessionImportLegacyData, "session.import_legacy", data)
        }
        SessionEventType::Unknown(name) => (
            TypedEventData::Other(data.clone()),
            Some(EventParseWarning::UnknownEventType {
                event_type: name.clone(),
            }),
        ),
    }
}

/// Parse `events.jsonl` into fully typed events with diagnostics.
///
/// Reads the file line-by-line, parses each [`RawEvent`], converts the string
/// event type into [`SessionEventType`], and deserializes data into the matching
/// typed struct — falling back to [`TypedEventData::Other`] on failure.
///
/// Returns [`ParsedEvents`] containing both the events and parsing diagnostics
/// (unknown event types, deserialization failures, malformed line counts).
pub fn parse_typed_events(path: &Path) -> Result<ParsedEvents> {
    let (raw_events, malformed) = parse_events_jsonl(path)?;
    let mut diagnostics = ParseDiagnostics {
        malformed_lines: malformed,
        ..Default::default()
    };
    let mut events = Vec::with_capacity(raw_events.len());

    for raw in raw_events {
        let event_type = SessionEventType::parse_wire(raw.event_type.as_str());
        let (typed_data, warning) = typed_data_from_raw(&event_type, &raw.data);

        diagnostics.total_events += 1;
        if matches!(typed_data, TypedEventData::Other(_)) {
            diagnostics.fallback_events += 1;
        } else {
            diagnostics.typed_events += 1;
        }
        if let Some(ref w) = warning {
            diagnostics.record_warning(w);
        }

        events.push(TypedEvent {
            raw,
            event_type,
            typed_data,
        });
    }

    diagnostics.log_summary();
    Ok(ParsedEvents { events, diagnostics })
}

/// Parse all events with byte offsets for each event's position in the file.
///
/// Used by the indexer to build the lean metadata cache with per-event byte offsets.
pub fn parse_typed_events_with_offsets(path: &Path) -> Result<ParsedEventsWithOffsets> {
    let (raw_events_with_offsets, final_offset, malformed) = parse_events_with_offsets(path)?;
    let mut diagnostics = ParseDiagnostics {
        malformed_lines: malformed,
        ..Default::default()
    };
    let mut events = Vec::with_capacity(raw_events_with_offsets.len());

    for ewo in raw_events_with_offsets {
        let event_type = SessionEventType::parse_wire(ewo.event.event_type.as_str());
        let (typed_data, warning) = typed_data_from_raw(&event_type, &ewo.event.data);

        diagnostics.total_events += 1;
        if matches!(typed_data, TypedEventData::Other(_)) {
            diagnostics.fallback_events += 1;
        } else {
            diagnostics.typed_events += 1;
        }
        if let Some(ref w) = warning {
            diagnostics.record_warning(w);
        }

        events.push(TypedEventWithOffset {
            event: TypedEvent {
                raw: ewo.event,
                event_type,
                typed_data,
            },
            byte_offset: ewo.byte_offset,
            line_length: ewo.line_length,
        });
    }

    diagnostics.log_summary();
    Ok(ParsedEventsWithOffsets {
        events,
        final_byte_offset: final_offset,
        diagnostics,
    })
}

/// Collect ALL `session.shutdown` events and combine their per-instance metrics.
///
/// Metrics in each shutdown event are per-instance (not cumulative), so resumed
/// sessions require summing across all shutdown events. Returns `(combined_data, count)`.
pub fn extract_combined_shutdown_data(events: &[TypedEvent]) -> Option<(ShutdownData, u32)> {
    let shutdowns: Vec<&ShutdownData> = events
        .iter()
        .filter(|e| e.event_type == SessionEventType::SessionShutdown)
        .filter_map(|e| match &e.typed_data {
            TypedEventData::SessionShutdown(d) => Some(d),
            _ => None,
        })
        .collect();

    if shutdowns.is_empty() {
        return None;
    }

    let count = shutdowns.len() as u32;
    if count == 1 {
        return Some((shutdowns[0].clone(), 1));
    }

    Some((combine_shutdown_data(&shutdowns), count))
}

/// Combine multiple `ShutdownData` instances into a single aggregate.
fn combine_shutdown_data(shutdowns: &[&ShutdownData]) -> ShutdownData {
    let first = shutdowns.first().unwrap();
    let last = shutdowns.last().unwrap();

    ShutdownData {
        shutdown_type: last.shutdown_type.clone(),
        current_model: last.current_model.clone(),
        session_start_time: first.session_start_time,
        total_premium_requests: sum_opt_f64(shutdowns.iter().map(|s| s.total_premium_requests)),
        total_api_duration_ms: sum_opt_u64(shutdowns.iter().map(|s| s.total_api_duration_ms)),
        code_changes: combine_code_changes(shutdowns.iter().map(|s| s.code_changes.as_ref())),
        model_metrics: Some(combine_model_metrics(
            shutdowns.iter().map(|s| s.model_metrics.as_ref()),
        )),
    }
}

/// Sum Option<f64> values: None + Some(5) = Some(5), None + None = None.
fn sum_opt_f64(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    let mut has_any = false;
    let mut total = 0.0;
    for v in values {
        if let Some(n) = v {
            has_any = true;
            total += n;
        }
    }
    if has_any { Some(total) } else { None }
}

/// Sum Option<u64> values: None + Some(5) = Some(5), None + None = None.
fn sum_opt_u64(values: impl Iterator<Item = Option<u64>>) -> Option<u64> {
    let mut has_any = false;
    let mut total = 0u64;
    for v in values {
        if let Some(n) = v {
            has_any = true;
            total += n;
        }
    }
    if has_any { Some(total) } else { None }
}

/// Combine code changes: sum lines, deduplicate files.
fn combine_code_changes<'a>(
    changes: impl Iterator<Item = Option<&'a CodeChanges>>,
) -> Option<CodeChanges> {
    let items: Vec<&CodeChanges> = changes.flatten().collect();
    if items.is_empty() {
        return None;
    }

    let lines_added = sum_opt_u64(items.iter().map(|c| c.lines_added));
    let lines_removed = sum_opt_u64(items.iter().map(|c| c.lines_removed));

    // Deduplicated union of all modified files
    let files_modified = {
        let mut seen = std::collections::HashSet::new();
        let mut files = Vec::new();
        for c in &items {
            if let Some(ref f) = c.files_modified {
                for path in f {
                    if seen.insert(path.clone()) {
                        files.push(path.clone());
                    }
                }
            }
        }
        if files.is_empty() { None } else { Some(files) }
    };

    Some(CodeChanges {
        lines_added,
        lines_removed,
        files_modified,
    })
}

/// Merge per-model metric HashMaps: for each model key, sum all numeric fields.
fn combine_model_metrics<'a>(
    maps: impl Iterator<Item = Option<&'a HashMap<String, ModelMetricDetail>>>,
) -> HashMap<String, ModelMetricDetail> {
    let mut merged: HashMap<String, ModelMetricDetail> = HashMap::new();

    for map in maps.flatten() {
        for (model, detail) in map {
            let entry = merged.entry(model.clone()).or_insert_with(|| ModelMetricDetail {
                requests: None,
                usage: None,
            });

            // Merge requests
            if let Some(ref req) = detail.requests {
                let e_req = entry.requests.get_or_insert(RequestMetrics {
                    count: None,
                    cost: None,
                });
                e_req.count = sum_opt_u64([e_req.count, req.count].into_iter());
                e_req.cost = sum_opt_f64([e_req.cost, req.cost].into_iter());
            }

            // Merge usage
            if let Some(ref usg) = detail.usage {
                let e_usg = entry.usage.get_or_insert(UsageMetrics {
                    input_tokens: None,
                    output_tokens: None,
                    cache_read_tokens: None,
                    cache_write_tokens: None,
                });
                e_usg.input_tokens = sum_opt_u64([e_usg.input_tokens, usg.input_tokens].into_iter());
                e_usg.output_tokens = sum_opt_u64([e_usg.output_tokens, usg.output_tokens].into_iter());
                e_usg.cache_read_tokens = sum_opt_u64([e_usg.cache_read_tokens, usg.cache_read_tokens].into_iter());
                e_usg.cache_write_tokens = sum_opt_u64([e_usg.cache_write_tokens, usg.cache_write_tokens].into_iter());
            }
        }
    }

    merged
}

/// Extract session start data from the FIRST `session.start` event.
pub fn extract_session_start(events: &[TypedEvent]) -> Option<SessionStartData> {
    events
        .iter()
        .find(|e| e.event_type == SessionEventType::SessionStart)
        .and_then(|e| match &e.typed_data {
            TypedEventData::SessionStart(d) => Some(d.clone()),
            _ => None,
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn sample_jsonl() -> &'static str {
        concat!(
            r#"{"type":"session.start","data":{"sessionId":"abc-123","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"main"}},"id":"evt-1","timestamp":"2026-03-10T07:14:50.780Z","parentId":null}"#,
            "\n",
            r#"{"type":"user.message","data":{"content":"Hello world","interactionId":"int-1","attachments":[]},"id":"evt-2","timestamp":"2026-03-10T07:14:51.000Z","parentId":"evt-1"}"#,
            "\n",
            r#"{"type":"assistant.turn_start","data":{"turnId":"turn-1","interactionId":"int-1"},"id":"evt-3","timestamp":"2026-03-10T07:14:51.100Z","parentId":"evt-2"}"#,
            "\n",
            r#"{"type":"assistant.message","data":{"messageId":"msg-1","content":"Hi there!","interactionId":"int-1"},"id":"evt-4","timestamp":"2026-03-10T07:14:52.000Z","parentId":"evt-3"}"#,
            "\n",
            r#"{"type":"tool.execution_start","data":{"toolCallId":"tc-1","toolName":"read_file","arguments":{"path":"/test/foo.rs"}},"id":"evt-5","timestamp":"2026-03-10T07:14:52.100Z","parentId":"evt-4"}"#,
            "\n",
            r#"{"type":"tool.execution_complete","data":{"toolCallId":"tc-1","model":"claude-opus-4.6","interactionId":"int-1","success":true,"result":"file contents"},"id":"evt-6","timestamp":"2026-03-10T07:14:52.500Z","parentId":"evt-5"}"#,
            "\n",
            r#"{"type":"assistant.turn_end","data":{"turnId":"turn-1"},"id":"evt-7","timestamp":"2026-03-10T07:14:53.000Z","parentId":"evt-3"}"#,
            "\n",
            r#"{"type":"session.shutdown","data":{"shutdownType":"routine","totalPremiumRequests":1,"totalApiDurationMs":5000,"sessionStartTime":1773270552854,"currentModel":"claude-opus-4.6","codeChanges":{"linesAdded":10,"linesRemoved":2,"filesModified":["/test/foo.rs"]},"modelMetrics":{"claude-opus-4.6":{"requests":{"count":3,"cost":1},"usage":{"inputTokens":1000,"outputTokens":500,"cacheReadTokens":800,"cacheWriteTokens":0}}}},"id":"evt-8","timestamp":"2026-03-10T07:15:00.000Z","parentId":null}"#,
            "\n",
        )
    }

    fn write_sample_file(dir: &tempfile::TempDir) -> std::path::PathBuf {
        let path = dir.path().join("events.jsonl");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(sample_jsonl().as_bytes()).unwrap();
        path
    }

    #[test]
    fn test_parse_raw_events() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample_file(&dir);
        let (events, malformed) = parse_events_jsonl(&path).unwrap();
        assert_eq!(events.len(), 8);
        assert_eq!(malformed, 0);
        assert_eq!(events[0].event_type, "session.start");
        assert_eq!(events[1].event_type, "user.message");
        assert_eq!(events[4].event_type, "tool.execution_start");
        assert_eq!(events[7].event_type, "session.shutdown");
        assert_eq!(events[0].id.as_deref(), Some("evt-1"));
    }

    #[test]
    fn test_parse_typed_events() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample_file(&dir);
        let parsed = parse_typed_events(&path).unwrap();
        let events = &parsed.events;
        assert_eq!(events.len(), 8);
        assert_eq!(parsed.diagnostics.total_events, 8);
        assert_eq!(parsed.diagnostics.fallback_events, 0);

        // session.start
        assert_eq!(events[0].event_type, SessionEventType::SessionStart);
        match &events[0].typed_data {
            TypedEventData::SessionStart(d) => {
                assert_eq!(d.session_id.as_deref(), Some("abc-123"));
                assert_eq!(d.producer.as_deref(), Some("copilot-cli"));
            }
            other => panic!("Expected SessionStart, got {:?}", other),
        }

        // user.message
        assert_eq!(events[1].event_type, SessionEventType::UserMessage);
        match &events[1].typed_data {
            TypedEventData::UserMessage(d) => {
                assert_eq!(d.content.as_deref(), Some("Hello world"));
            }
            other => panic!("Expected UserMessage, got {:?}", other),
        }

        // assistant.message
        assert_eq!(events[3].event_type, SessionEventType::AssistantMessage);
        match &events[3].typed_data {
            TypedEventData::AssistantMessage(d) => {
                assert_eq!(d.content.as_deref(), Some("Hi there!"));
            }
            other => panic!("Expected AssistantMessage, got {:?}", other),
        }

        // tool.execution_start
        assert_eq!(events[4].event_type, SessionEventType::ToolExecutionStart);
        match &events[4].typed_data {
            TypedEventData::ToolExecutionStart(d) => {
                assert_eq!(d.tool_name.as_deref(), Some("read_file"));
            }
            other => panic!("Expected ToolExecutionStart, got {:?}", other),
        }

        // tool.execution_complete
        assert_eq!(
            events[5].event_type,
            SessionEventType::ToolExecutionComplete
        );
        match &events[5].typed_data {
            TypedEventData::ToolExecutionComplete(d) => {
                assert_eq!(d.success, Some(true));
                assert_eq!(d.model.as_deref(), Some("claude-opus-4.6"));
            }
            other => panic!("Expected ToolExecutionComplete, got {:?}", other),
        }
    }

    #[test]
    fn test_extract_shutdown() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample_file(&dir);
        let events = parse_typed_events(&path).unwrap().events;
        let result = extract_combined_shutdown_data(&events);
        assert!(result.is_some());
        let (sd, count) = result.unwrap();
        assert_eq!(count, 1);
        assert_eq!(sd.shutdown_type.as_deref(), Some("routine"));
        assert_eq!(sd.total_premium_requests, Some(1.0));
        assert_eq!(sd.current_model.as_deref(), Some("claude-opus-4.6"));
        let changes = sd.code_changes.unwrap();
        assert_eq!(changes.lines_added, Some(10));
        assert_eq!(changes.lines_removed, Some(2));
    }

    #[test]
    fn test_extract_session_start() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample_file(&dir);
        let events = parse_typed_events(&path).unwrap().events;
        let start = extract_session_start(&events);
        assert!(start.is_some());
        let sd = start.unwrap();
        assert_eq!(sd.session_id.as_deref(), Some("abc-123"));
    }

    #[test]
    fn test_malformed_line_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        let content = concat!(
            r#"{"type":"session.start","data":{"sessionId":"abc"},"id":"e1","timestamp":"2026-03-10T07:14:50.780Z","parentId":null}"#,
            "\n",
            "NOT VALID JSON\n",
            r#"{"type":"user.message","data":{"content":"hi"},"id":"e2","timestamp":"2026-03-10T07:14:51.000Z","parentId":"e1"}"#,
            "\n",
        );
        std::fs::write(&path, content).unwrap();
        let (events, malformed) = parse_events_jsonl(&path).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(malformed, 1);
    }

    #[test]
    fn test_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        std::fs::write(&path, "").unwrap();
        let (events, malformed) = parse_events_jsonl(&path).unwrap();
        assert!(events.is_empty());
        assert_eq!(malformed, 0);

        let parsed = parse_typed_events(&path).unwrap();
        assert!(parsed.events.is_empty());
        assert_eq!(parsed.diagnostics.total_events, 0);
    }

    // ── Combined shutdown tests ──────────────────────────────────────

    #[test]
    fn test_extract_combined_shutdown_single() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample_file(&dir);
        let events = parse_typed_events(&path).unwrap().events;
        let (sd, count) = extract_combined_shutdown_data(&events).unwrap();
        assert_eq!(count, 1);
        assert_eq!(sd.shutdown_type.as_deref(), Some("routine"));
        assert_eq!(sd.total_premium_requests, Some(1.0));
        assert_eq!(sd.total_api_duration_ms, Some(5000));
        assert_eq!(sd.current_model.as_deref(), Some("claude-opus-4.6"));
        let changes = sd.code_changes.unwrap();
        assert_eq!(changes.lines_added, Some(10));
        assert_eq!(changes.lines_removed, Some(2));
    }

    /// Build events.jsonl with two shutdown events (simulating a resumed session).
    fn resumed_session_jsonl() -> String {
        let mut lines = Vec::new();
        // session.start
        lines.push(r#"{"type":"session.start","data":{"sessionId":"resumed-1","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"main"}},"id":"evt-1","timestamp":"2026-03-10T07:00:00.000Z","parentId":null}"#.to_string());
        // first shutdown: 12 premium requests, 5000ms, model A with 1000 input tokens
        lines.push(r#"{"type":"session.shutdown","data":{"shutdownType":"routine","totalPremiumRequests":12,"totalApiDurationMs":5000,"sessionStartTime":1000000,"currentModel":"claude-sonnet-4.5","codeChanges":{"linesAdded":10,"linesRemoved":2,"filesModified":["/a.rs","/b.rs"]},"modelMetrics":{"claude-sonnet-4.5":{"requests":{"count":20,"cost":5.0},"usage":{"inputTokens":1000,"outputTokens":500,"cacheReadTokens":800,"cacheWriteTokens":100}}}},"id":"evt-2","timestamp":"2026-03-10T07:10:00.000Z","parentId":null}"#.to_string());
        // session.resume
        lines.push(r#"{"type":"session.resume","data":{"resumeTime":"2026-03-10T08:00:00.000Z"},"id":"evt-3","timestamp":"2026-03-10T08:00:00.000Z","parentId":null}"#.to_string());
        // second shutdown: 6 premium requests, 3000ms, model A+B
        lines.push(r#"{"type":"session.shutdown","data":{"shutdownType":"user_exit","totalPremiumRequests":6,"totalApiDurationMs":3000,"sessionStartTime":2000000,"currentModel":"claude-opus-4.6","codeChanges":{"linesAdded":5,"linesRemoved":3,"filesModified":["/b.rs","/c.rs"]},"modelMetrics":{"claude-sonnet-4.5":{"requests":{"count":10,"cost":2.5},"usage":{"inputTokens":500,"outputTokens":250,"cacheReadTokens":400,"cacheWriteTokens":50}},"claude-opus-4.6":{"requests":{"count":8,"cost":4.0},"usage":{"inputTokens":2000,"outputTokens":1000,"cacheReadTokens":1500,"cacheWriteTokens":200}}}},"id":"evt-4","timestamp":"2026-03-10T08:10:00.000Z","parentId":null}"#.to_string());
        lines.join("\n") + "\n"
    }

    #[test]
    fn test_extract_combined_shutdown_multiple() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        std::fs::write(&path, resumed_session_jsonl()).unwrap();
        let events = parse_typed_events(&path).unwrap().events;
        let (sd, count) = extract_combined_shutdown_data(&events).unwrap();

        assert_eq!(count, 2);
        // Last shutdown's values for non-summed fields
        assert_eq!(sd.shutdown_type.as_deref(), Some("user_exit"));
        assert_eq!(sd.current_model.as_deref(), Some("claude-opus-4.6"));
        // First shutdown's session_start_time
        assert_eq!(sd.session_start_time, Some(1000000));
        // Summed metrics: 12 + 6 = 18, 5000 + 3000 = 8000
        assert_eq!(sd.total_premium_requests, Some(18.0));
        assert_eq!(sd.total_api_duration_ms, Some(8000));
        // Code changes summed: 10+5=15 added, 2+3=5 removed
        let changes = sd.code_changes.unwrap();
        assert_eq!(changes.lines_added, Some(15));
        assert_eq!(changes.lines_removed, Some(5));
    }

    #[test]
    fn test_extract_combined_shutdown_files_deduped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        std::fs::write(&path, resumed_session_jsonl()).unwrap();
        let events = parse_typed_events(&path).unwrap().events;
        let (sd, _) = extract_combined_shutdown_data(&events).unwrap();

        let files = sd.code_changes.unwrap().files_modified.unwrap();
        // /a.rs, /b.rs from first; /b.rs, /c.rs from second → deduped = /a.rs, /b.rs, /c.rs
        assert_eq!(files.len(), 3);
        assert!(files.contains(&"/a.rs".to_string()));
        assert!(files.contains(&"/b.rs".to_string()));
        assert!(files.contains(&"/c.rs".to_string()));
    }

    #[test]
    fn test_extract_combined_model_metrics_merged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        std::fs::write(&path, resumed_session_jsonl()).unwrap();
        let events = parse_typed_events(&path).unwrap().events;
        let (sd, _) = extract_combined_shutdown_data(&events).unwrap();

        let metrics = sd.model_metrics.unwrap();
        // claude-sonnet-4.5: merged from both shutdowns
        let sonnet = &metrics["claude-sonnet-4.5"];
        let s_req = sonnet.requests.as_ref().unwrap();
        assert_eq!(s_req.count, Some(30)); // 20 + 10
        assert_eq!(s_req.cost, Some(7.5)); // 5.0 + 2.5
        let s_usg = sonnet.usage.as_ref().unwrap();
        assert_eq!(s_usg.input_tokens, Some(1500)); // 1000 + 500
        assert_eq!(s_usg.output_tokens, Some(750)); // 500 + 250
        assert_eq!(s_usg.cache_read_tokens, Some(1200)); // 800 + 400
        assert_eq!(s_usg.cache_write_tokens, Some(150)); // 100 + 50

        // claude-opus-4.6: only from second shutdown
        let opus = &metrics["claude-opus-4.6"];
        let o_req = opus.requests.as_ref().unwrap();
        assert_eq!(o_req.count, Some(8));
        assert_eq!(o_req.cost, Some(4.0));
        let o_usg = opus.usage.as_ref().unwrap();
        assert_eq!(o_usg.input_tokens, Some(2000));
        assert_eq!(o_usg.output_tokens, Some(1000));
        assert_eq!(o_usg.cache_read_tokens, Some(1500));
        assert_eq!(o_usg.cache_write_tokens, Some(200));
    }

    // ── Incremental parser tests ─────────────────────────────────────

    #[test]
    fn test_incremental_parse_from_zero() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample_file(&dir);
        let result = parse_events_jsonl_from_offset(&path, 0).unwrap();
        assert_eq!(result.events.len(), 8);
        assert_eq!(result.malformed_lines, 0);
        assert!(result.new_byte_offset > 0);
    }

    #[test]
    fn test_incremental_parse_appended_events() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");

        // Write initial events
        let initial = concat!(
            r#"{"type":"user.message","data":{"content":"Hello"},"id":"e1","timestamp":"2026-03-10T07:14:51.000Z","parentId":null}"#,
            "\n",
        );
        std::fs::write(&path, initial).unwrap();
        let initial_len = initial.len() as u64;

        // Parse from 0 to get baseline
        let result = parse_events_jsonl_from_offset(&path, 0).unwrap();
        assert_eq!(result.events.len(), 1);
        assert_eq!(result.new_byte_offset, initial_len);

        // Append a new event
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        let appended = r#"{"type":"assistant.message","data":{"content":"Hi!"},"id":"e2","timestamp":"2026-03-10T07:14:52.000Z","parentId":"e1"}"#;
        writeln!(f, "{}", appended).unwrap();

        // Parse from the saved offset — should only see the new event
        let result2 = parse_events_jsonl_from_offset(&path, initial_len).unwrap();
        assert_eq!(result2.events.len(), 1);
        assert_eq!(result2.events[0].event_type, "assistant.message");
        assert!(result2.new_byte_offset > initial_len);
    }

    #[test]
    fn test_incremental_parse_no_new_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        let content = r#"{"type":"user.message","data":{"content":"Hello"},"id":"e1","timestamp":"2026-03-10T07:14:51.000Z","parentId":null}"#.to_string() + "\n";
        std::fs::write(&path, &content).unwrap();

        let offset = content.len() as u64;
        let result = parse_events_jsonl_from_offset(&path, offset).unwrap();
        assert!(result.events.is_empty());
        assert_eq!(result.new_byte_offset, offset);
    }

    #[test]
    fn test_incremental_parse_truncated_file_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        std::fs::write(&path, "short\n").unwrap();

        // Offset beyond file size should return error
        let result = parse_events_jsonl_from_offset(&path, 999);
        assert!(result.is_err());
    }

    #[test]
    fn test_incremental_parse_partial_line_safety() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");

        // Write a complete line followed by a partial line (no trailing \n)
        let complete = r#"{"type":"user.message","data":{"content":"Hello"},"id":"e1","timestamp":"2026-03-10T07:14:51.000Z","parentId":null}"#.to_string() + "\n";
        let partial = r#"{"type":"assistant.message","data":{"content":"Hi!"},"id":"e2"}"#;
        let content = format!("{}{}", complete, partial);
        std::fs::write(&path, &content).unwrap();

        let result = parse_events_jsonl_from_offset(&path, 0).unwrap();
        // Should only parse the complete line, not the partial one
        assert_eq!(result.events.len(), 1);
        assert_eq!(result.new_byte_offset, complete.len() as u64);
    }
}
