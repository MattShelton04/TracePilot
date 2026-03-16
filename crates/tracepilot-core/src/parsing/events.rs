//! Parser for `events.jsonl` — the line-delimited JSON event log.
//!
//! Each line is a JSON object with at minimum: `{ type, data, id, timestamp }`.
//! Events form a tree via `parentId` and are linked by `interactionId`, `toolCallId`, `turnId`.

use crate::error::{Result, TracePilotError};
use crate::models::event_types::{
    AbortData, AssistantMessageData, CodeChanges, CompactionCompleteData, CompactionStartData,
    ModelChangeData, ModelMetricDetail, PlanChangedData, RequestMetrics, SessionErrorData,
    SessionEventType, SessionInfoData, SessionResumeData, SessionStartData, ShutdownData,
    SkillInvokedData, SubagentCompletedData, SubagentFailedData, SubagentStartedData,
    SystemNotificationData, ToolExecCompleteData, ToolExecStartData, ToolUserRequestedData,
    TurnEndData, TurnStartData, UsageMetrics, UserMessageData, WorkspaceFileChangedData,
};
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
    ContextChanged(serde_json::Value),
    WorkspaceFileChanged(WorkspaceFileChangedData),
    ToolUserRequested(ToolUserRequestedData),
    Other(Value),
}

/// Parse all events from an `events.jsonl` file.
/// Uses streaming to handle large files without loading everything into memory.
pub fn parse_events_jsonl(path: &Path) -> Result<Vec<RawEvent>> {
    let file = std::fs::File::open(path).map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to open {}", path.display()),
        source: Some(Box::new(e)),
    })?;
    let reader = BufReader::new(file);
    let mut events = Vec::new();

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
            }
        }
    }

    Ok(events)
}

/// Count events without fully parsing them (fast scan).
pub fn count_events(path: &Path) -> Result<usize> {
    let file = std::fs::File::open(path).map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to open {}", path.display()),
        source: Some(Box::new(e)),
    })?;
    let reader = BufReader::new(file);
    Ok(reader
        .lines()
        .filter(|l| l.as_ref().is_ok_and(|s| !s.trim().is_empty()))
        .count())
}

/// Deserialize the `data` field of a `RawEvent` into the appropriate typed variant.
///
/// Takes `data` by reference. Clones once for `from_value` deserialization;
/// on failure falls back to `Other` using a second clone.
fn typed_data_from_raw(event_type: &SessionEventType, data: &Value) -> TypedEventData {
    match event_type {
        SessionEventType::SessionStart => serde_json::from_value(data.clone())
            .map(TypedEventData::SessionStart)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SessionShutdown => serde_json::from_value(data.clone())
            .map(TypedEventData::SessionShutdown)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::UserMessage => serde_json::from_value(data.clone())
            .map(TypedEventData::UserMessage)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::AssistantMessage => serde_json::from_value(data.clone())
            .map(TypedEventData::AssistantMessage)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::AssistantTurnStart => serde_json::from_value(data.clone())
            .map(TypedEventData::TurnStart)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::AssistantTurnEnd => serde_json::from_value(data.clone())
            .map(TypedEventData::TurnEnd)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::ToolExecutionStart => serde_json::from_value(data.clone())
            .map(TypedEventData::ToolExecutionStart)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::ToolExecutionComplete => serde_json::from_value(data.clone())
            .map(TypedEventData::ToolExecutionComplete)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SubagentStarted => serde_json::from_value(data.clone())
            .map(TypedEventData::SubagentStarted)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SubagentCompleted => serde_json::from_value(data.clone())
            .map(TypedEventData::SubagentCompleted)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SubagentFailed => serde_json::from_value(data.clone())
            .map(TypedEventData::SubagentFailed)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SessionCompactionComplete => serde_json::from_value(data.clone())
            .map(TypedEventData::CompactionComplete)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SessionCompactionStart => serde_json::from_value(data.clone())
            .map(TypedEventData::CompactionStart)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SessionModelChange => serde_json::from_value(data.clone())
            .map(TypedEventData::ModelChange)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SessionError => serde_json::from_value(data.clone())
            .map(TypedEventData::SessionError)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SessionResume => serde_json::from_value(data.clone())
            .map(TypedEventData::SessionResume)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SystemNotification => serde_json::from_value(data.clone())
            .map(TypedEventData::SystemNotification)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SkillInvoked => serde_json::from_value(data.clone())
            .map(TypedEventData::SkillInvoked)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::Abort => serde_json::from_value(data.clone())
            .map(TypedEventData::Abort)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SessionPlanChanged => serde_json::from_value(data.clone())
            .map(TypedEventData::PlanChanged)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SessionInfo => serde_json::from_value(data.clone())
            .map(TypedEventData::SessionInfo)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::SessionContextChanged => {
            // Reuses SessionContext — just store raw Value since it's the same shape
            TypedEventData::ContextChanged(data.clone())
        }
        SessionEventType::SessionWorkspaceFileChanged => serde_json::from_value(data.clone())
            .map(TypedEventData::WorkspaceFileChanged)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        SessionEventType::ToolUserRequested => serde_json::from_value(data.clone())
            .map(TypedEventData::ToolUserRequested)
            .unwrap_or_else(|_| TypedEventData::Other(data.clone())),
        _ => TypedEventData::Other(data.clone()),
    }
}

/// Parse events.jsonl into fully typed events.
///
/// Reads the file line-by-line, parses each `RawEvent`, converts the string
/// event type into `SessionEventType`, and deserializes data into the matching
/// typed struct — falling back to `TypedEventData::Other` on failure.
pub fn parse_typed_events(path: &Path) -> Result<Vec<TypedEvent>> {
    let raw_events = parse_events_jsonl(path)?;
    let typed = raw_events
        .into_iter()
        .map(|raw| {
            let event_type = SessionEventType::from(raw.event_type.as_str());
            let typed_data = typed_data_from_raw(&event_type, &raw.data);
            TypedEvent {
                raw,
                event_type,
                typed_data,
            }
        })
        .collect();
    Ok(typed)
}

/// Extract shutdown data from the LAST `session.shutdown` event.
#[deprecated(note = "Use extract_combined_shutdown_data to correctly sum metrics across resumed sessions")]
pub fn extract_shutdown_data(events: &[TypedEvent]) -> Option<ShutdownData> {
    events
        .iter()
        .rev()
        .find(|e| e.event_type == SessionEventType::SessionShutdown)
        .and_then(|e| match &e.typed_data {
            TypedEventData::SessionShutdown(d) => Some(d.clone()),
            _ => None,
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
        let events = parse_events_jsonl(&path).unwrap();
        assert_eq!(events.len(), 8);
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
        let events = parse_typed_events(&path).unwrap();
        assert_eq!(events.len(), 8);

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
        let events = parse_typed_events(&path).unwrap();
        #[allow(deprecated)]
        let shutdown = extract_shutdown_data(&events);
        assert!(shutdown.is_some());
        let sd = shutdown.unwrap();
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
        let events = parse_typed_events(&path).unwrap();
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
        let events = parse_events_jsonl(&path).unwrap();
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn test_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("events.jsonl");
        std::fs::write(&path, "").unwrap();
        let events = parse_events_jsonl(&path).unwrap();
        assert!(events.is_empty());

        let typed = parse_typed_events(&path).unwrap();
        assert!(typed.is_empty());
    }

    // ── Combined shutdown tests ──────────────────────────────────────

    #[test]
    fn test_extract_combined_shutdown_single() {
        let dir = tempfile::tempdir().unwrap();
        let path = write_sample_file(&dir);
        let events = parse_typed_events(&path).unwrap();
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
        let events = parse_typed_events(&path).unwrap();
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
        let events = parse_typed_events(&path).unwrap();
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
        let events = parse_typed_events(&path).unwrap();
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
}
