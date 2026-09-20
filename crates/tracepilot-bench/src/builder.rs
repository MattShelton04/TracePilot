use crate::events::{build_session_events, events_to_jsonl};
use crate::workspace::make_workspace_yaml;
use serde_json::Value;
use std::path::PathBuf;
use tempfile::TempDir;

const DEFAULT_FIXTURE_SESSION_ID: &str = "7ace0000-0000-4000-8000-000000000000";

/// Stable, valid UUID used for benchmark session directories and event identity.
pub(crate) fn fixture_session_id(index: usize) -> String {
    const BASE: u128 = 0x7ace_0000_0000_4000_8000_0000_0000_0000;
    uuid::Uuid::from_u128(BASE + index as u128).to_string()
}

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
        self.build_events_for(DEFAULT_FIXTURE_SESSION_ID)
    }

    /// Generate raw JSON event values for a specific session UUID.
    pub fn build_events_for(&self, session_id: &str) -> Vec<Value> {
        build_session_events(session_id, self.turn_count, self.tool_call_count)
    }

    /// Generate events as a JSONL string.
    pub fn build_jsonl_string(&self) -> String {
        events_to_jsonl(&self.build_events())
    }

    /// Generate events as JSONL with `session.start.data.sessionId` matching the directory UUID.
    pub fn build_jsonl_string_for(&self, session_id: &str) -> String {
        events_to_jsonl(&self.build_events_for(session_id))
    }

    /// Write a complete session directory to a temp dir.
    ///
    /// Returns `(TempDir, session_dir_path)`. The `TempDir` guard must be kept
    /// alive for as long as the files are needed.
    pub fn build_session_dir(&self) -> (TempDir, PathBuf) {
        let dir = TempDir::new().expect("failed to create temp dir");
        let session_id = DEFAULT_FIXTURE_SESSION_ID;
        let session_dir = dir.path().join(session_id);
        std::fs::create_dir_all(&session_dir).expect("failed to create session dir");

        std::fs::write(
            session_dir.join("workspace.yaml"),
            make_workspace_yaml(session_id, 0),
        )
        .expect("failed to write workspace.yaml");

        std::fs::write(
            session_dir.join("events.jsonl"),
            self.build_jsonl_string_for(session_id),
        )
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
    build_session_events(DEFAULT_FIXTURE_SESSION_ID, turns, tool_calls)
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
        let session_id = fixture_session_id(i);
        let session_dir = sessions_dir.join(&session_id);
        std::fs::create_dir_all(&session_dir).unwrap();

        std::fs::write(
            session_dir.join("workspace.yaml"),
            make_workspace_yaml(&session_id, i),
        )
        .unwrap();

        let events = build_session_events(&session_id, turns, tool_calls);
        std::fs::write(session_dir.join("events.jsonl"), events_to_jsonl(&events)).unwrap();
    }

    (dir, sessions_dir)
}

#[cfg(test)]
mod tests {
    use super::create_multi_session_fixture;

    #[test]
    fn generated_multi_session_fixture_is_discoverable() {
        let (_guard, sessions_dir) = create_multi_session_fixture(3, 50);
        let discovered = tracepilot_core::session::discovery::discover_sessions(&sessions_dir)
            .expect("discover benchmark sessions");
        assert_eq!(discovered.len(), 3);
    }

    #[test]
    fn generated_fixture_indexes_real_sessions_and_search_content() {
        let (_guard, sessions_dir) = create_multi_session_fixture(3, 50);
        let db_dir = tempfile::tempdir().expect("create db tempdir");
        let db_path = db_dir.path().join("index.db");

        let indexed = tracepilot_indexer::reindex_all(&sessions_dir, &db_path)
            .expect("index benchmark sessions");
        assert_eq!(indexed, 3);

        let (search_indexed, skipped) =
            tracepilot_indexer::reindex_search_content(&sessions_dir, &db_path, |_| {}, || false)
                .expect("index benchmark search content");
        assert_eq!((search_indexed, skipped), (3, 0));

        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&db_path)
            .expect("open benchmark index");
        assert_eq!(db.session_count().expect("count indexed sessions"), 3);
        let matches = db
            .query_content(
                Some("refactor"),
                &tracepilot_indexer::SearchFilters::default(),
            )
            .expect("search benchmark content");
        assert!(!matches.is_empty());
    }
}
