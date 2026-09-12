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
fn round_trip_verifies_hash_with_custom_table_rows() {
    let (source, _) = full_session_temp_dir();
    let source_db = rusqlite::Connection::open(source.path().join("session.db")).unwrap();
    source_db
        .execute_batch(
            "CREATE TABLE audit_metrics (name TEXT, count INTEGER, ratio REAL, note TEXT);
             INSERT INTO audit_metrics VALUES ('keyboard', 4, 2.0, 'Unicode: 日本語');
             INSERT INTO audit_metrics VALUES ('overflow', 8, 0.125, 'quote: \" and slash: \\  two spaces');",
        )
        .unwrap();
    // Several independent HashMaps make accidental matching iteration order
    // vanishingly unlikely under the old deserialize-then-hash implementation.
    for index in 0..32 {
        source_db
            .execute(
                "INSERT INTO audit_metrics VALUES (?1, ?2, 2.0, 'synthetic')",
                rusqlite::params![format!("audit-{index}"), index],
            )
            .unwrap();
    }
    drop(source_db);

    let files = export_session(source.path(), &ExportOptions::all(ExportFormat::Json)).unwrap();
    let export_target = tempfile::tempdir().unwrap();
    let archive_path = export_target.path().join("audit.tpx.json");
    fs::write(&archive_path, &files[0].content).unwrap();

    let preview = preview_import(&archive_path, None).expect("fresh export should pass its hash");
    assert!(preview.can_import);
    let parsed = tracepilot_export::import::parser::parse_archive(&archive_path).unwrap();
    let table = parsed.sessions[0]
        .custom_tables
        .as_ref()
        .unwrap()
        .iter()
        .find(|table| table.name == "audit_metrics")
        .unwrap();
    assert_eq!(table.rows.len(), 34);
    let row = table
        .rows
        .iter()
        .find(|row| row["name"] == "keyboard")
        .unwrap();
    assert_eq!(row["note"], "Unicode: 日本語");
    assert_eq!(row["ratio"], 2.0);

    let import_target = tempfile::tempdir().unwrap();
    let result = import_sessions(
        &archive_path,
        import_target.path(),
        &ImportOptions::default(),
    )
    .expect("fresh export should import without hash failures");
    assert_eq!(result.imported.len(), 1);
    assert!(result.imported[0].path.join("events.jsonl").exists());
    assert!(result.imported[0].path.join("workspace.yaml").exists());

    // CRLF and compact whitespace must not change the sessions hash. Preserve
    // object order and numeric spelling from the original exported document.
    let text = String::from_utf8(files[0].content.clone()).unwrap();
    for reformatted in [
        text.replace('\n', "\r\n"),
        text.lines().map(str::trim).collect::<String>(),
    ] {
        fs::write(&archive_path, reformatted).unwrap();
        assert!(preview_import(&archive_path, None).unwrap().can_import);
    }

    fs::write(
        &archive_path,
        text.replace("Unicode: 日本語", "changed payload"),
    )
    .unwrap();
    let error = preview_import(&archive_path, None).unwrap_err().to_string();
    assert!(error.contains("content hash mismatch"), "{error}");
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
