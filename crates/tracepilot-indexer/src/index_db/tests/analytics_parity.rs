//! Compare persisted analytics with the disk fallback on the same session data.

use std::path::{Path, PathBuf};

use serde_json::{Value, json};
use tracepilot_core::analytics::{
    compute_analytics, compute_tool_analysis, load_full_sessions_filtered,
};
use tracepilot_core::ids::SessionId;

use super::common::write_session_with_tools;
use crate::index_db::IndexDb;

const ID: &str = "11111111-1111-4111-8111-111111111111";

fn event(kind: &str, data: Value, id: &str, timestamp: Option<&str>) -> Value {
    json!({"type": kind, "data": data, "id": id, "timestamp": timestamp})
}

fn start(id: Option<&str>, name: &str, timestamp: Option<&str>) -> Value {
    event(
        "tool.execution_start",
        json!({"toolCallId": id, "toolName": name}),
        "start",
        timestamp,
    )
}

fn complete(id: &str, success: Option<bool>, timestamp: Option<&str>) -> Value {
    event(
        "tool.execution_complete",
        json!({"toolCallId": id, "success": success}),
        "complete",
        timestamp,
    )
}

fn write_events(root: &Path, events: Vec<Value>, updated_at: &str) -> PathBuf {
    let path = write_session_with_tools(root, ID, "org/repo", updated_at);
    let mut all = vec![event(
        "user.message",
        json!({"content": "Run tools", "interactionId": "int-1"}),
        "user",
        Some("2026-03-10T07:14:51Z"),
    )];
    all.extend(events);
    std::fs::write(
        path.join("events.jsonl"),
        tracepilot_core::parsing::events::events_to_jsonl(&all),
    )
    .unwrap();
    path
}

fn assert_tool_parity(events: Vec<Value>, expected_calls: u32) -> Value {
    let temp = tempfile::tempdir().unwrap();
    let path = write_events(temp.path(), events, "2026-03-10T08:00:00Z");
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();
    let inputs = load_full_sessions_filtered(temp.path(), None, None, None, false).unwrap();
    let fallback = compute_tool_analysis(&inputs);
    let indexed = db.query_tool_analysis(None, None, None, false).unwrap();
    assert_eq!(fallback.total_calls, expected_calls);
    assert_eq!(
        serde_json::to_value(&indexed).unwrap(),
        serde_json::to_value(&fallback).unwrap()
    );
    let indexed_dashboard = db.query_analytics(None, None, None, false).unwrap();
    let fallback_dashboard = compute_analytics(&inputs);
    assert_eq!(
        indexed_dashboard
            .productivity_metrics
            .avg_tool_calls_per_turn,
        fallback_dashboard
            .productivity_metrics
            .avg_tool_calls_per_turn,
    );
    serde_json::to_value(indexed).unwrap()
}

#[test]
fn complete_tool_calls_keep_their_counts_outcomes_and_durations() {
    let result = assert_tool_parity(
        vec![
            start(Some("ok"), "read_file", Some("2026-03-10T07:15:00Z")),
            complete("ok", Some(true), Some("2026-03-10T07:15:01Z")),
            start(Some("failed"), "read_file", Some("2026-03-10T07:15:02Z")),
            complete("failed", Some(false), Some("2026-03-10T07:15:05Z")),
            start(Some("unknown"), "read_file", Some("2026-03-10T07:15:06Z")),
            complete("unknown", None, Some("2026-03-10T07:15:08Z")),
        ],
        3,
    );
    assert_eq!(result["successRate"], 0.5);
    assert_eq!(result["avgDurationMs"], 2000.0);
}

#[test]
fn pending_tools_count_as_invocations_without_a_known_outcome() {
    let result = assert_tool_parity(
        vec![start(
            Some("pending"),
            "read_file",
            Some("2026-03-10T07:15:00Z"),
        )],
        1,
    );
    assert_eq!(result["successRate"], 0.0);
    assert_eq!(result["avgDurationMs"], 0.0);
    assert_eq!(
        result["activityHeatmap"]
            .as_array()
            .unwrap()
            .iter()
            .map(|cell| cell["count"].as_u64().unwrap())
            .sum::<u64>(),
        1
    );
}

#[test]
fn duplicated_starts_and_completions_do_not_create_extra_invocations() {
    let result = assert_tool_parity(
        vec![
            start(Some("same"), "read_file", Some("2026-03-10T07:15:00Z")),
            start(
                Some("same"),
                "ignored_duplicate",
                Some("2026-03-10T07:15:01Z"),
            ),
            complete("same", Some(true), Some("2026-03-10T07:15:02Z")),
            complete("same", Some(true), Some("2026-03-10T07:15:03Z")),
        ],
        1,
    );
    assert_eq!(result["tools"][0]["name"], "read_file");
    assert_eq!(result["avgDurationMs"], 3000.0);
}

#[test]
fn orphan_completions_and_missing_ids_follow_conversation_semantics() {
    assert_tool_parity(vec![complete("orphan", Some(true), None)], 0);
    assert_tool_parity(vec![start(None, "unknown_id", None)], 1);
}

#[test]
fn missing_and_reversed_timestamps_do_not_count_as_zero_duration_samples() {
    let result = assert_tool_parity(
        vec![
            start(Some("missing"), "read_file", None),
            complete("missing", Some(true), Some("2026-03-10T07:15:01Z")),
            start(Some("reversed"), "read_file", Some("2026-03-10T07:15:03Z")),
            complete("reversed", Some(true), Some("2026-03-10T07:15:02Z")),
            start(Some("normal"), "read_file", Some("2026-03-10T07:15:04Z")),
            complete("normal", Some(true), Some("2026-03-10T07:15:06Z")),
        ],
        3,
    );
    assert_eq!(result["avgDurationMs"], 2000.0);
}

#[test]
fn subagent_terminal_outcome_and_duration_override_the_wrapper_tool() {
    let result = assert_tool_parity(
        vec![
            event(
                "tool.execution_start",
                json!({"toolCallId": "task", "toolName": "task", "arguments": {"agent_type": "explore"}}),
                "task-start",
                Some("2026-03-10T07:15:00Z"),
            ),
            event(
                "subagent.started",
                json!({"toolCallId": "task", "agentName": "explore"}),
                "agent-start",
                Some("2026-03-10T07:15:01Z"),
            ),
            complete("task", Some(true), Some("2026-03-10T07:15:02Z")),
            event(
                "subagent.failed",
                json!({"toolCallId": "task", "error": "failed", "durationMs": 5000}),
                "agent-end",
                Some("2026-03-10T07:15:06Z"),
            ),
        ],
        1,
    );
    assert_eq!(result["tools"][0]["name"], "explore");
    assert_eq!(result["successRate"], 0.0);
    assert_eq!(result["avgDurationMs"], 5000.0);
}

#[test]
fn activity_and_segment_charts_use_the_end_day_and_respect_the_date_filter() {
    let temp = tempfile::tempdir().unwrap();
    let shutdown = |id, timestamp, tokens| {
        event(
            "session.shutdown",
            json!({"totalPremiumRequests": 2.0, "modelMetrics": {"model": {"requests": {"cost": 0.5}, "usage": {"inputTokens": tokens}}}}),
            id,
            Some(timestamp),
        )
    };
    let path = write_events(
        temp.path(),
        vec![
            event(
                "session.start",
                json!({}),
                "session-start",
                Some("2026-03-10T23:55:00Z"),
            ),
            shutdown("first-end", "2026-03-11T00:05:00Z", 100),
            event(
                "session.resume",
                json!({}),
                "resume",
                Some("2026-03-11T23:55:00Z"),
            ),
            shutdown("second-end", "2026-03-12T00:05:00Z", 200),
        ],
        "2026-03-12T00:05:00Z",
    );
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();
    for from in [None, Some("2026-03-12")] {
        let to = Some("2026-03-12");
        let inputs =
            load_full_sessions_filtered(temp.path(), from, to, Some("org/repo"), true).unwrap();
        let indexed = db
            .query_analytics(from, to, Some("org/repo"), true)
            .unwrap();
        let fallback = compute_analytics(&inputs);
        let indexed = serde_json::to_value(indexed).unwrap();
        let fallback = serde_json::to_value(fallback).unwrap();
        for field in [
            "activityPerDay",
            "tokenUsageByDay",
            "costByDay",
            "modelUsageByDay",
        ] {
            assert_eq!(indexed[field], fallback[field], "{field}: from={from:?}");
        }
        assert_eq!(
            indexed["activityPerDay"][0]["date"],
            from.unwrap_or("2026-03-11")
        );
        assert_eq!(indexed["costByDay"][0]["cost"], 2.0);
        assert_eq!(indexed["totalCost"], fallback["totalCost"]);
        assert_eq!(indexed["totalCost"], 1.0);
    }
}

#[test]
fn tied_tool_counts_have_a_stable_name_order_and_most_used_tool() {
    let result = assert_tool_parity(
        vec![
            start(Some("read"), "read_file", None),
            start(Some("edit"), "edit_file", None),
        ],
        2,
    );
    assert_eq!(result["mostUsedTool"], "edit_file");
    assert_eq!(result["tools"][0]["name"], "edit_file");
}

#[test]
fn undated_shutdowns_keep_lifetime_totals_without_daily_chart_points() {
    let temp = tempfile::tempdir().unwrap();
    let path = write_events(
        temp.path(),
        vec![event(
            "session.shutdown",
            json!({"totalPremiumRequests": 2.0, "modelMetrics": {"model": {"requests": {"cost": 0.5}, "usage": {"inputTokens": 100, "outputTokens": 20}}}}),
            "undated-shutdown",
            None,
        )],
        "2026-03-10T08:00:00Z",
    );
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();
    for from in [None, Some("2026-03-10")] {
        let inputs = load_full_sessions_filtered(temp.path(), from, None, None, false).unwrap();
        let indexed =
            serde_json::to_value(db.query_analytics(from, None, None, false).unwrap()).unwrap();
        let fallback = serde_json::to_value(compute_analytics(&inputs)).unwrap();
        for field in [
            "activityPerDay",
            "tokenUsageByDay",
            "costByDay",
            "modelUsageByDay",
        ] {
            assert_eq!(indexed[field], fallback[field], "{field}: from={from:?}");
            assert_eq!(indexed[field], json!([]));
        }
        assert_eq!(indexed["totalTokens"], fallback["totalTokens"]);
        assert_eq!(indexed["totalTokens"], 120);
        assert_eq!(indexed["totalCost"], fallback["totalCost"]);
        assert_eq!(indexed["totalCost"], 0.5);
    }
}

#[test]
fn a_stale_analytics_version_refreshes_tool_counts_without_source_changes() {
    let temp = tempfile::tempdir().unwrap();
    let path = write_events(
        temp.path(),
        vec![start(Some("pending"), "read_file", None)],
        "2026-03-10T08:00:00Z",
    );
    let db_path = temp.path().join("index.db");
    let db = IndexDb::open_or_create(&db_path).unwrap();
    db.upsert_session(&path).unwrap();
    let id = SessionId::from_validated(ID);
    assert!(!db.needs_reindex(&id, &path));
    // Simulate the previous extractor's count while retaining the source fingerprint.
    db.conn
        .execute(
            "UPDATE sessions SET analytics_version = 16, tool_call_count = NULL",
            [],
        )
        .unwrap();
    db.conn
        .execute("DELETE FROM session_tool_calls", [])
        .unwrap();
    assert!(db.needs_reindex(&id, &path));
    assert_eq!(
        crate::reindex_incremental(temp.path(), &db_path).unwrap(),
        (1, 0)
    );
    assert!(!db.needs_reindex(&id, &path));
    assert_eq!(
        db.query_tool_analysis(None, None, None, false)
            .unwrap()
            .total_calls,
        1
    );
}
