use super::*;
use crate::test_helpers::{minimal_session, test_archive};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use super::duplicate::generate_duplicate_id_with;

fn write_test_archive(dir: &Path) -> PathBuf {
    let archive = test_archive(minimal_session());
    let json = serde_json::to_string_pretty(&archive).unwrap();
    let path = dir.join("test.tpx.json");
    fs::write(&path, json).unwrap();
    path
}

#[test]
fn preview_reports_session_count() {
    let dir = tempfile::tempdir().unwrap();
    let archive_path = write_test_archive(dir.path());

    let preview = preview_import(&archive_path, None).unwrap();
    assert_eq!(preview.session_count, 1);
    assert!(preview.can_import);
}

#[test]
fn preview_detects_existing_session() {
    let dir = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let archive_path = write_test_archive(dir.path());

    // Create the session directory so it "exists"
    fs::create_dir_all(target.path().join("test-12345678")).unwrap();

    let preview = preview_import(&archive_path, Some(target.path())).unwrap();
    assert!(preview.sessions[0].already_exists);
}

#[test]
fn import_creates_session_directory() {
    let dir = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let archive_path = write_test_archive(dir.path());

    let options = ImportOptions::default();
    let result = import_sessions(&archive_path, target.path(), &options).unwrap();

    assert_eq!(result.imported.len(), 1);
    assert_eq!(result.imported[0].id, "test-12345678");
    assert!(result.imported[0].path.exists());
    assert!(result.imported[0].path.join("workspace.yaml").exists());
}

#[test]
fn import_skip_existing() {
    let dir = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let archive_path = write_test_archive(dir.path());

    // Pre-create the session directory
    fs::create_dir_all(target.path().join("test-12345678")).unwrap();
    fs::write(
        target.path().join("test-12345678").join("workspace.yaml"),
        "id: test-12345678\n",
    )
    .unwrap();

    let options = ImportOptions {
        conflict_strategy: ConflictStrategy::Skip,
        ..Default::default()
    };
    let result = import_sessions(&archive_path, target.path(), &options).unwrap();

    assert_eq!(result.imported.len(), 0);
    assert_eq!(result.skipped.len(), 1);
}

#[test]
fn import_replace_existing() {
    let dir = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let archive_path = write_test_archive(dir.path());

    // Pre-create with old content
    let existing = target.path().join("test-12345678");
    fs::create_dir_all(&existing).unwrap();
    fs::write(existing.join("workspace.yaml"), "id: old\n").unwrap();

    let options = ImportOptions {
        conflict_strategy: ConflictStrategy::Replace,
        ..Default::default()
    };
    let result = import_sessions(&archive_path, target.path(), &options).unwrap();

    assert_eq!(result.imported.len(), 1);
    // Verify new content
    let yaml = fs::read_to_string(existing.join("workspace.yaml")).unwrap();
    assert!(yaml.contains("test-12345678"));
}

#[test]
fn import_duplicate_creates_new_id() {
    let dir = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let archive_path = write_test_archive(dir.path());

    // Pre-create existing
    let existing_dir = target.path().join("test-12345678");
    fs::create_dir_all(&existing_dir).unwrap();
    fs::write(existing_dir.join("workspace.yaml"), "id: test-12345678\n").unwrap();

    let options = ImportOptions {
        conflict_strategy: ConflictStrategy::Duplicate,
        ..Default::default()
    };
    let result = import_sessions(&archive_path, target.path(), &options).unwrap();

    assert_eq!(result.imported.len(), 1);
    assert!(result.imported[0].was_duplicate);
    // New ID should be a fresh UUID, different from the original
    assert_ne!(result.imported[0].id, "test-12345678");
    // Validate it looks like a UUID (8-4-4-4-12 hex format)
    assert_eq!(result.imported[0].id.len(), 36);
    assert!(
        result.imported[0]
            .id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    );
    assert_eq!(
        result.imported[0]
            .path
            .file_name()
            .unwrap()
            .to_string_lossy(),
        result.imported[0].id
    );

    let yaml = fs::read_to_string(result.imported[0].path.join("workspace.yaml")).unwrap();
    let parsed: serde_yml::Value = serde_yml::from_str(&yaml).unwrap();
    assert_eq!(parsed["id"].as_str(), Some(result.imported[0].id.as_str()));

    let existing_yaml = fs::read_to_string(existing_dir.join("workspace.yaml")).unwrap();
    assert_eq!(existing_yaml, "id: test-12345678\n");
}

#[test]
fn import_with_session_filter() {
    let dir = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let archive_path = write_test_archive(dir.path());

    let options = ImportOptions {
        session_filter: vec!["nonexistent-id".to_string()],
        ..Default::default()
    };
    let result = import_sessions(&archive_path, target.path(), &options).unwrap();

    assert_eq!(result.imported.len(), 0);
    assert_eq!(result.skipped.len(), 1);
}

#[test]
fn dry_run_does_not_write() {
    let dir = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let archive_path = write_test_archive(dir.path());

    let options = ImportOptions {
        dry_run: true,
        ..Default::default()
    };
    let result = import_sessions(&archive_path, target.path(), &options).unwrap();

    assert_eq!(result.imported.len(), 0);
    assert!(!target.path().join("test-12345678").exists());
}

#[test]
fn preview_path_traversal_id_does_not_probe_filesystem() {
    let dir = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();

    // Build an archive with a path-traversal session ID
    let mut session = minimal_session();
    session.metadata.id = "../../../etc/passwd".to_string();
    let archive = test_archive(session);
    let json = serde_json::to_string_pretty(&archive).unwrap();
    let path = dir.path().join("malicious.tpx.json");
    fs::write(&path, json).unwrap();

    let preview = preview_import(&path, Some(target.path())).unwrap();
    // The malicious ID should NOT have triggered a filesystem probe
    assert!(!preview.sessions[0].already_exists);
    assert!(!preview.can_import);
}

#[test]
fn duplicate_id_generation_retries_existing_candidate() {
    let target = tempfile::tempdir().unwrap();
    fs::create_dir_all(target.path().join("collision-id")).unwrap();
    let reserved = HashSet::new();

    let generated = generate_duplicate_id_with(target.path(), &reserved, {
        let mut ids = ["collision-id".to_string(), "fresh-id".to_string()].into_iter();
        move || ids.next().unwrap()
    })
    .unwrap();

    assert_eq!(generated, "fresh-id");
}

#[test]
fn duplicate_id_generation_retries_reserved_candidate() {
    let target = tempfile::tempdir().unwrap();
    let reserved = HashSet::from(["reserved-id".to_string()]);

    let generated = generate_duplicate_id_with(target.path(), &reserved, {
        let mut ids = ["reserved-id".to_string(), "fresh-id".to_string()].into_iter();
        move || ids.next().unwrap()
    })
    .unwrap();

    assert_eq!(generated, "fresh-id");
}

#[test]
fn duplicate_id_generation_retries_reserved_and_existing_candidates() {
    let target = tempfile::tempdir().unwrap();
    fs::create_dir_all(target.path().join("existing-id")).unwrap();
    let reserved = HashSet::from(["reserved-id".to_string()]);

    let generated = generate_duplicate_id_with(target.path(), &reserved, {
        let mut ids = [
            "reserved-id".to_string(),
            "existing-id".to_string(),
            "fresh-id".to_string(),
        ]
        .into_iter();
        move || ids.next().unwrap()
    })
    .unwrap();

    assert_eq!(generated, "fresh-id");
}

#[test]
fn duplicate_id_generation_errors_after_too_many_conflicts() {
    let target = tempfile::tempdir().unwrap();
    let reserved = HashSet::from(["collision-id".to_string()]);

    let err = generate_duplicate_id_with(target.path(), &reserved, || "collision-id".to_string())
        .unwrap_err();

    assert!(
        err.to_string()
            .contains("failed to allocate a unique duplicate session ID")
    );
}
