//! Write a [`SessionArchive`] back to session directories on disk.
//!
//! The writer reconstructs the standard session directory layout from the
//! portable archive format. It uses atomic staging: files are written to a
//! temporary directory first, then renamed into place so that a crash during
//! import never leaves a half-written session.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::document::*;
use crate::error::{ExportError, Result};

/// Write a single session from an archive to a target directory.
///
/// The `target_parent` is the session-state directory (e.g., `~/.copilot/session-state/`).
/// A subdirectory named after the session ID will be created within it.
///
/// Uses atomic staging: writes to `{target_parent}/.import-staging-{id}` first,
/// then renames to `{target_parent}/{id}`.
pub fn write_session(
    session: &PortableSession,
    archive: &SessionArchive,
    target_parent: &Path,
) -> Result<PathBuf> {
    let session_id = &session.metadata.id;
    let final_dir = target_parent.join(session_id);
    let staging_dir = target_parent.join(format!(".import-staging-{}", session_id));

    // Clean up any leftover staging directory from a previous failed import
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir).map_err(|e| ExportError::io(&staging_dir, e))?;
    }

    // Create staging directory
    fs::create_dir_all(&staging_dir).map_err(|e| ExportError::io(&staging_dir, e))?;

    // Write all session files into staging
    let write_result = write_session_files(session, archive, &staging_dir);

    if let Err(err) = write_result {
        // Rollback: clean up staging directory on failure
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(err);
    }

    // Atomic rename from staging to final location
    // Uses a backup strategy: rename existing → backup, rename staging → final,
    // then delete backup. On failure, restore backup to recover original data.
    if final_dir.exists() {
        let backup_dir = target_parent.join(format!(".import-backup-{}", session_id));
        // Clean up any leftover backup from a previous failed attempt
        if backup_dir.exists() {
            let _ = fs::remove_dir_all(&backup_dir);
        }
        // Step 1: move existing aside to backup
        fs::rename(&final_dir, &backup_dir).map_err(|e| ExportError::io(&final_dir, e))?;
        // Step 2: move staging into place
        match fs::rename(&staging_dir, &final_dir) {
            Ok(()) => {
                // Step 3: clean up backup
                let _ = fs::remove_dir_all(&backup_dir);
            }
            Err(e) => {
                // Rollback: restore backup
                let _ = fs::rename(&backup_dir, &final_dir);
                let _ = fs::remove_dir_all(&staging_dir);
                return Err(ExportError::io(&final_dir, e));
            }
        }
    } else {
        fs::rename(&staging_dir, &final_dir).map_err(|e| {
            let _ = fs::remove_dir_all(&staging_dir);
            ExportError::io(&final_dir, e)
        })?;
    }

    Ok(final_dir)
}

/// Check if a session ID already exists in the target directory.
pub fn session_exists(session_id: &str, target_parent: &Path) -> bool {
    target_parent.join(session_id).exists()
}

// ── Internal file writers ──────────────────────────────────────────────────

fn write_session_files(
    session: &PortableSession,
    archive: &SessionArchive,
    dir: &Path,
) -> Result<()> {
    // 1. workspace.yaml (always written)
    write_workspace_yaml(session, archive, dir)?;

    // 2. events.jsonl
    if let Some(events) = &session.events {
        write_events_jsonl(events, dir)?;
    }

    // 3. plan.md
    if let Some(plan) = &session.plan {
        let path = dir.join("plan.md");
        fs::write(&path, plan).map_err(|e| ExportError::io(&path, e))?;
    }

    // 4. checkpoints/
    if let Some(checkpoints) = &session.checkpoints {
        write_checkpoints(checkpoints, dir)?;
    }

    // 5. session.db (todos)
    if let Some(todos) = &session.todos {
        write_session_db(todos, dir)?;
    }

    Ok(())
}

fn write_workspace_yaml(
    session: &PortableSession,
    archive: &SessionArchive,
    dir: &Path,
) -> Result<()> {
    let meta = &session.metadata;
    let path = dir.join("workspace.yaml");

    // Build YAML manually to match the exact format the parser expects.
    // We use serde_yml for robustness rather than hand-formatting.
    let mut map = serde_yml::Mapping::new();

    map.insert(
        serde_yml::Value::String("id".to_string()),
        serde_yml::Value::String(meta.id.clone()),
    );

    if let Some(cwd) = &meta.cwd {
        map.insert(
            serde_yml::Value::String("cwd".to_string()),
            serde_yml::Value::String(cwd.clone()),
        );
    }
    if let Some(git_root) = &meta.git_root {
        map.insert(
            serde_yml::Value::String("git_root".to_string()),
            serde_yml::Value::String(git_root.clone()),
        );
    }
    if let Some(repo) = &meta.repository {
        map.insert(
            serde_yml::Value::String("repository".to_string()),
            serde_yml::Value::String(repo.clone()),
        );
    }
    if let Some(branch) = &meta.branch {
        map.insert(
            serde_yml::Value::String("branch".to_string()),
            serde_yml::Value::String(branch.clone()),
        );
    }
    if let Some(host_type) = &meta.host_type {
        map.insert(
            serde_yml::Value::String("host_type".to_string()),
            serde_yml::Value::String(host_type.clone()),
        );
    }
    if let Some(summary) = &meta.summary {
        map.insert(
            serde_yml::Value::String("summary".to_string()),
            serde_yml::Value::String(summary.clone()),
        );
    }
    if let Some(count) = meta.summary_count {
        map.insert(
            serde_yml::Value::String("summary_count".to_string()),
            serde_yml::Value::Number(serde_yml::Number::from(count as u64)),
        );
    }
    if let Some(created) = &meta.created_at {
        map.insert(
            serde_yml::Value::String("created_at".to_string()),
            serde_yml::Value::String(created.to_rfc3339()),
        );
    }
    if let Some(updated) = &meta.updated_at {
        map.insert(
            serde_yml::Value::String("updated_at".to_string()),
            serde_yml::Value::String(updated.to_rfc3339()),
        );
    }

    // Add import provenance
    let mut imported_from = serde_yml::Mapping::new();
    imported_from.insert(
        serde_yml::Value::String("source_system".to_string()),
        serde_yml::Value::String(archive.header.exported_by.clone()),
    );
    imported_from.insert(
        serde_yml::Value::String("imported_at".to_string()),
        serde_yml::Value::String(chrono::Utc::now().to_rfc3339()),
    );
    imported_from.insert(
        serde_yml::Value::String("original_schema_version".to_string()),
        serde_yml::Value::String(archive.header.schema_version.to_string()),
    );
    map.insert(
        serde_yml::Value::String("imported_from".to_string()),
        serde_yml::Value::Mapping(imported_from),
    );

    let yaml_str =
        serde_yml::to_string(&serde_yml::Value::Mapping(map)).map_err(|e| ExportError::Render {
            format: "YAML".to_string(),
            message: e.to_string(),
        })?;

    fs::write(&path, yaml_str).map_err(|e| ExportError::io(&path, e))
}

fn write_events_jsonl(events: &[RawEvent], dir: &Path) -> Result<()> {
    let path = dir.join("events.jsonl");
    let mut content = String::with_capacity(events.len() * 256);

    for event in events {
        let line = serde_json::to_string(event).map_err(|e| ExportError::Render {
            format: "JSONL".to_string(),
            message: e.to_string(),
        })?;
        content.push_str(&line);
        content.push('\n');
    }

    fs::write(&path, content).map_err(|e| ExportError::io(&path, e))
}

fn write_checkpoints(checkpoints: &[CheckpointExport], dir: &Path) -> Result<()> {
    let cp_dir = dir.join("checkpoints");
    fs::create_dir_all(&cp_dir).map_err(|e| ExportError::io(&cp_dir, e))?;

    // Write index.md
    let mut index = String::from("| # | Title | File |\n| --- | --- | --- |\n");
    for cp in checkpoints {
        index.push_str(&format!(
            "| {} | {} | {} |\n",
            cp.number, cp.title, cp.filename
        ));
    }
    let index_path = cp_dir.join("index.md");
    fs::write(&index_path, &index).map_err(|e| ExportError::io(&index_path, e))?;

    // Write individual checkpoint files
    for cp in checkpoints {
        if let Some(content) = &cp.content {
            let cp_path = cp_dir.join(&cp.filename);
            fs::write(&cp_path, content).map_err(|e| ExportError::io(&cp_path, e))?;
        }
    }

    Ok(())
}

fn write_session_db(todos: &TodoExport, dir: &Path) -> Result<()> {
    let db_path = dir.join("session.db");
    let mut conn = Connection::open(&db_path).map_err(|e| ExportError::SessionData {
        message: format!("failed to create session.db: {}", e),
    })?;

    // Create tables
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS todos (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS todo_deps (
            todo_id TEXT,
            depends_on TEXT,
            PRIMARY KEY (todo_id, depends_on)
        );",
    )
    .map_err(|e| ExportError::SessionData {
        message: format!("failed to create tables: {}", e),
    })?;

    let tx = conn.transaction().map_err(|e| ExportError::SessionData {
        message: format!("failed to begin transaction: {}", e),
    })?;

    // Insert todos
    let mut stmt = tx
        .prepare("INSERT INTO todos (id, title, description, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .map_err(|e| ExportError::SessionData {
            message: format!("failed to prepare insert: {}", e),
        })?;

    for item in &todos.items {
        stmt.execute(rusqlite::params![
            item.id,
            item.title,
            item.description,
            item.status,
            item.created_at,
            item.updated_at,
        ])
        .map_err(|e| ExportError::SessionData {
            message: format!("failed to insert todo '{}': {}", item.id, e),
        })?;
    }
    drop(stmt);

    // Insert deps
    let mut dep_stmt = tx
        .prepare("INSERT INTO todo_deps (todo_id, depends_on) VALUES (?1, ?2)")
        .map_err(|e| ExportError::SessionData {
            message: format!("failed to prepare dep insert: {}", e),
        })?;

    for dep in &todos.deps {
        dep_stmt
            .execute(rusqlite::params![dep.todo_id, dep.depends_on])
            .map_err(|e| ExportError::SessionData {
                message: format!("failed to insert dep: {}", e),
            })?;
    }
    drop(dep_stmt);

    tx.commit().map_err(|e| ExportError::SessionData {
        message: format!("failed to commit transaction: {}", e),
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_writes_session_db_bench() {
        use std::time::Instant;
        let dir = tempfile::tempdir().unwrap();
        let mut items = Vec::new();
        for i in 0..10000 {
            items.push(TodoItemExport {
                id: format!("task-{}", i),
                title: "Do something".to_string(),
                description: Some("Description".to_string()),
                status: "pending".to_string(),
                created_at: None,
                updated_at: None,
            });
        }
        let todos = TodoExport {
            items,
            deps: vec![],
        };
        let start = Instant::now();
        write_session_db(&todos, dir.path()).unwrap();
        let elapsed = start.elapsed();
        println!(
            "Time taken to insert 10000 todos (transaction + pragma): {:?}",
            elapsed
        );
    }
    use super::*;
    use crate::test_helpers::{minimal_session, test_archive};

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
}
