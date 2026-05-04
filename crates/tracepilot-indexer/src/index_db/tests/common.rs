//! Shared fixture builders for the `index_db` test suite.

use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn write_session(
    root: &Path,
    session_id: &str,
    summary: &str,
    repo: &str,
    branch: &str,
    user_message: &str,
    assistant_message: &str,
) -> PathBuf {
    let session_dir = root.join(session_id);
    fs::create_dir_all(&session_dir).unwrap();
    fs::write(
        session_dir.join("workspace.yaml"),
        format!(
            r#"id: {session_id}
summary: "{summary}"
repository: "{repo}"
branch: "{branch}"
cwd: 'C:\test\{session_id}'
host_type: cli
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#
        ),
    )
    .unwrap();
    fs::write(
        session_dir.join("events.jsonl"),
        format!(
            "{{\"type\":\"user.message\",\"data\":{{\"content\":\"{}\",\"interactionId\":\"int-1\"}},\"id\":\"evt-1\",\"timestamp\":\"2026-03-10T07:14:51.000Z\",\"parentId\":null}}\n\
             {{\"type\":\"assistant.message\",\"data\":{{\"messageId\":\"msg-1\",\"content\":\"{}\",\"interactionId\":\"int-1\"}},\"id\":\"evt-2\",\"timestamp\":\"2026-03-10T07:14:52.000Z\",\"parentId\":\"evt-1\"}}\n",
            user_message, assistant_message
        ),
    )
    .unwrap();
    session_dir
}

/// Write a session with tool execution events for analytics testing.
pub(super) fn write_session_with_tools(
    root: &Path,
    session_id: &str,
    repo: &str,
    updated_at: &str,
) -> PathBuf {
    let session_dir = root.join(session_id);
    fs::create_dir_all(&session_dir).unwrap();
    fs::write(
        session_dir.join("workspace.yaml"),
        format!(
            r#"id: {session_id}
summary: "Session with tools"
repository: "{repo}"
branch: "main"
cwd: 'C:\test\{session_id}'
host_type: cli
created_at: "2026-03-10T07:14:50Z"
updated_at: "{updated_at}"
"#
        ),
    )
    .unwrap();
    // Events with tool.execution_start → tool.execution_complete pairs + shutdown
    fs::write(
        session_dir.join("events.jsonl"),
        concat!(
            r#"{"type":"user.message","data":{"content":"please read the file","interactionId":"int-1"},"id":"evt-1","timestamp":"2026-03-10T07:14:51.000Z","parentId":null}"#, "\n",
            r#"{"type":"assistant.message","data":{"messageId":"msg-1","content":"I'll read it","interactionId":"int-1"},"id":"evt-2","timestamp":"2026-03-10T07:14:52.000Z","parentId":"evt-1"}"#, "\n",
            r#"{"type":"tool.execution_start","data":{"toolCallId":"tc-1","toolName":"read_file","arguments":{"path":"/test/foo.rs"}},"id":"evt-3","timestamp":"2026-03-10T07:14:53.000Z","parentId":"evt-2"}"#, "\n",
            r#"{"type":"tool.execution_complete","data":{"toolCallId":"tc-1","success":true,"output":"file contents"},"id":"evt-4","timestamp":"2026-03-10T07:14:54.000Z","parentId":"evt-3"}"#, "\n",
            r#"{"type":"tool.execution_start","data":{"toolCallId":"tc-2","toolName":"edit_file","arguments":{"path":"/test/bar.rs"}},"id":"evt-5","timestamp":"2026-03-10T07:14:55.000Z","parentId":"evt-2"}"#, "\n",
            r#"{"type":"tool.execution_complete","data":{"toolCallId":"tc-2","success":false,"output":"permission denied"},"id":"evt-6","timestamp":"2026-03-10T07:14:56.000Z","parentId":"evt-5"}"#, "\n",
            r#"{"type":"session.shutdown","data":{"shutdownType":"routine","totalPremiumRequests":1,"totalApiDurationMs":5000,"sessionStartTime":1773308090000,"currentModel":"claude-opus-4.6","modelMetrics":{"claude-opus-4.6":{"requests":{"count":2,"cost":0.5},"usage":{"inputTokens":500,"outputTokens":200}}}},"id":"evt-7","timestamp":"2026-03-10T07:15:00.000Z","parentId":null}"#, "\n",
        ),
    )
    .unwrap();
    session_dir
}

/// Write a session with incident-generating events (errors, compaction, truncation).
pub(super) fn write_session_with_incidents(root: &Path, session_id: &str) -> PathBuf {
    let session_dir = root.join(session_id);
    fs::create_dir_all(&session_dir).unwrap();
    fs::write(
        session_dir.join("workspace.yaml"),
        format!(
            r#"id: {session_id}
summary: "Session with incidents"
repository: "org/repo"
branch: "main"
cwd: 'C:\test\{session_id}'
host_type: cli
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#
        ),
    )
    .unwrap();
    fs::write(
        session_dir.join("events.jsonl"),
        concat!(
            r#"{"type":"user.message","data":{"content":"hello","interactionId":"int-1"},"id":"evt-1","timestamp":"2026-03-10T07:14:51.000Z","parentId":null}"#, "\n",
            r#"{"type":"session.error","data":{"errorType":"rate_limit","message":"Rate limit exceeded","statusCode":429},"id":"evt-2","timestamp":"2026-03-10T07:14:52.000Z","parentId":null}"#, "\n",
            r#"{"type":"session.error","data":{"errorType":"api_error","message":"Internal server error","statusCode":500},"id":"evt-3","timestamp":"2026-03-10T07:14:53.000Z","parentId":null}"#, "\n",
            r#"{"type":"session.compaction_complete","data":{"preCompactionTokens":50000,"success":true,"checkpointNumber":1,"compactionTokensUsed":{"inputTokens":2000,"outputTokens":1000,"cacheReadTokens":250,"cacheWriteTokens":50,"duration":1200,"model":"gpt-5.5"}},"id":"evt-4","timestamp":"2026-03-10T07:14:54.000Z","parentId":null}"#, "\n",
            r#"{"type":"session.truncation","data":{"tokensRemovedDuringTruncation":5000,"messagesRemovedDuringTruncation":3,"performedBy":"BasicTruncator","tokenLimit":100000},"id":"evt-5","timestamp":"2026-03-10T07:14:55.000Z","parentId":null}"#, "\n",
            r#"{"type":"assistant.message","data":{"messageId":"msg-1","content":"hi","interactionId":"int-1"},"id":"evt-6","timestamp":"2026-03-10T07:14:56.000Z","parentId":"evt-1"}"#, "\n",
        ),
    )
    .unwrap();
    session_dir
}
