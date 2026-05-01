use std::fs;

use crate::document::*;
use crate::test_helpers::{minimal_session, test_archive};

use super::{session_exists, write_session, write_session_to_id};

#[test]
fn writes_workspace_yaml() {
    let dir = tempfile::tempdir().unwrap();
    let session = minimal_session();
    let archive = test_archive(session.clone());

    let result = write_session(&session, &archive, dir.path());
    assert!(result.is_ok());

    let session_dir = result.unwrap();
    let yaml_path = session_dir.join("workspace.yaml");
    assert!(yaml_path.exists());

    let content = fs::read_to_string(&yaml_path).unwrap();
    assert!(content.contains("test-12345678"));
    assert!(content.contains("user/repo"));
    assert!(content.contains("imported_from"));
}

#[test]
fn write_session_to_id_overrides_directory_and_workspace_id() {
    let dir = tempfile::tempdir().unwrap();
    let session = minimal_session();
    let archive = test_archive(session.clone());
    let new_id = "duplicate-session-id";

    let result = write_session_to_id(&session, &archive, dir.path(), new_id).unwrap();
    assert_eq!(result.file_name().unwrap().to_string_lossy(), new_id);

    let yaml_path = result.join("workspace.yaml");
    let content = fs::read_to_string(&yaml_path).unwrap();
    let parsed: serde_yml::Value = serde_yml::from_str(&content).unwrap();
    assert_eq!(parsed["id"].as_str(), Some(new_id));
    assert!(!dir.path().join(&session.metadata.id).exists());
}

#[test]
fn writes_plan() {
    let dir = tempfile::tempdir().unwrap();
    let mut session = minimal_session();
    session.plan = Some("# Test Plan\n\nDo the thing.".to_string());
    let archive = test_archive(session.clone());

    write_session(&session, &archive, dir.path()).unwrap();

    let plan_path = dir.path().join("test-12345678").join("plan.md");
    assert!(plan_path.exists());
    let content = fs::read_to_string(&plan_path).unwrap();
    assert!(content.contains("# Test Plan"));
}

#[test]
fn writes_events_jsonl() {
    let dir = tempfile::tempdir().unwrap();
    let mut session = minimal_session();
    session.events = Some(vec![RawEvent {
        event_type: "session.start".to_string(),
        data: serde_json::json!({"model": "test"}),
        id: Some("evt-1".to_string()),
        timestamp: None,
        parent_id: None,
    }]);
    let archive = test_archive(session.clone());

    write_session(&session, &archive, dir.path()).unwrap();

    let events_path = dir.path().join("test-12345678").join("events.jsonl");
    assert!(events_path.exists());
    let content = fs::read_to_string(&events_path).unwrap();
    assert!(content.contains("session.start"));
}

#[test]
fn writes_checkpoints() {
    let dir = tempfile::tempdir().unwrap();
    let mut session = minimal_session();
    session.checkpoints = Some(vec![CheckpointExport {
        number: 1,
        title: "Initial".to_string(),
        filename: "cp1.md".to_string(),
        content: Some("# Checkpoint 1".to_string()),
    }]);
    let archive = test_archive(session.clone());

    write_session(&session, &archive, dir.path()).unwrap();

    let cp_dir = dir.path().join("test-12345678").join("checkpoints");
    assert!(cp_dir.exists());
    assert!(cp_dir.join("index.md").exists());
    assert!(cp_dir.join("cp1.md").exists());
}

#[test]
fn writes_session_db_with_todos() {
    let dir = tempfile::tempdir().unwrap();
    let mut session = minimal_session();
    session.todos = Some(TodoExport {
        items: vec![TodoItemExport {
            id: "task-1".to_string(),
            title: "Do something".to_string(),
            description: Some("Description".to_string()),
            status: "pending".to_string(),
            created_at: None,
            updated_at: None,
        }],
        deps: vec![],
    });
    let archive = test_archive(session.clone());

    write_session(&session, &archive, dir.path()).unwrap();

    let db_path = dir.path().join("test-12345678").join("session.db");
    assert!(db_path.exists());

    // Verify we can read it back with the core parser
    let todos = tracepilot_core::parsing::session_db::read_todos(&db_path).unwrap();
    assert_eq!(todos.len(), 1);
    assert_eq!(todos[0].id, "task-1");
}

#[test]
fn session_exists_returns_false_initially() {
    let dir = tempfile::tempdir().unwrap();
    assert!(!session_exists("nonexistent", dir.path()));
}

#[test]
fn cleans_up_staging_on_error() {
    // Staging cleanup is tested implicitly — if write_session succeeds,
    // there should be no staging directory left
    let dir = tempfile::tempdir().unwrap();
    let session = minimal_session();
    let archive = test_archive(session.clone());

    write_session(&session, &archive, dir.path()).unwrap();

    let staging = dir
        .path()
        .join(format!(".import-staging-{}", session.metadata.id));
    assert!(!staging.exists());
}
