use crate::events::{build_session_events, events_to_jsonl};
use crate::workspace::make_workspace_yaml;
use tempfile::TempDir;

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
        let parsed =
            tracepilot_core::parsing::events::parse_typed_events(&session_dir.join("events.jsonl"))
                .expect("parse events");
        let turns = tracepilot_core::turns::reconstruct_turns(&parsed.events);

        inputs.push(tracepilot_core::analytics::SessionAnalyticsInput {
            summary,
            turns: Some(turns),
        });
    }

    (inputs, dir)
}
