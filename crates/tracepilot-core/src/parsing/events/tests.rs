//! Tests for the `events` parsing pipeline.

use super::aggregate::{extract_combined_shutdown_data, extract_session_start};
use super::raw::parse_events_jsonl;
use super::typed::{TypedEventData, parse_typed_events, parse_typed_events_if_exists};
use crate::models::event_types::SessionEventType;
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
fn test_parse_typed_events_if_exists_returns_none_for_missing_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    assert!(!path.exists());
    let parsed = parse_typed_events_if_exists(&path).unwrap();
    assert!(parsed.is_none());
}

#[test]
fn test_parse_typed_events_if_exists_returns_some_for_present_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_sample_file(&dir);
    let parsed = parse_typed_events_if_exists(&path).unwrap().unwrap();
    assert_eq!(parsed.events.len(), 8);
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
fn test_parse_v1_0_40_permission_external_and_compaction_shapes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    let content = concat!(
        r#"{"type":"permission.requested","data":{"requestId":"req-1","permissionRequest":{"kind":"shell","toolCallId":"tc-1","intention":"Run tests"},"promptRequest":{"kind":"commands","toolCallId":"tc-1","intention":"Run tests"}},"id":"evt-1","timestamp":"2026-05-04T08:00:00.000Z","parentId":null}"#,
        "\n",
        r#"{"type":"permission.completed","data":{"requestId":"req-1","toolCallId":"tc-1","result":{"kind":"approved-for-session"}},"id":"evt-2","timestamp":"2026-05-04T08:00:01.000Z","parentId":"evt-1"}"#,
        "\n",
        r#"{"type":"external_tool.requested","data":{"requestId":"req-ext","sessionId":"s1","toolCallId":"tc-ext","toolName":"external-ci","arguments":{"job":"test"},"traceparent":"00-abc-def-01"},"id":"evt-3","timestamp":"2026-05-04T08:00:02.000Z","parentId":null}"#,
        "\n",
        r#"{"type":"session.compaction_complete","data":{"success":true,"compactionTokensUsed":{"inputTokens":100,"outputTokens":20,"cacheReadTokens":5,"cacheWriteTokens":2,"duration":1234,"model":"gpt-5.5","copilotUsage":{"totalNanoAiu":42,"tokenDetails":[{"tokenType":"input","tokenCount":100,"batchSize":1,"costPerBatch":42}]}}},"id":"evt-4","timestamp":"2026-05-04T08:00:03.000Z","parentId":null}"#,
        "\n",
    );
    std::fs::write(&path, content).unwrap();

    let parsed = parse_typed_events(&path).unwrap();

    assert_eq!(parsed.diagnostics.fallback_events, 0);
    assert!(matches!(
        parsed.events[0].typed_data,
        TypedEventData::PermissionRequested(_)
    ));
    assert!(matches!(
        parsed.events[1].typed_data,
        TypedEventData::PermissionCompleted(_)
    ));
    assert!(matches!(
        parsed.events[2].typed_data,
        TypedEventData::ExternalToolRequested(_)
    ));
    let compaction = match &parsed.events[3].typed_data {
        TypedEventData::CompactionComplete(data) => data,
        other => panic!("Expected CompactionComplete, got {other:?}"),
    };
    let usage = compaction.compaction_tokens_used.as_ref().unwrap();
    assert_eq!(usage.input_tokens, Some(100));
    assert_eq!(usage.cache_read_tokens, Some(5));
    assert_eq!(usage.model.as_deref(), Some("gpt-5.5"));
    assert_eq!(
        usage
            .copilot_usage
            .as_ref()
            .and_then(|usage| usage.total_nano_aiu),
        Some(42)
    );
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
#[allow(clippy::vec_init_then_push)]
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

#[test]
fn test_extract_combined_shutdown_no_shutdown_events() {
    // Events with no shutdown — should return None.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    let jsonl = r#"{"type":"session.start","data":{"sessionId":"abc","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"main"}},"id":"evt-1","timestamp":"2026-03-10T07:00:00.000Z","parentId":null}"#;
    std::fs::write(&path, format!("{jsonl}\n")).unwrap();
    let events = parse_typed_events(&path).unwrap().events;
    assert!(
        extract_combined_shutdown_data(&events).is_none(),
        "Expected None when no shutdown events present"
    );
}

#[test]
fn test_extract_combined_shutdown_empty_events() {
    // Empty event slice — should return None.
    assert!(
        extract_combined_shutdown_data(&[]).is_none(),
        "Expected None for empty event slice"
    );
}
