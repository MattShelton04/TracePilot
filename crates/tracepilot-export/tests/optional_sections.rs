//! Error-resilience tests for optional file-backed export sections.

use std::fs;

use tracepilot_export::document::*;
use tracepilot_export::options::*;
use tracepilot_export::*;
use tracepilot_test_support::fixtures::full_session_temp_dir;

#[test]
fn export_skips_rewind_snapshots_on_malformed_index() {
    let (dir, _) = full_session_temp_dir();

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

    assert!(
        !session
            .available_sections
            .contains(&SectionId::RewindSnapshots)
    );
    assert!(session.rewind_snapshots.is_none());
    assert!(
        session
            .available_sections
            .contains(&SectionId::ParseDiagnostics)
    );
}

#[test]
fn export_skips_checkpoints_on_unreadable_index() {
    let (dir, _) = full_session_temp_dir();

    let cp_index_path = dir.path().join("checkpoints").join("index.md");
    fs::remove_file(&cp_index_path).unwrap();
    fs::create_dir_all(&cp_index_path).unwrap();

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert!(!session.available_sections.contains(&SectionId::Checkpoints));
    assert!(session.checkpoints.is_none());
    assert!(session.available_sections.contains(&SectionId::Metrics));
}

#[test]
fn export_skips_plan_on_unreadable_file() {
    let (dir, _) = full_session_temp_dir();

    let plan_path = dir.path().join("plan.md");
    fs::remove_file(&plan_path).unwrap();
    fs::create_dir_all(plan_path).unwrap();

    let options = ExportOptions::all(ExportFormat::Json);
    let files = export_session(dir.path(), &options).unwrap();
    let archive: SessionArchive = serde_json::from_slice(&files[0].content).unwrap();
    let session = &archive.sessions[0];

    assert!(!session.available_sections.contains(&SectionId::Plan));
    assert!(session.plan.is_none());
    assert!(session.available_sections.contains(&SectionId::Metrics));
}
