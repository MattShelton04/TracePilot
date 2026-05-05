//! JSON export pipeline integration tests.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use tracepilot_export::document::*;
use tracepilot_export::options::*;
use tracepilot_export::*;
use tracepilot_test_support::fixtures::{
    full_session_temp_dir, minimal_workspace_yaml, workspace_only_temp_dir,
};

#[test]
fn export_full_session_json() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();

    assert_eq!(files.len(), 1);
    assert!(files[0].filename.starts_with("session-test-ses"));
    assert!(files[0].filename.ends_with(".tpx.json"));

    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    assert_eq!(archive.sessions.len(), 1);

    let session = &archive.sessions[0];
    assert_eq!(session.metadata.id, "test-session-id");
    assert_eq!(session.metadata.summary.as_deref(), Some("Test session"));
    assert_eq!(session.metadata.repository.as_deref(), Some("user/repo"));
}

#[test]
fn export_includes_conversation() {
    let (dir, _) = full_session_temp_dir();

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

    let first_turn = &turns[0];
    assert_eq!(first_turn.user_message.as_deref(), Some("Hello world"));
    assert!(!first_turn.assistant_messages.is_empty());
}

#[test]
fn export_includes_raw_events() {
    let (dir, _) = full_session_temp_dir();

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
    let (dir, _) = full_session_temp_dir();

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
    let (dir, _) = full_session_temp_dir();

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
    let (dir, _) = full_session_temp_dir();

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
fn export_section_filtering() {
    let (dir, _) = full_session_temp_dir();

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

    assert!(session.conversation.is_some());
    assert!(session.plan.is_some());
    assert!(session.events.is_none());
    assert!(session.checkpoints.is_none());
    assert!(session.shutdown_metrics.is_none());
}

#[test]
fn export_minimal_options() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::minimal(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert_eq!(session.metadata.id, "test-session-id");
    assert!(session.conversation.is_none());
    assert!(session.events.is_none());
    assert!(session.plan.is_none());
    assert!(session.checkpoints.is_none());
    assert!(session.available_sections.is_empty());
}

#[test]
fn export_sharing_preset() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::sharing(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert!(session.conversation.is_some());
    assert!(session.plan.is_some());
    assert!(session.shutdown_metrics.is_some());
    assert!(session.events.is_none());
    assert!(session.checkpoints.is_none());
}

#[test]
fn export_minimal_session() {
    let (dir, _) = workspace_only_temp_dir(minimal_workspace_yaml());

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

    let options = ExportOptions::all(ExportFormat::Json);
    let result = export_session(dir.path(), &options);
    assert!(result.is_err());

    let err = result.unwrap_err();
    assert!(err.to_string().contains("session not found"));
}

#[test]
fn export_header_has_correct_fields() {
    let (dir, _) = full_session_temp_dir();

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
    let (dir, _) = full_session_temp_dir();

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
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();

    let re_serialized = serde_json::to_vec_pretty(&archive).unwrap();
    let archive2: SessionArchive = serde_json::from_slice(&re_serialized).unwrap();

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
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Json);
    let preview = preview_export(dir.path(), &options, Some(500)).unwrap();

    assert!(preview.len() <= 500);
    assert!(preview.starts_with("{"));
}

#[test]
fn preview_export_returns_full_content_when_no_limit() {
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Json);
    let preview = preview_export(dir.path(), &options, None).unwrap();

    let _: serde_json::Value = serde_json::from_str(&preview).expect("should be valid JSON");
}

#[test]
fn batch_export_multiple_sessions() {
    let (dir1, _) = full_session_temp_dir();
    let dir2 = tempfile::tempdir().unwrap();
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
    let (dir, _) = full_session_temp_dir();

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert_eq!(session.metadata.event_count, Some(8));
    assert!(session.metadata.turn_count.is_some());
    assert!(session.metadata.turn_count.unwrap() > 0);
}
