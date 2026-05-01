use crate::events::{build_session_events, events_to_jsonl};
use crate::workspace::make_workspace_yaml;
use serde_json::Value;
use std::path::PathBuf;
use tempfile::TempDir;

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
