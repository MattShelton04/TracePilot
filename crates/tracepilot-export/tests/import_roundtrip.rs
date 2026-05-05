//! Export/import round-trip integration tests.

use std::fs;

use tracepilot_export::import::{ConflictStrategy, ImportOptions, import_sessions, preview_import};
use tracepilot_export::options::*;
use tracepilot_export::*;
use tracepilot_test_support::fixtures::full_session_temp_dir;

#[test]
fn round_trip_export_import_preserves_metadata() {
    let (source, _) = full_session_temp_dir();
    let target = tempfile::tempdir().unwrap();

    let export_opts = ExportOptions::all(ExportFormat::Json);
    let files = export_session(source.path(), &export_opts).unwrap();
    let archive_path = target.path().join("export.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    let import_target = tempfile::tempdir().unwrap();
    let import_opts = ImportOptions::default();
    let result = import_sessions(&archive_path, import_target.path(), &import_opts).unwrap();

    assert_eq!(result.imported.len(), 1);

    let imported_dir = &result.imported[0].path;
    let yaml_content = fs::read_to_string(imported_dir.join("workspace.yaml")).unwrap();
    assert!(yaml_content.contains("test-session-id"));
    assert!(yaml_content.contains("user/repo"));
    assert!(yaml_content.contains("imported_from"));
}

#[test]
fn round_trip_preserves_events() {
    let (source, _) = full_session_temp_dir();
    let target = tempfile::tempdir().unwrap();

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

    let events_path = result.imported[0].path.join("events.jsonl");
    assert!(events_path.exists());
    let events_content = fs::read_to_string(&events_path).unwrap();
    let lines: Vec<&str> = events_content.lines().filter(|l| !l.is_empty()).collect();
    assert_eq!(lines.len(), 8, "should preserve all 8 events");
}

#[test]
fn round_trip_preserves_plan() {
    let (source, _) = full_session_temp_dir();
    let target = tempfile::tempdir().unwrap();

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
    let (source, _) = full_session_temp_dir();
    let target = tempfile::tempdir().unwrap();

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
    let (source, _) = full_session_temp_dir();
    let target = tempfile::tempdir().unwrap();

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
    let (source, _) = full_session_temp_dir();
    let target = tempfile::tempdir().unwrap();

    let export_opts = ExportOptions::all(ExportFormat::Json);
    let files = export_session(source.path(), &export_opts).unwrap();
    let archive_path = target.path().join("export.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    let import_target = tempfile::tempdir().unwrap();
    import_sessions(
        &archive_path,
        import_target.path(),
        &ImportOptions::default(),
    )
    .unwrap();

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
    let (source, _) = full_session_temp_dir();
    let target = tempfile::tempdir().unwrap();

    let export_opts = ExportOptions::all(ExportFormat::Json);
    let files = export_session(source.path(), &export_opts).unwrap();
    let archive_path = target.path().join("export.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    let import_target = tempfile::tempdir().unwrap();
    import_sessions(
        &archive_path,
        import_target.path(),
        &ImportOptions::default(),
    )
    .unwrap();

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
    let (source, _) = full_session_temp_dir();
    let target = tempfile::tempdir().unwrap();

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
