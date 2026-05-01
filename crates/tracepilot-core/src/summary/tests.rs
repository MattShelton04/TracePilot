use super::*;
use std::fs;
use tracepilot_test_support::fixtures::{
    create_checkpoints, enrichment_events_jsonl, full_workspace_yaml, minimal_workspace_yaml,
    sample_events_jsonl, sparse_workspace_yaml,
};

#[test]
fn test_full_session_summary() {
    let dir = tempfile::tempdir().unwrap();
    let session_dir = dir.path();

    // workspace.yaml
    fs::write(session_dir.join("workspace.yaml"), full_workspace_yaml()).unwrap();
    // events.jsonl
    fs::write(session_dir.join("events.jsonl"), sample_events_jsonl()).unwrap();
    // session.db (empty file is enough for existence check)
    fs::write(session_dir.join("session.db"), b"").unwrap();
    // plan.md
    fs::write(session_dir.join("plan.md"), "# Plan").unwrap();
    // checkpoints
    create_checkpoints(session_dir);

    let summary = load_session_summary(session_dir).unwrap();

    assert_eq!(summary.id, "test-session-id");
    assert_eq!(summary.summary.as_deref(), Some("Test session"));
    assert_eq!(summary.repository.as_deref(), Some("user/repo"));
    assert_eq!(summary.branch.as_deref(), Some("main"));
    assert_eq!(summary.cwd.as_deref(), Some("/test/project"));
    assert!(summary.created_at.is_some());
    assert!(summary.updated_at.is_some());

    // Events
    assert!(summary.has_events);
    assert_eq!(summary.event_count, Some(8));

    // Turns (1 user message → 1 turn)
    assert_eq!(summary.turn_count, Some(1));

    // Shutdown metrics
    let metrics = summary.shutdown_metrics.as_ref().unwrap();
    assert_eq!(metrics.shutdown_type.as_deref(), Some("routine"));
    assert_eq!(metrics.total_premium_requests, Some(1.0));
    assert_eq!(metrics.current_model.as_deref(), Some("claude-opus-4.6"));
    assert!(metrics.code_changes.is_some());
    assert!(!metrics.model_metrics.is_empty());

    // Artifacts
    assert!(summary.has_session_db);
    assert!(summary.has_plan);
    assert!(summary.has_checkpoints);
    assert_eq!(summary.checkpoint_count, Some(2));
}

#[test]
fn test_minimal_session_summary() {
    let dir = tempfile::tempdir().unwrap();
    let session_dir = dir.path();

    fs::write(session_dir.join("workspace.yaml"), minimal_workspace_yaml()).unwrap();

    let summary = load_session_summary(session_dir).unwrap();

    assert_eq!(summary.id, "minimal-session");
    assert!(summary.summary.is_none());
    assert!(summary.repository.is_none());
    assert!(summary.branch.is_none());
    assert!(summary.cwd.is_none());
    assert!(summary.host_type.is_none());

    assert!(!summary.has_events);
    assert!(summary.event_count.is_none());
    assert!(summary.turn_count.is_none());
    assert!(summary.shutdown_metrics.is_none());
    assert!(!summary.has_session_db);
    assert!(!summary.has_plan);
    assert!(!summary.has_checkpoints);
    assert!(summary.checkpoint_count.is_none());
}

#[test]
fn test_context_enrichment_from_events() {
    let dir = tempfile::tempdir().unwrap();
    let session_dir = dir.path();

    // Workspace missing repository/branch/host_type
    fs::write(session_dir.join("workspace.yaml"), sparse_workspace_yaml()).unwrap();
    // Events with session.start containing context
    fs::write(session_dir.join("events.jsonl"), enrichment_events_jsonl()).unwrap();

    let summary = load_session_summary(session_dir).unwrap();

    assert_eq!(summary.id, "sparse-session");
    // Enriched from session.start context
    assert_eq!(summary.repository.as_deref(), Some("org/project"));
    assert_eq!(summary.branch.as_deref(), Some("feature-x"));
    assert_eq!(summary.host_type.as_deref(), Some("vscode"));
}

#[test]
fn test_no_workspace_yaml_falls_back_to_dir_id() {
    let dir = tempfile::tempdir().unwrap();
    // Create a UUID-named subdirectory (mimicking session-state layout)
    let session_dir = dir.path().join("c86fe369-c858-4d91-81da-203c5e276e33");
    fs::create_dir_all(&session_dir).unwrap();

    let summary = load_session_summary(&session_dir).unwrap();

    assert_eq!(summary.id, "c86fe369-c858-4d91-81da-203c5e276e33");
    assert!(summary.summary.is_none());
    assert!(summary.repository.is_none());
    assert!(!summary.has_events);
    assert!(summary.event_count.is_none());
}

#[test]
fn test_no_workspace_yaml_enriched_from_events() {
    let dir = tempfile::tempdir().unwrap();
    let session_dir = dir.path().join("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    fs::create_dir_all(&session_dir).unwrap();
    // No workspace.yaml — only events.jsonl
    fs::write(session_dir.join("events.jsonl"), enrichment_events_jsonl()).unwrap();

    let summary = load_session_summary(&session_dir).unwrap();

    // ID comes from directory name
    assert_eq!(summary.id, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    // Context fields enriched from session.start event
    assert_eq!(summary.repository.as_deref(), Some("org/project"));
    assert_eq!(summary.branch.as_deref(), Some("feature-x"));
    assert_eq!(summary.host_type.as_deref(), Some("vscode"));
    assert_eq!(summary.cwd.as_deref(), Some("/test"));
    // Events parsed
    assert!(summary.has_events);
    assert_eq!(summary.event_count, Some(2));
}

#[test]
fn test_malformed_workspace_yaml_falls_back() {
    let dir = tempfile::tempdir().unwrap();
    let session_dir = dir.path().join("bad-workspace-test");
    fs::create_dir_all(&session_dir).unwrap();
    // workspace.yaml with incompatible field type (created_at as number)
    fs::write(
        session_dir.join("workspace.yaml"),
        "id: 123\ncreated_at: 12345\n",
    )
    .unwrap();

    let summary = load_session_summary(&session_dir).unwrap();

    // Falls back to directory name as ID
    assert_eq!(summary.id, "bad-workspace-test");
}

// ── load_session_summary_from_events tests ────────────────────────────────

/// Verify load_session_summary_from_events produces parity with load_session_summary
/// given pre-parsed events from the same file.
#[test]
fn test_summary_from_events_parity_with_disk() {
    let dir = tempfile::tempdir().unwrap();
    let session_dir = dir.path();

    fs::write(session_dir.join("workspace.yaml"), full_workspace_yaml()).unwrap();
    fs::write(session_dir.join("events.jsonl"), sample_events_jsonl()).unwrap();
    fs::write(session_dir.join("session.db"), b"").unwrap();
    fs::write(session_dir.join("plan.md"), "# Plan").unwrap();
    create_checkpoints(session_dir);

    // Ground truth: load from disk
    let expected = load_session_summary(session_dir).unwrap();

    // Parse events once, then build summary from pre-parsed slice
    let parsed =
        crate::parsing::events::parse_typed_events(&session_dir.join("events.jsonl")).unwrap();
    let actual = load_session_summary_from_events(session_dir, &parsed.events).unwrap();

    assert_eq!(actual.id, expected.id);
    assert_eq!(actual.summary, expected.summary);
    assert_eq!(actual.repository, expected.repository);
    assert_eq!(actual.branch, expected.branch);
    assert_eq!(actual.cwd, expected.cwd);
    assert_eq!(actual.has_events, expected.has_events);
    assert_eq!(actual.event_count, expected.event_count);
    assert_eq!(actual.turn_count, expected.turn_count);
    assert_eq!(actual.has_session_db, expected.has_session_db);
    assert_eq!(actual.has_plan, expected.has_plan);
    assert_eq!(actual.has_checkpoints, expected.has_checkpoints);
    assert_eq!(actual.checkpoint_count, expected.checkpoint_count);
    assert_eq!(
        actual.shutdown_metrics.is_some(),
        expected.shutdown_metrics.is_some()
    );
}

/// An empty events slice should produce has_events = false, no counts.
#[test]
fn test_summary_from_events_empty_slice() {
    let dir = tempfile::tempdir().unwrap();
    let session_dir = dir.path();
    fs::write(session_dir.join("workspace.yaml"), minimal_workspace_yaml()).unwrap();

    let summary = load_session_summary_from_events(session_dir, &[]).unwrap();

    assert!(!summary.has_events);
    assert!(summary.event_count.is_none());
    assert!(summary.turn_count.is_none());
    assert!(summary.shutdown_metrics.is_none());
}

/// Context enrichment from events works the same in the pre-parsed path.
#[test]
fn test_summary_from_events_context_enrichment() {
    let dir = tempfile::tempdir().unwrap();
    let session_dir = dir.path();
    fs::write(session_dir.join("workspace.yaml"), sparse_workspace_yaml()).unwrap();
    fs::write(session_dir.join("events.jsonl"), enrichment_events_jsonl()).unwrap();

    let parsed =
        crate::parsing::events::parse_typed_events(&session_dir.join("events.jsonl")).unwrap();
    let summary = load_session_summary_from_events(session_dir, &parsed.events).unwrap();

    assert_eq!(summary.repository.as_deref(), Some("org/project"));
    assert_eq!(summary.branch.as_deref(), Some("feature-x"));
    assert_eq!(summary.host_type.as_deref(), Some("vscode"));
}

/// Events.jsonl with two shutdown events simulating a resumed session.
fn resumed_events_jsonl() -> &'static str {
    concat!(
        r#"{"type":"session.start","data":{"sessionId":"test-session-id","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"main","repository":"user/repo"}},"id":"evt-1","timestamp":"2026-03-10T07:00:00.000Z","parentId":null}"#,
        "\n",
        r#"{"type":"user.message","data":{"content":"Hello","interactionId":"int-1"},"id":"evt-2","timestamp":"2026-03-10T07:01:00.000Z","parentId":"evt-1"}"#,
        "\n",
        r#"{"type":"assistant.turn_start","data":{"turnId":"t1","interactionId":"int-1"},"id":"evt-3","timestamp":"2026-03-10T07:01:01.000Z","parentId":"evt-2"}"#,
        "\n",
        r#"{"type":"assistant.turn_end","data":{"turnId":"t1"},"id":"evt-4","timestamp":"2026-03-10T07:01:02.000Z","parentId":"evt-3"}"#,
        "\n",
        r#"{"type":"session.shutdown","data":{"shutdownType":"routine","totalPremiumRequests":12,"totalApiDurationMs":5000,"sessionStartTime":1000,"currentModel":"claude-sonnet-4.5","codeChanges":{"linesAdded":10,"linesRemoved":2,"filesModified":["/a.rs"]},"modelMetrics":{"claude-sonnet-4.5":{"requests":{"count":20,"cost":5.0},"usage":{"inputTokens":1000,"outputTokens":500,"cacheReadTokens":0,"cacheWriteTokens":0}}}},"id":"evt-5","timestamp":"2026-03-10T07:10:00.000Z","parentId":null}"#,
        "\n",
        r#"{"type":"session.resume","data":{"resumeTime":"2026-03-10T08:00:00.000Z"},"id":"evt-6","timestamp":"2026-03-10T08:00:00.000Z","parentId":null}"#,
        "\n",
        r#"{"type":"user.message","data":{"content":"Continue","interactionId":"int-2"},"id":"evt-7","timestamp":"2026-03-10T08:01:00.000Z","parentId":null}"#,
        "\n",
        r#"{"type":"assistant.turn_start","data":{"turnId":"t2","interactionId":"int-2"},"id":"evt-8","timestamp":"2026-03-10T08:01:01.000Z","parentId":"evt-7"}"#,
        "\n",
        r#"{"type":"assistant.turn_end","data":{"turnId":"t2"},"id":"evt-9","timestamp":"2026-03-10T08:01:02.000Z","parentId":"evt-8"}"#,
        "\n",
        r#"{"type":"session.shutdown","data":{"shutdownType":"user_exit","totalPremiumRequests":6,"totalApiDurationMs":3000,"sessionStartTime":2000,"currentModel":"claude-opus-4.6","codeChanges":{"linesAdded":5,"linesRemoved":3,"filesModified":["/a.rs","/b.rs"]},"modelMetrics":{"claude-opus-4.6":{"requests":{"count":8,"cost":4.0},"usage":{"inputTokens":2000,"outputTokens":1000,"cacheReadTokens":0,"cacheWriteTokens":0}}}},"id":"evt-10","timestamp":"2026-03-10T08:10:00.000Z","parentId":null}"#,
        "\n",
    )
}

#[test]
fn test_resumed_session_summary() {
    let dir = tempfile::tempdir().unwrap();
    let session_dir = dir.path();

    fs::write(session_dir.join("workspace.yaml"), full_workspace_yaml()).unwrap();
    fs::write(session_dir.join("events.jsonl"), resumed_events_jsonl()).unwrap();

    let summary = load_session_summary(session_dir).unwrap();

    let metrics = summary
        .shutdown_metrics
        .as_ref()
        .expect("should have shutdown metrics");
    // shutdown_count = 2 (two shutdown events combined)
    assert_eq!(metrics.shutdown_count, Some(2));
    // Summed premium requests: 12 + 6 = 18
    assert_eq!(metrics.total_premium_requests, Some(18.0));
    // Summed API duration: 5000 + 3000 = 8000
    assert_eq!(metrics.total_api_duration_ms, Some(8000));
    // session_start_time from FIRST shutdown
    assert_eq!(metrics.session_start_time, Some(1000));
    // shutdown_type and current_model from LAST shutdown
    assert_eq!(metrics.shutdown_type.as_deref(), Some("user_exit"));
    assert_eq!(metrics.current_model.as_deref(), Some("claude-opus-4.6"));

    // Code changes: lines summed, files deduped
    let changes = metrics.code_changes.as_ref().unwrap();
    assert_eq!(changes.lines_added, Some(15)); // 10 + 5
    assert_eq!(changes.lines_removed, Some(5)); // 2 + 3
    let files = changes.files_modified.as_ref().unwrap();
    assert_eq!(files.len(), 2); // /a.rs deduped, + /b.rs
    assert!(files.contains(&"/a.rs".to_string()));
    assert!(files.contains(&"/b.rs".to_string()));

    // Model metrics: sonnet from first, opus from second
    assert!(metrics.model_metrics.contains_key("claude-sonnet-4.5"));
    assert!(metrics.model_metrics.contains_key("claude-opus-4.6"));
    let sonnet = &metrics.model_metrics["claude-sonnet-4.5"];
    assert_eq!(sonnet.requests.as_ref().unwrap().count, Some(20));
    let opus = &metrics.model_metrics["claude-opus-4.6"];
    assert_eq!(opus.requests.as_ref().unwrap().count, Some(8));
}
