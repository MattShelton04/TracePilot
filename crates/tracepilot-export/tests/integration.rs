//! Integration tests for the export pipeline.
//!
//! These tests exercise the full builder → renderer pipeline with fixture
//! session data on disk, verifying that the exported JSON is valid and
//! contains the expected sections.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use tracepilot_export::document::*;
use tracepilot_export::options::*;
use tracepilot_export::*;

// ── Fixture helpers ────────────────────────────────────────────────────────

fn full_workspace_yaml() -> &'static str {
    r#"id: test-session-id
cwd: /test/project
repository: user/repo
branch: main
summary: "Test session"
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#
}

fn minimal_workspace_yaml() -> &'static str {
    "id: minimal-session\n"
}

fn sample_events_jsonl() -> &'static str {
    concat!(
        r#"{"type":"session.start","data":{"sessionId":"test-session-id","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"main","repository":"user/repo","hostType":"cli"}},"id":"evt-1","timestamp":"2026-03-10T07:14:50.780Z","parentId":null}"#,
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

fn create_checkpoints(session_dir: &Path) {
    let cp_dir = session_dir.join("checkpoints");
    fs::create_dir_all(&cp_dir).unwrap();
    let index = "| # | Title | File |\n| --- | --- | --- |\n| 1 | Initial setup | cp1.md |\n| 2 | Add auth | cp2.md |\n";
    fs::write(cp_dir.join("index.md"), index).unwrap();
    fs::write(cp_dir.join("cp1.md"), "# Checkpoint 1\nInitial project setup").unwrap();
    fs::write(cp_dir.join("cp2.md"), "# Checkpoint 2\nAdded authentication").unwrap();
}

fn create_full_session(dir: &Path) {
    fs::write(dir.join("workspace.yaml"), full_workspace_yaml()).unwrap();
    fs::write(dir.join("events.jsonl"), sample_events_jsonl()).unwrap();
    fs::write(dir.join("plan.md"), "# Implementation Plan\n\n## Phase 1\n\n- [ ] Build core\n").unwrap();
    create_checkpoints(dir);
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[test]
fn export_full_session_json() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();

    assert_eq!(files.len(), 1);
    assert!(files[0].filename.starts_with("session-test-ses"));
    assert!(files[0].filename.ends_with(".tpx.json"));

    // Parse and validate structure
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    assert_eq!(archive.sessions.len(), 1);

    let session = &archive.sessions[0];
    assert_eq!(session.metadata.id, "test-session-id");
    assert_eq!(session.metadata.summary.as_deref(), Some("Test session"));
    assert_eq!(session.metadata.repository.as_deref(), Some("user/repo"));
}

#[test]
fn export_includes_conversation() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert!(session.available_sections.contains(&SectionId::Conversation));
    let turns = session.conversation.as_ref().expect("conversation should be present");
    assert!(!turns.is_empty(), "should have at least one turn");

    // Check that the conversation has the expected content
    let first_turn = &turns[0];
    assert_eq!(first_turn.user_message.as_deref(), Some("Hello world"));
    assert!(!first_turn.assistant_messages.is_empty());
}

#[test]
fn export_includes_raw_events() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert!(session.available_sections.contains(&SectionId::Events));
    let events = session.events.as_ref().expect("events should be present");
    assert_eq!(events.len(), 8, "should have 8 raw events");
    assert_eq!(events[0].event_type, "session.start");
    assert_eq!(events[7].event_type, "session.shutdown");
}

#[test]
fn export_includes_plan() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert!(session.available_sections.contains(&SectionId::Plan));
    let plan = session.plan.as_ref().expect("plan should be present");
    assert!(plan.contains("Implementation Plan"));
}

#[test]
fn export_includes_checkpoints() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert!(session.available_sections.contains(&SectionId::Checkpoints));
    let checkpoints = session.checkpoints.as_ref().expect("checkpoints should be present");
    assert_eq!(checkpoints.len(), 2);
    assert_eq!(checkpoints[0].title, "Initial setup");
    assert_eq!(checkpoints[1].title, "Add auth");
    assert!(checkpoints[0].content.as_ref().unwrap().contains("Checkpoint 1"));
}

#[test]
fn export_includes_shutdown_metrics() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert!(session.available_sections.contains(&SectionId::Metrics));
    let metrics = session.shutdown_metrics.as_ref().expect("metrics should be present");
    assert_eq!(metrics.shutdown_type.as_deref(), Some("routine"));
    assert_eq!(metrics.current_model.as_deref(), Some("claude-opus-4.6"));
}

#[test]
fn export_includes_health() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert!(session.available_sections.contains(&SectionId::Health));
    let health = session.health.as_ref().expect("health should be present");
    assert!(health.score > 0.0 && health.score <= 1.0);
}

#[test]
fn export_section_filtering() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    // Only include conversation and plan
    let mut sections = HashSet::new();
    sections.insert(SectionId::Conversation);
    sections.insert(SectionId::Plan);

    let options = ExportOptions {
        format: ExportFormat::Json,
        sections,
        output: OutputTarget::String,
    };

    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    // Should include selected sections
    assert!(session.conversation.is_some());
    assert!(session.plan.is_some());

    // Should NOT include unselected sections
    assert!(session.events.is_none());
    assert!(session.checkpoints.is_none());
    assert!(session.shutdown_metrics.is_none());
    assert!(session.health.is_none());
}

#[test]
fn export_minimal_options() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::minimal(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    // Metadata always present
    assert_eq!(session.metadata.id, "test-session-id");

    // No optional sections
    assert!(session.conversation.is_none());
    assert!(session.events.is_none());
    assert!(session.plan.is_none());
    assert!(session.checkpoints.is_none());
    assert!(session.available_sections.is_empty());
}

#[test]
fn export_sharing_preset() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::sharing(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    // Sharing includes conversation, plan, todos, metrics
    assert!(session.conversation.is_some());
    assert!(session.plan.is_some());
    assert!(session.shutdown_metrics.is_some());

    // Sharing excludes raw events, checkpoints, health
    assert!(session.events.is_none());
    assert!(session.checkpoints.is_none());
    assert!(session.health.is_none());
}

#[test]
fn export_minimal_session() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("workspace.yaml"), minimal_workspace_yaml()).unwrap();

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert_eq!(session.metadata.id, "minimal-session");
    assert!(session.conversation.is_none() || session.conversation.as_ref().unwrap().is_empty());
    assert!(session.plan.is_none());
    assert!(session.checkpoints.is_none());
}

#[test]
fn export_missing_workspace_returns_error() {
    let dir = tempfile::tempdir().unwrap();
    // No workspace.yaml

    let options = ExportOptions::all(ExportFormat::Json);
    let result = export_session(dir.path(), &options);
    assert!(result.is_err());

    let err = result.unwrap_err();
    assert!(err.to_string().contains("session not found"));
}

#[test]
fn export_header_has_correct_fields() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();

    assert_eq!(archive.header.schema_version.major, 1);
    assert_eq!(archive.header.schema_version.minor, 0);
    assert!(archive.header.exported_by.starts_with("TracePilot"));
    assert!(archive.header.content_hash.is_some());
    assert!(archive.header.minimum_reader_version.is_some());
}

#[test]
fn export_options_record_reflects_config() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let mut sections = HashSet::new();
    sections.insert(SectionId::Conversation);
    sections.insert(SectionId::Plan);

    let options = ExportOptions {
        format: ExportFormat::Json,
        sections,
        output: OutputTarget::String,
    };

    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();

    assert_eq!(archive.export_options.format, "json");
    assert!(!archive.export_options.redaction_applied);
    assert!(archive.export_options.included_sections.contains(&SectionId::Conversation));
    assert!(archive.export_options.included_sections.contains(&SectionId::Plan));
}

#[test]
fn json_round_trip_preserves_data() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    // Export
    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();

    // Deserialize the output
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();

    // Re-serialize
    let re_serialized = serde_json::to_vec_pretty(&archive).unwrap();

    // Deserialize again
    let archive2: SessionArchive = serde_json::from_slice(&re_serialized).unwrap();

    // Compare key fields
    assert_eq!(archive.sessions.len(), archive2.sessions.len());
    assert_eq!(
        archive.sessions[0].metadata.id,
        archive2.sessions[0].metadata.id
    );
    assert_eq!(
        archive.sessions[0].available_sections.len(),
        archive2.sessions[0].available_sections.len()
    );
}

#[test]
fn preview_export_returns_truncated_content() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Json);
    let preview = preview_export(dir.path(), &options, Some(500)).unwrap();

    assert!(preview.len() <= 500);
    assert!(preview.starts_with("{"));
}

#[test]
fn preview_export_returns_full_content_when_no_limit() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Json);
    let preview = preview_export(dir.path(), &options, None).unwrap();

    // Should be valid JSON
    let _: serde_json::Value = serde_json::from_str(&preview).expect("should be valid JSON");
}

#[test]
fn batch_export_multiple_sessions() {
    let dir1 = tempfile::tempdir().unwrap();
    let dir2 = tempfile::tempdir().unwrap();

    create_full_session(dir1.path());
    fs::write(dir2.path().join("workspace.yaml"), "id: second-session\nsummary: Session 2\n").unwrap();

    let dirs: Vec<&Path> = vec![dir1.path(), dir2.path()];
    let options = ExportOptions::minimal(ExportFormat::Json);
    let files = export_sessions_batch(&dirs, &options).unwrap();

    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    assert_eq!(archive.sessions.len(), 2);
    assert_eq!(archive.sessions[0].metadata.id, "test-session-id");
    assert_eq!(archive.sessions[1].metadata.id, "second-session");
}

#[test]
fn metadata_counts_are_populated() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert_eq!(session.metadata.event_count, Some(8));
    assert!(session.metadata.turn_count.is_some());
    assert!(session.metadata.turn_count.unwrap() > 0);
}
