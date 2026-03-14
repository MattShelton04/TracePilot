//! Parser for `session.db` — the SQLite database containing todos and custom tables.

use crate::error::{Result, TracePilotError};
use rusqlite::Connection;
use std::path::Path;

/// A todo item from the `todos` table.
#[derive(Debug, Clone)]
pub struct TodoItem {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// A dependency edge from the `todo_deps` table.
#[derive(Debug, Clone)]
pub struct TodoDep {
    pub todo_id: String,
    pub depends_on: String,
}

/// Read all todo items from a session database (opened read-only).
pub fn read_todos(db_path: &Path) -> Result<Vec<TodoItem>> {
    let conn = Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to open session db: {}", db_path.display()),
        source: Some(Box::new(e)),
    })?;

    // Check if todos table exists
    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='todos'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !table_exists {
        return Ok(Vec::new());
    }

    let mut stmt = conn.prepare(
        "SELECT id, title, description, status, created_at, updated_at FROM todos",
    )?;

    let todos = stmt
        .query_map([], |row| {
            Ok(TodoItem {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(todos)
}

/// Read all todo dependencies from a session database (opened read-only).
pub fn read_todo_deps(db_path: &Path) -> Result<Vec<TodoDep>> {
    let conn = Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to open session db: {}", db_path.display()),
        source: Some(Box::new(e)),
    })?;

    let table_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='todo_deps'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if !table_exists {
        return Ok(Vec::new());
    }

    let mut stmt = conn.prepare("SELECT todo_id, depends_on FROM todo_deps")?;
    let deps = stmt
        .query_map([], |row| {
            Ok(TodoDep {
                todo_id: row.get(0)?,
                depends_on: row.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(deps)
}

/// List all table names in a session database (opened read-only).
pub fn list_tables(db_path: &Path) -> Result<Vec<String>> {
    let conn = Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| TracePilotError::ParseError {
        context: format!("Failed to open session db: {}", db_path.display()),
        source: Some(Box::new(e)),
    })?;

    let mut stmt =
        conn.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")?;
    let tables = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(tables)
}
