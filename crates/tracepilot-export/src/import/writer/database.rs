use std::path::Path;

use rusqlite::Connection;

use crate::document::TodoExport;
use crate::error::{ExportError, Result};

pub(super) fn write_session_db(todos: &TodoExport, dir: &Path) -> Result<()> {
    let db_path = dir.join("session.db");
    let conn = Connection::open(&db_path).map_err(|e| ExportError::SessionData {
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

    // Insert todos + deps in a single transaction
    conn.execute_batch("BEGIN")
        .map_err(|e| ExportError::SessionData {
            message: format!("failed to begin transaction: {}", e),
        })?;

    let insert_result = (|| -> std::result::Result<(), ExportError> {
        {
            let mut stmt = conn
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
        }

        {
            let mut dep_stmt = conn
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
        }

        Ok(())
    })();

    match insert_result {
        Ok(()) => {
            conn.execute_batch("COMMIT")
                .map_err(|e| ExportError::SessionData {
                    message: format!("failed to commit transaction: {}", e),
                })?;
        }
        Err(e) => {
            if let Err(rb_err) = conn.execute_batch("ROLLBACK") {
                tracing::warn!(error = %rb_err, "ROLLBACK during session import failed");
            }
            return Err(e);
        }
    }

    Ok(())
}
