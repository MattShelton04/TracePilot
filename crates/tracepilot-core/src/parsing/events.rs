//! Parser for `events.jsonl` — the line-delimited JSON event log.
//!
//! Each line is a JSON object with at minimum: `{ type, data, id, timestamp }`.
//! Events form a tree via `parentId` and are linked by `interactionId`, `toolCallId`, `turnId`.

use crate::error::{Result, TracePilotError};
use crate::models::event_types::{
    AssistantMessageData, SessionEventType, SessionStartData, ShutdownData, SubagentCompletedData,
    SubagentFailedData, SubagentStartedData, ToolExecCompleteData, ToolExecStartData,
    TurnEndData, TurnStartData, UserMessageData,
};
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
            r#"{"type":"session.start","data":{"sessionId":"abc-123","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"main"}},"id":"evt-1","timestamp":"2026-03-10T07:14:50.780Z","parentId":null}"#, "\n",
            r#"{"type":"user.message","data":{"content":"Hello world","interactionId":"int-1","attachments":[]},"id":"evt-2","timestamp":"2026-03-10T07:14:51.000Z","parentId":"evt-1"}"#, "\n",
            r#"{"type":"assistant.turn_start","data":{"turnId":"turn-1","interactionId":"int-1"},"id":"evt-3","timestamp":"2026-03-10T07:14:51.100Z","parentId":"evt-2"}"#, "\n",
            r#"{"type":"assistant.message","data":{"messageId":"msg-1","content":"Hi there!","interactionId":"int-1"},"id":"evt-4","timestamp":"2026-03-10T07:14:52.000Z","parentId":"evt-3"}"#, "\n",
            r#"{"type":"tool.execution_start","data":{"toolCallId":"tc-1","toolName":"read_file","arguments":{"path":"/test/foo.rs"}},"id":"evt-5","timestamp":"2026-03-10T07:14:52.100Z","parentId":"evt-4"}"#, "\n",
            r#"{"type":"tool.execution_complete","data":{"toolCallId":"tc-1","model":"claude-opus-4.6","interactionId":"int-1","success":true,"result":"file contents"},"id":"evt-6","timestamp":"2026-03-10T07:14:52.500Z","parentId":"evt-5"}"#, "\n",
            r#"{"type":"assistant.turn_end","data":{"turnId":"turn-1"},"id":"evt-7","timestamp":"2026-03-10T07:14:53.000Z","parentId":"evt-3"}"#, "\n",
            r#"{"type":"session.shutdown","data":{"shutdownType":"routine","totalPremiumRequests":1,"totalApiDurationMs":5000,"sessionStartTime":1773270552854,"currentModel":"claude-opus-4.6","codeChanges":{"linesAdded":10,"linesRemoved":2,"filesModified":["/test/foo.rs"]},"modelMetrics":{"claude-opus-4.6":{"requests":{"count":3,"cost":1},"usage":{"inputTokens":1000,"outputTokens":500,"cacheReadTokens":800,"cacheWriteTokens":0}}}},"id":"evt-8","timestamp":"2026-03-10T07:15:00.000Z","parentId":null}"#, "\n",
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
        assert_eq!(events[5].event_type, SessionEventType::ToolExecutionComplete);
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
            r#"{"type":"session.start","data":{"sessionId":"abc"},"id":"e1","timestamp":"2026-03-10T07:14:50.780Z","parentId":null}"#, "\n",
            "NOT VALID JSON\n",
            r#"{"type":"user.message","data":{"content":"hi"},"id":"e2","timestamp":"2026-03-10T07:14:51.000Z","parentId":"e1"}"#, "\n",
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
}
