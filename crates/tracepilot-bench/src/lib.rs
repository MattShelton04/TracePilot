//! Synthetic data generators and benchmarking utilities for TracePilot.
//!
//! Provides deterministic, configurable session fixtures for Criterion benchmarks.

use chrono::{DateTime, Duration, Utc};
use serde_json::{Value, json};
use std::path::PathBuf;
use tempfile::TempDir;

/// Tool names rotated through when generating tool call events.
const TOOL_NAMES: &[&str] = &[
    "read_file",
    "edit_file",
    "grep",
    "glob",
    "powershell",
    "view",
    "create",
    "web_search",
    "task",
    "write_powershell",
];

/// Models rotated through for session metadata.
const MODELS: &[&str] = &[
    "claude-sonnet-4-20250514",
    "claude-haiku-4-20250514",
    "gpt-4.1",
];

fn base_time() -> DateTime<Utc> {
    "2025-01-01T00:00:00Z".parse().unwrap()
}

fn make_timestamp(base: DateTime<Utc>, offset_secs: i64) -> String {
    (base + Duration::seconds(offset_secs)).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn events_to_jsonl(events: &[Value]) -> String {
    events
        .iter()
        .map(|e| serde_json::to_string(e).expect("failed to serialize event"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn make_workspace_yaml(session_id: &str, day_offset: usize) -> String {
    let day = (day_offset % 28) + 1;
    format!(
        "id: {session_id}\n\
         cwd: /bench/project\n\
         repository: github.com/bench/project\n\
         branch: main\n\
         host_type: cli\n\
         created_at: \"2025-01-{day:02}T00:00:00Z\"\n\
         updated_at: \"2025-01-{day:02}T01:00:00Z\"\n"
    )
}

/// Generate a sequence of realistic session events.
///
/// Produces a deterministic stream following real Copilot CLI event patterns:
/// `session.start` → N×(user.message, turn_start, assistant.message, tools…, turn_end) → `session.shutdown`.
fn build_session_events(turn_count: usize, tool_call_count: usize) -> Vec<Value> {
    let base = base_time();
    let mut events = Vec::new();
    let mut ts_offset: i64 = 0;
    let mut event_id: usize = 0;

    let mut next = |ts: &mut i64| -> (String, String) {
        event_id += 1;
        *ts += 1;
        (format!("e{event_id}"), make_timestamp(base, *ts))
    };

    // session.start
    let (id, ts) = next(&mut ts_offset);
    events.push(json!({
        "type": "session.start",
        "data": {
            "sessionId": "bench-session-0001",
            "version": "1.0",
            "producer": "copilot-cli",
            "context": {
                "cwd": "/bench/project",
                "branch": "main",
                "repository": "github.com/bench/project",
                "hostType": "cli"
            }
        },
        "id": id,
        "timestamp": ts
    }));

    // Distribute tool calls across turns
    let tools_per_turn = if turn_count > 0 {
        tool_call_count / turn_count
    } else {
        0
    };
    let extra_tools = if turn_count > 0 {
        tool_call_count % turn_count
    } else {
        0
    };

    for turn_idx in 0..turn_count {
        let turn_id = format!("turn-{turn_idx}");
        let interaction_id = format!("interaction-{turn_idx}");

        // user.message
        let (id, ts) = next(&mut ts_offset);
        events.push(json!({
            "type": "user.message",
            "data": {
                "content": format!("Refactor module {turn_idx} to improve error handling and add tests"),
                "interactionId": interaction_id
            },
            "id": id,
            "timestamp": ts
        }));

        // assistant.turn_start
        let (id, ts) = next(&mut ts_offset);
        events.push(json!({
            "type": "assistant.turn_start",
            "data": {
                "turnId": turn_id,
                "interactionId": interaction_id
            },
            "id": id,
            "timestamp": ts
        }));

        // assistant.message
        let (id, ts) = next(&mut ts_offset);
        events.push(json!({
            "type": "assistant.message",
            "data": {
                "content": format!(
                    "I'll help you refactor module {turn_idx}. Let me read the relevant files first."
                ),
                "messageId": format!("msg-{turn_idx}"),
                "interactionId": interaction_id,
                "turnId": turn_id
            },
            "id": id,
            "timestamp": ts
        }));

        // Tool calls for this turn
        let num_tools = tools_per_turn + if turn_idx < extra_tools { 1 } else { 0 };
        for tc_idx in 0..num_tools {
            let tool_name = TOOL_NAMES[(turn_idx + tc_idx) % TOOL_NAMES.len()];
            let tool_call_id = format!("tc-{turn_idx}-{tc_idx}");

            // tool.execution_start
            let (id, ts) = next(&mut ts_offset);
            events.push(json!({
                "type": "tool.execution_start",
                "data": {
                    "toolName": tool_name,
                    "toolCallId": tool_call_id,
                    "turnId": turn_id,
                    "arguments": {
                        "path": format!("src/module_{turn_idx}/file_{tc_idx}.rs")
                    }
                },
                "id": id,
                "timestamp": ts
            }));

            // tool.execution_complete
            let (id, ts) = next(&mut ts_offset);
            events.push(json!({
                "type": "tool.execution_complete",
                "data": {
                    "toolCallId": tool_call_id,
                    "result": format!("Tool {tool_name} completed successfully for {tool_call_id}"),
                    "success": true,
                    "turnId": turn_id,
                    "interactionId": interaction_id
                },
                "id": id,
                "timestamp": ts
            }));
        }

        // assistant.turn_end
        let (id, ts) = next(&mut ts_offset);
        events.push(json!({
            "type": "assistant.turn_end",
            "data": {
                "turnId": turn_id,
                "interactionId": interaction_id
            },
            "id": id,
            "timestamp": ts
        }));
    }

    // session.shutdown with model metrics
    let total_input = (turn_count.max(1) * 600) as u64;
    let total_output = (turn_count.max(1) * 400) as u64;
    let model_name = MODELS[0].to_string();
    let mut model_metrics_map = serde_json::Map::new();
    model_metrics_map.insert(
        model_name.clone(),
        json!({
            "requests": {
                "count": turn_count,
                "cost": turn_count as f64 * 0.15
            },
            "usage": {
                "inputTokens": total_input,
                "outputTokens": total_output,
                "cacheReadTokens": total_input / 2,
                "cacheWriteTokens": 0u64
            }
        }),
    );

    let files_modified: Vec<String> = (0..turn_count.min(5))
        .map(|i| format!("src/file_{i}.rs"))
        .collect();

    let (id, ts) = next(&mut ts_offset);
    events.push(json!({
        "type": "session.shutdown",
        "data": {
            "shutdownType": "routine",
            "totalPremiumRequests": turn_count as f64,
            "totalApiDurationMs": ts_offset as u64 * 1000,
            "sessionStartTime": base.timestamp_millis(),
            "currentModel": model_name,
            "codeChanges": {
                "linesAdded": turn_count * 10,
                "linesRemoved": turn_count * 3,
                "filesModified": files_modified
            },
            "modelMetrics": Value::Object(model_metrics_map)
        },
        "id": id,
        "timestamp": ts
    }));

    events
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Builder for generating synthetic session data at configurable scales.
///
/// Uses a deterministic sequence (no randomness) so benchmark results are reproducible.
pub struct SessionFixtureBuilder {
    turn_count: usize,
    tool_call_count: usize,
}

impl SessionFixtureBuilder {
    pub fn new() -> Self {
        Self {
            turn_count: 10,
            tool_call_count: 20,
        }
    }

    /// Set a target event count. Derives `turn_count` and `tool_call_count` to
    /// approximate this many events (≈8 events per turn with 2 tool calls each).
    pub fn event_count(mut self, n: usize) -> Self {
        let turns = (n.saturating_sub(2) / 8).max(1);
        self.turn_count = turns;
        self.tool_call_count = turns * 2;
        self
    }

    pub fn turn_count(mut self, n: usize) -> Self {
        self.turn_count = n;
        self
    }

    pub fn tool_call_count(mut self, n: usize) -> Self {
        self.tool_call_count = n;
        self
    }

    /// Generate raw JSON event values following a realistic session pattern.
    pub fn build_events(&self) -> Vec<Value> {
        build_session_events(self.turn_count, self.tool_call_count)
    }

    /// Generate events as a JSONL string.
    pub fn build_jsonl_string(&self) -> String {
        events_to_jsonl(&self.build_events())
    }

    /// Write a complete session directory to a temp dir.
    ///
    /// Returns `(TempDir, session_dir_path)`. The `TempDir` guard must be kept
    /// alive for as long as the files are needed.
    pub fn build_session_dir(&self) -> (TempDir, PathBuf) {
        let dir = TempDir::new().expect("failed to create temp dir");
        let session_dir = dir.path().join("session-bench-0001");
        std::fs::create_dir_all(&session_dir).expect("failed to create session dir");

        std::fs::write(
            session_dir.join("workspace.yaml"),
            make_workspace_yaml("bench-session-0001", 0),
        )
        .expect("failed to write workspace.yaml");

        std::fs::write(session_dir.join("events.jsonl"), self.build_jsonl_string())
            .expect("failed to write events.jsonl");

        (dir, session_dir)
    }
}

impl Default for SessionFixtureBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Generate approximately `event_count` raw JSON event values.
pub fn generate_raw_events(event_count: usize) -> Vec<Value> {
    let turns = (event_count.saturating_sub(2) / 8).max(1);
    let tool_calls = turns * 2;
    build_session_events(turns, tool_calls)
}

/// Generate approximately `event_count` events as a JSONL string.
pub fn generate_events_jsonl_string(event_count: usize) -> String {
    events_to_jsonl(&generate_raw_events(event_count))
}

/// Create a single session directory on disk with the given parameters.
///
/// Returns `(TempDir, session_dir_path)`.
pub fn create_session_fixture(
    _event_count: usize,
    turn_count: usize,
    tool_call_count: usize,
) -> (TempDir, PathBuf) {
    SessionFixtureBuilder::new()
        .turn_count(turn_count)
        .tool_call_count(tool_call_count)
        .build_session_dir()
}

/// Create multiple session directories under a single temp dir.
///
/// Returns `(TempDir, sessions_parent_dir)` where each session is a subdirectory.
pub fn create_multi_session_fixture(
    session_count: usize,
    events_per_session: usize,
) -> (TempDir, PathBuf) {
    let dir = TempDir::new().expect("failed to create temp dir");
    let sessions_dir = dir.path().to_path_buf();

    let turns = (events_per_session.saturating_sub(2) / 8).max(1);
    let tool_calls = turns * 2;

    for i in 0..session_count {
        let session_id = format!("session-{i:04}");
        let session_dir = sessions_dir.join(&session_id);
        std::fs::create_dir_all(&session_dir).unwrap();

        std::fs::write(
            session_dir.join("workspace.yaml"),
            make_workspace_yaml(&session_id, i),
        )
        .unwrap();

        let events = build_session_events(turns, tool_calls);
        std::fs::write(session_dir.join("events.jsonl"), events_to_jsonl(&events)).unwrap();
    }

    (dir, sessions_dir)
}

/// Generate pre-loaded `SessionAnalyticsInput` values for analytics benchmarks.
///
/// Creates session directories, loads summaries and reconstructs turns from each.
/// The returned `TempDir` must be kept alive (data is fully in-memory once loaded,
/// but the guard prevents premature cleanup during long benchmark runs).
pub fn generate_analytics_inputs(
    session_count: usize,
    turns_per_session: usize,
    tool_calls_per_turn: usize,
) -> (
    Vec<tracepilot_core::analytics::SessionAnalyticsInput>,
    TempDir,
) {
    let dir = TempDir::new().expect("failed to create temp dir");
    let mut inputs = Vec::with_capacity(session_count);

    for i in 0..session_count {
        let session_id = format!("bench-analytics-{i:04}");
        let session_dir = dir.path().join(&session_id);
        std::fs::create_dir_all(&session_dir).unwrap();

        let tool_calls_total = turns_per_session * tool_calls_per_turn;
        let events = build_session_events(turns_per_session, tool_calls_total);

        std::fs::write(
            session_dir.join("workspace.yaml"),
            make_workspace_yaml(&session_id, i),
        )
        .unwrap();
        std::fs::write(session_dir.join("events.jsonl"), events_to_jsonl(&events)).unwrap();

        let summary =
            tracepilot_core::summary::load_session_summary(&session_dir).expect("load summary");
        let parsed = tracepilot_core::parsing::events::parse_typed_events(
            &session_dir.join("events.jsonl"),
        )
        .expect("parse events");
        let turns = tracepilot_core::turns::reconstruct_turns(&parsed.events);

        inputs.push(tracepilot_core::analytics::SessionAnalyticsInput {
            summary,
            turns: Some(turns),
        });
    }

    (inputs, dir)
}
