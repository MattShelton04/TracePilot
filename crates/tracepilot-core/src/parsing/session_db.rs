//! Parser for `session.db` — the SQLite database containing todos and custom tables.
//!
//! This module uses shared SQLite utilities from `crate::utils::sqlite` for
//! consistent connection handling and error management across the codebase.

use crate::error::Result;
use crate::utils::sqlite::{open_readonly_if_exists, table_exists};
use serde::Serialize;
use std::path::Path;

/// A todo item from the `todos` table.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// A dependency edge from the `todo_deps` table.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoDep {
    pub todo_id: String,
    pub depends_on: String,
}

/// Schema and rows for an arbitrary table discovered at runtime.
///
/// `rows` is a parallel array to `columns`: each inner `Vec` contains one
/// value per column in the same order as `columns`. This matches the
/// `SessionDbTable` TypeScript interface on the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTableInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

/// Read all todo items from a session database (opened read-only).
/// Returns an empty list if the database file does not exist.
pub fn read_todos(db_path: &Path) -> Result<Vec<TodoItem>> {
    let Some(conn) = open_readonly_if_exists(db_path)? else {
        return Ok(Vec::new());
    };

    if !table_exists(&conn, "todos")? {
        return Ok(Vec::new());
    }

    let mut stmt =
        conn.prepare("SELECT id, title, description, status, created_at, updated_at FROM todos")?;

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
/// Returns an empty list if the database file does not exist.
pub fn read_todo_deps(db_path: &Path) -> Result<Vec<TodoDep>> {
    let Some(conn) = open_readonly_if_exists(db_path)? else {
        return Ok(Vec::new());
    };

    if !table_exists(&conn, "todo_deps")? {
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
/// Returns an empty list if the database file does not exist.
pub fn list_tables(db_path: &Path) -> Result<Vec<String>> {
    let Some(conn) = open_readonly_if_exists(db_path)? else {
        return Ok(Vec::new());
    };

    let mut stmt =
        conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?;
    let tables = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(tables)
}

/// Read all rows from a custom table, using `PRAGMA table_info` for schema discovery.
///
/// SQLite values are converted to `serde_json::Value`:
/// - TEXT → String
/// - INTEGER → Number
/// - REAL → Number
/// - NULL → Null
/// - BLOB → skipped (set to Null)
pub fn read_custom_table(db_path: &Path, table_name: &str) -> Result<CustomTableInfo> {
    let Some(conn) = open_readonly_if_exists(db_path)? else {
        return Ok(CustomTableInfo {
            name: table_name.to_string(),
            columns: Vec::new(),
            rows: Vec::new(),
        });
    };

    if !table_exists(&conn, table_name)? {
        return Ok(CustomTableInfo {
            name: table_name.to_string(),
            columns: Vec::new(),
            rows: Vec::new(),
        });
    }

    // Discover columns via PRAGMA — escape table name for safe SQL interpolation
    let safe_name = table_name.replace('"', "\"\"");
    let mut pragma_stmt = conn.prepare(&format!("PRAGMA table_info(\"{}\")", safe_name))?;
    let columns: Vec<String> = pragma_stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    // Read all rows — build each row as an ordered Vec aligned to `columns`.
    let mut select_stmt = conn.prepare(&format!("SELECT * FROM \"{}\"", safe_name))?;
    let mut rows = Vec::new();

    let mut result_rows = select_stmt.query([])?;
    while let Some(row) = result_rows.next()? {
        let row_values: Vec<serde_json::Value> = (0..columns.len())
            .map(|i| sqlite_value_to_json(row, i))
            .collect();
        rows.push(row_values);
    }

    Ok(CustomTableInfo {
        name: table_name.to_string(),
        columns,
        rows,
    })
}

/// Convert a SQLite column value to a serde_json::Value.
fn sqlite_value_to_json(row: &rusqlite::Row<'_>, idx: usize) -> serde_json::Value {
    use rusqlite::types::ValueRef;
    match row.get_ref(idx) {
        Ok(ValueRef::Null) => serde_json::Value::Null,
        Ok(ValueRef::Integer(i)) => serde_json::Value::Number(i.into()),
        Ok(ValueRef::Real(f)) => serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Ok(ValueRef::Text(t)) => serde_json::Value::String(String::from_utf8_lossy(t).into_owned()),
        Ok(ValueRef::Blob(_)) => serde_json::Value::Null, // skip blobs
        Err(_) => serde_json::Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Helper: create a temporary SQLite database and return its path.
    fn create_test_db(dir: &tempfile::TempDir) -> std::path::PathBuf {
        let db_path = dir.path().join("session.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE todos (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT,
                updated_at TEXT
            );
            INSERT INTO todos (id, title, description, status) VALUES ('t1', 'Fix bug', 'Fix the login bug', 'done');
            INSERT INTO todos (id, title, status) VALUES ('t2', 'Add tests', 'pending');

            CREATE TABLE todo_deps (todo_id TEXT, depends_on TEXT, PRIMARY KEY (todo_id, depends_on));
            INSERT INTO todo_deps VALUES ('t2', 't1');
            "
        ).unwrap();
        db_path
    }

    #[test]
    fn test_read_todos_from_db() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = create_test_db(&dir);
        let todos = read_todos(&db_path).unwrap();
        assert_eq!(todos.len(), 2);
        assert_eq!(todos[0].id, "t1");
        assert_eq!(todos[0].title, "Fix bug");
        assert_eq!(todos[0].status, "done");
        assert_eq!(todos[0].description.as_deref(), Some("Fix the login bug"));
        assert_eq!(todos[1].id, "t2");
        assert_eq!(todos[1].status, "pending");
    }

    #[test]
    fn test_list_tables() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = create_test_db(&dir);
        let tables = list_tables(&db_path).unwrap();
        assert!(tables.contains(&"todos".to_string()));
        assert!(tables.contains(&"todo_deps".to_string()));
    }

    #[test]
    fn test_read_custom_table() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("custom.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE metrics (
                name TEXT,
                value REAL,
                count INTEGER
            );
            INSERT INTO metrics VALUES ('latency', 42.5, 100);
            INSERT INTO metrics VALUES ('throughput', 1000.0, 50);
            INSERT INTO metrics VALUES ('nullcheck', NULL, NULL);
            ",
        )
        .unwrap();
        drop(conn);

        let info = read_custom_table(&db_path, "metrics").unwrap();
        assert_eq!(info.name, "metrics");
        assert_eq!(info.columns, vec!["name", "value", "count"]);
        assert_eq!(info.rows.len(), 3);

        // Rows are ordered vecs aligned to columns: [name, value, count]
        assert_eq!(
            info.rows[0][0],
            serde_json::Value::String("latency".to_string())
        );
        assert_eq!(info.rows[0][2], serde_json::json!(100));

        // Check real value
        let val = info.rows[0][1].as_f64().unwrap();
        assert!((val - 42.5).abs() < f64::EPSILON);

        // Null row
        assert_eq!(info.rows[2][1], serde_json::Value::Null);
        assert_eq!(info.rows[2][2], serde_json::Value::Null);
    }

    #[test]
    fn test_missing_table() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("empty.db");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("CREATE TABLE other (x TEXT);").unwrap();
        drop(conn);

        // read_todos: no todos table → empty vec
        let todos = read_todos(&db_path).unwrap();
        assert!(todos.is_empty());

        // read_custom_table: nonexistent table → empty CustomTableInfo
        let info = read_custom_table(&db_path, "nonexistent").unwrap();
        assert!(info.columns.is_empty());
        assert!(info.rows.is_empty());
    }

    #[test]
    fn test_missing_db_file() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("nonexistent.db");

        // All functions should return empty results for a missing DB file
        let todos = read_todos(&db_path).unwrap();
        assert!(todos.is_empty());

        let deps = read_todo_deps(&db_path).unwrap();
        assert!(deps.is_empty());

        let tables = list_tables(&db_path).unwrap();
        assert!(tables.is_empty());

        let info = read_custom_table(&db_path, "test").unwrap();
        assert_eq!(info.name, "test");
        assert!(info.columns.is_empty());
        assert!(info.rows.is_empty());
    }
}
