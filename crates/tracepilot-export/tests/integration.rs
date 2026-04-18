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
use tracepilot_test_support::fixtures::{
    create_full_session, full_workspace_yaml, minimal_workspace_yaml,
};

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

    assert!(
        session
            .available_sections
            .contains(&SectionId::Conversation)
    );
    let turns = session
        .conversation
        .as_ref()
        .expect("conversation should be present");
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
    let checkpoints = session
        .checkpoints
        .as_ref()
        .expect("checkpoints should be present");
    assert_eq!(checkpoints.len(), 2);
    assert_eq!(checkpoints[0].title, "Initial setup");
    assert_eq!(checkpoints[1].title, "Add auth");
    assert!(
        checkpoints[0]
            .content
            .as_ref()
            .unwrap()
            .contains("Checkpoint 1")
    );
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
    let metrics = session
        .shutdown_metrics
        .as_ref()
        .expect("metrics should be present");
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
        content_detail: ContentDetailOptions::default(),
        redaction: Default::default(),
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
        content_detail: ContentDetailOptions::default(),
        redaction: Default::default(),
    };

    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();

    assert_eq!(archive.export_options.format, "json");
    assert!(!archive.export_options.redaction_applied);
    assert!(
        archive
            .export_options
            .included_sections
            .contains(&SectionId::Conversation)
    );
    assert!(
        archive
            .export_options
            .included_sections
            .contains(&SectionId::Plan)
    );
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
    fs::write(
        dir2.path().join("workspace.yaml"),
        "id: second-session\nsummary: Session 2\n",
    )
    .unwrap();

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

// ── Markdown renderer integration tests ────────────────────────────────────

#[test]
fn export_markdown_full_session() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();

    assert_eq!(files.len(), 1);
    assert!(files[0].filename.ends_with(".md"));

    let text = files[0].as_text().unwrap();
    assert!(text.contains("# Session:"));
    assert!(text.contains("## Metadata"));
    assert!(text.contains("test-session-id"));
    // Verify repository links are included
    assert!(text.contains("[TracePilot v"));
    assert!(text.contains("https://github.com/MattShelton04/TracePilot"));
    assert!(text.contains("Get [TracePilot](https://github.com/MattShelton04/TracePilot)"));
}

#[test]
fn export_markdown_includes_conversation() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(text.contains("## Conversation"));
    assert!(text.contains("Hello world"));
    assert!(text.contains("### Turn 1"));
}

#[test]
fn export_markdown_includes_plan() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(text.contains("## Plan"));
    assert!(text.contains("Build core"));
}

#[test]
fn export_markdown_includes_tool_calls() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(text.contains("**Tool Calls**"));
    assert!(text.contains("read_file"));
}

#[test]
fn export_markdown_includes_metrics() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(text.contains("## Metrics"));
    assert!(text.contains("claude-opus-4.6"));
}

#[test]
fn export_markdown_includes_checkpoints() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Markdown);
    let files = export_session(dir.path(), &options).unwrap();
    let text = files[0].as_text().unwrap();

    assert!(text.contains("## Checkpoints"));
    assert!(text.contains("Initial setup"));
}

#[test]
fn export_markdown_preview() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Markdown);
    let preview = preview_export(dir.path(), &options, Some(200)).unwrap();

    assert!(preview.len() <= 200);
    assert!(preview.starts_with("# Session:"));
}

// ── CSV renderer integration tests ─────────────────────────────────────────

#[test]
fn export_csv_produces_multiple_files() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    // At minimum: summary, conversation, tools, events
    assert!(
        files.len() >= 3,
        "CSV should produce multiple files, got {}",
        files.len()
    );

    let filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();
    assert!(filenames.iter().any(|f| f.contains("summary")));
    assert!(filenames.iter().any(|f| f.contains("conversation")));
    assert!(filenames.iter().any(|f| f.contains("events")));
}

#[test]
fn export_csv_summary_has_session_data() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    let summary = files
        .iter()
        .find(|f| f.filename.contains("summary"))
        .unwrap();
    let text = summary.as_text().unwrap();
    assert!(text.contains("test-session-id"));
    assert!(text.contains("user/repo"));
}

#[test]
fn export_csv_conversation_has_turns() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    let conv = files
        .iter()
        .find(|f| f.filename.contains("conversation"))
        .unwrap();
    let text = conv.as_text().unwrap();
    assert!(text.contains("turn,model,user_message"));
    assert!(text.contains("Hello world"));
}

#[test]
fn export_csv_tools_has_entries() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    let tools = files.iter().find(|f| f.filename.contains("tools"));
    assert!(tools.is_some(), "should have tools CSV");
    let text = tools.unwrap().as_text().unwrap();
    assert!(text.contains("read_file"));
}

#[test]
fn export_csv_events_has_all_event_types() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    let events = files
        .iter()
        .find(|f| f.filename.contains("events"))
        .unwrap();
    let text = events.as_text().unwrap();
    assert!(text.contains("session.start"));
    assert!(text.contains("session.shutdown"));
}

#[test]
fn export_csv_model_metrics() {
    let dir = tempfile::tempdir().unwrap();
    create_full_session(dir.path());

    let options = ExportOptions::all(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    let metrics = files.iter().find(|f| f.filename.contains("model-metrics"));
    assert!(metrics.is_some(), "should have model-metrics CSV");
    let text = metrics.unwrap().as_text().unwrap();
    assert!(text.contains("claude-opus-4.6"));
}

#[test]
fn export_csv_minimal_session() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("workspace.yaml"), minimal_workspace_yaml()).unwrap();

    let options = ExportOptions::minimal(ExportFormat::Csv);
    let files = export_session(dir.path(), &options).unwrap();

    // Minimal should still have summary
    assert_eq!(files.len(), 1);
    assert!(files[0].filename.contains("summary"));
}

// ── Import pipeline integration tests ──────────────────────────────────────

use tracepilot_export::import::{ConflictStrategy, ImportOptions, import_sessions, preview_import};

#[test]
fn round_trip_export_import_preserves_metadata() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();

    create_full_session(source.path());

    // Export
    let export_opts = ExportOptions::all(ExportFormat::Json);
    let files = export_session(source.path(), &export_opts).unwrap();
    let archive_path = target.path().join("export.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    // Import
    let import_target = tempfile::tempdir().unwrap();
    let import_opts = ImportOptions::default();
    let result = import_sessions(&archive_path, import_target.path(), &import_opts).unwrap();

    assert_eq!(result.imported.len(), 1);

    // Verify imported session has workspace.yaml with correct data
    let imported_dir = &result.imported[0].path;
    let yaml_content = fs::read_to_string(imported_dir.join("workspace.yaml")).unwrap();
    assert!(yaml_content.contains("test-session-id"));
    assert!(yaml_content.contains("user/repo"));
    assert!(yaml_content.contains("imported_from"));
}

#[test]
fn round_trip_preserves_events() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();

    create_full_session(source.path());

    // Export with events
    let export_opts = ExportOptions::all(ExportFormat::Json);
    let files = export_session(source.path(), &export_opts).unwrap();
    let archive_path = target.path().join("export.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    // Import
    let import_target = tempfile::tempdir().unwrap();
    let result = import_sessions(
        &archive_path,
        import_target.path(),
        &ImportOptions::default(),
    )
    .unwrap();

    // Verify events.jsonl was written
    let events_path = result.imported[0].path.join("events.jsonl");
    assert!(events_path.exists());
    let events_content = fs::read_to_string(&events_path).unwrap();
    let lines: Vec<&str> = events_content.lines().filter(|l| !l.is_empty()).collect();
    assert_eq!(lines.len(), 8, "should preserve all 8 events");
}

#[test]
fn round_trip_preserves_plan() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();

    create_full_session(source.path());

    let export_opts = ExportOptions::all(ExportFormat::Json);
    let files = export_session(source.path(), &export_opts).unwrap();
    let archive_path = target.path().join("export.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    let import_target = tempfile::tempdir().unwrap();
    let result = import_sessions(
        &archive_path,
        import_target.path(),
        &ImportOptions::default(),
    )
    .unwrap();

    let plan_path = result.imported[0].path.join("plan.md");
    assert!(plan_path.exists());
    let plan = fs::read_to_string(&plan_path).unwrap();
    assert!(plan.contains("Implementation Plan"));
    assert!(plan.contains("Build core"));
}

#[test]
fn round_trip_preserves_checkpoints() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();

    create_full_session(source.path());

    let export_opts = ExportOptions::all(ExportFormat::Json);
    let files = export_session(source.path(), &export_opts).unwrap();
    let archive_path = target.path().join("export.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    let import_target = tempfile::tempdir().unwrap();
    let result = import_sessions(
        &archive_path,
        import_target.path(),
        &ImportOptions::default(),
    )
    .unwrap();

    let cp_dir = result.imported[0].path.join("checkpoints");
    assert!(cp_dir.exists());
    assert!(cp_dir.join("index.md").exists());
    assert!(cp_dir.join("cp1.md").exists());
    assert!(cp_dir.join("cp2.md").exists());
}

#[test]
fn import_preview_shows_session_info() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();

    create_full_session(source.path());

    let export_opts = ExportOptions::all(ExportFormat::Json);
    let files = export_session(source.path(), &export_opts).unwrap();
    let archive_path = target.path().join("export.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    let preview = preview_import(&archive_path, None).unwrap();
    assert_eq!(preview.session_count, 1);
    assert!(preview.can_import);
    assert_eq!(preview.sessions[0].id, "test-session-id");
    assert_eq!(preview.sessions[0].summary.as_deref(), Some("Test session"));
}

#[test]
fn import_conflict_skip() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();

    create_full_session(source.path());

    let export_opts = ExportOptions::all(ExportFormat::Json);
    let files = export_session(source.path(), &export_opts).unwrap();
    let archive_path = target.path().join("export.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    let import_target = tempfile::tempdir().unwrap();

    // Import once
    import_sessions(
        &archive_path,
        import_target.path(),
        &ImportOptions::default(),
    )
    .unwrap();

    // Import again with Skip — should skip
    let result2 = import_sessions(
        &archive_path,
        import_target.path(),
        &ImportOptions {
            conflict_strategy: ConflictStrategy::Skip,
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(result2.imported.len(), 0);
    assert_eq!(result2.skipped.len(), 1);
}

#[test]
fn import_conflict_duplicate() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();

    create_full_session(source.path());

    let export_opts = ExportOptions::all(ExportFormat::Json);
    let files = export_session(source.path(), &export_opts).unwrap();
    let archive_path = target.path().join("export.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    let import_target = tempfile::tempdir().unwrap();

    // Import once
    import_sessions(
        &archive_path,
        import_target.path(),
        &ImportOptions::default(),
    )
    .unwrap();

    // Import again with Duplicate
    let result2 = import_sessions(
        &archive_path,
        import_target.path(),
        &ImportOptions {
            conflict_strategy: ConflictStrategy::Duplicate,
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(result2.imported.len(), 1);
    assert!(result2.imported[0].was_duplicate);
    // New ID should be a fresh UUID (36 chars: 8-4-4-4-12), different from original
    assert_eq!(result2.imported[0].id.len(), 36);
    assert!(
        result2.imported[0]
            .id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    );
}

#[test]
fn import_session_filter() {
    let source = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();

    create_full_session(source.path());

    let export_opts = ExportOptions::all(ExportFormat::Json);
    let files = export_session(source.path(), &export_opts).unwrap();
    let archive_path = target.path().join("export.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    let import_target = tempfile::tempdir().unwrap();
    let result = import_sessions(
        &archive_path,
        import_target.path(),
        &ImportOptions {
            session_filter: vec!["nonexistent".to_string()],
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(result.imported.len(), 0);
    assert_eq!(result.skipped.len(), 1);
}

// ── Error-resilience tests for optional file-backed sections ────────────────

#[test]
fn export_skips_rewind_snapshots_on_malformed_index() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("workspace.yaml"), full_workspace_yaml()).unwrap();

    // Write invalid JSON to force a parse error in parse_rewind_index
    let rewind_dir = dir.path().join("rewind-snapshots");
    fs::create_dir_all(&rewind_dir).unwrap();
    fs::write(
        rewind_dir.join("index.json"),
        "{ this is : not valid json !!! }",
    )
    .unwrap();

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    // Export must succeed and the broken section must be absent
    assert!(
        !session
            .available_sections
            .contains(&SectionId::RewindSnapshots)
    );
    assert!(session.rewind_snapshots.is_none());
    // Other sections (health, parse diagnostics) are still present as expected
    assert!(session.available_sections.contains(&SectionId::Health));
}

#[test]
fn export_skips_checkpoints_on_unreadable_index() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("workspace.yaml"), full_workspace_yaml()).unwrap();

    // Make checkpoints/index.md a directory — reading it as a file causes an I/O error
    let cp_index_path = dir.path().join("checkpoints").join("index.md");
    fs::create_dir_all(&cp_index_path).unwrap();

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    // Export must succeed and the broken section must be absent
    assert!(!session.available_sections.contains(&SectionId::Checkpoints));
    assert!(session.checkpoints.is_none());
    // Other sections are still present as expected
    assert!(session.available_sections.contains(&SectionId::Health));
}

#[test]
fn export_skips_plan_on_unreadable_file() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("workspace.yaml"), full_workspace_yaml()).unwrap();

    // Make plan.md a directory — reading it as a file causes an I/O error
    fs::create_dir_all(dir.path().join("plan.md")).unwrap();

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    // Export must succeed and the broken section must be absent
    assert!(!session.available_sections.contains(&SectionId::Plan));
    assert!(session.plan.is_none());
    // Other sections are still present as expected
    assert!(session.available_sections.contains(&SectionId::Health));
}
