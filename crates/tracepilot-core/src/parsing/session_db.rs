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
    /// Column schema (names, types, PK, nullability, defaults) from `PRAGMA table_info`.
    pub column_info: Vec<ColumnSchema>,
    /// Index metadata from `PRAGMA index_list` + `PRAGMA index_info`.
    pub indexes: Vec<IndexSchema>,
}

/// A single column's schema metadata, sourced from `PRAGMA table_info`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSchema {
    pub name: String,
    /// Declared type (may be empty for typeless columns).
    pub type_name: String,
    /// True when `NOT NULL` was declared.
    pub notnull: bool,
    /// Primary-key position (0 if not a PK column; 1-based otherwise for composite PKs).
    pub pk: i64,
    /// Declared default expression, if any.
    pub default_value: Option<String>,
}

/// Index metadata from `PRAGMA index_list` + `PRAGMA index_info`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSchema {
    pub name: String,
    pub unique: bool,
    /// Column names the index covers, in index order.
    pub columns: Vec<String>,
}

/// Read all todo items from a session database (opened read-only).
/// Returns an empty list if the database file does not exist.
pub fn read_todos(db_path: &Path) -> Result<Vec<TodoItem>> {
    let Some(conn) = open_readonly_if_exists(db_path)? else {
        return Ok(Vec::new());
    };

    if !table_exists(&conn, "todos") {
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

    if !table_exists(&conn, "todo_deps") {
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
    read_custom_table_inner(db_path, table_name, None)
}

/// Read a bounded preview of a custom table for interactive UI display.
///
/// Limits are applied by SQLite and while decoding cells, so a table with
/// millions of rows or unusually large TEXT values never has to be fully
/// materialized before the caller can truncate it.
pub fn read_custom_table_bounded(
    db_path: &Path,
    table_name: &str,
    max_rows: usize,
    max_columns: usize,
    max_text_bytes: usize,
    max_total_text_bytes: usize,
) -> Result<CustomTableInfo> {
    read_custom_table_inner(
        db_path,
        table_name,
        Some((max_rows, max_columns, max_text_bytes, max_total_text_bytes)),
    )
}

fn read_custom_table_inner(
    db_path: &Path,
    table_name: &str,
    limits: Option<(usize, usize, usize, usize)>,
) -> Result<CustomTableInfo> {
    let Some(conn) = open_readonly_if_exists(db_path)? else {
        return Ok(CustomTableInfo {
            name: table_name.to_string(),
            columns: Vec::new(),
            rows: Vec::new(),
            column_info: Vec::new(),
            indexes: Vec::new(),
        });
    };

    if !table_exists(&conn, table_name) {
        return Ok(CustomTableInfo {
            name: table_name.to_string(),
            columns: Vec::new(),
            rows: Vec::new(),
            column_info: Vec::new(),
            indexes: Vec::new(),
        });
    }

    // Discover columns via PRAGMA — escape table name for safe SQL interpolation
    let safe_name = table_name.replace('"', "\"\"");
    let mut pragma_stmt = conn.prepare(&format!("PRAGMA table_info(\"{}\")", safe_name))?;
    // PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
    let mut column_info: Vec<ColumnSchema> = pragma_stmt
        .query_map([], |row| {
            Ok(ColumnSchema {
                name: row.get::<_, String>(1)?,
                type_name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                notnull: row.get::<_, i64>(3)? != 0,
                default_value: row.get::<_, Option<String>>(4)?,
                pk: row.get::<_, i64>(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if let Some((_, max_columns, _, _)) = limits {
        column_info.truncate(max_columns);
    }
    let columns: Vec<String> = column_info.iter().map(|c| c.name.clone()).collect();

    // Discover indexes via PRAGMA index_list + PRAGMA index_info.
    let mut indexes: Vec<IndexSchema> = Vec::new();
    {
        let mut idx_list_stmt = conn.prepare(&format!("PRAGMA index_list(\"{}\")", safe_name))?;
        // index_list columns: seq, name, unique, origin, partial
        let idx_rows: Vec<(String, bool)> = idx_list_stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, i64>(2)? != 0))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for (idx_name, unique) in idx_rows {
            let safe_idx = idx_name.replace('"', "\"\"");
            let mut info_stmt = conn.prepare(&format!("PRAGMA index_info(\"{}\")", safe_idx))?;
            // index_info columns: seqno, cid, name
            let cols: Vec<String> = info_stmt
                .query_map([], |row| row.get::<_, Option<String>>(2))?
                .filter_map(|r| r.ok().flatten())
                .collect();
            indexes.push(IndexSchema {
                name: idx_name,
                unique,
                columns: cols,
            });
        }
    }

    // Build an explicit projection so bounded callers do not make SQLite
    // materialize columns which the UI will never receive.
    let projection = columns
        .iter()
        .map(|column| format!("\"{}\"", column.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(", ");
    let limit_clause = limits
        .map(|(max_rows, _, _, _)| format!(" LIMIT {max_rows}"))
        .unwrap_or_default();
    let mut select_stmt = conn.prepare(&format!(
        "SELECT {projection} FROM \"{safe_name}\"{limit_clause}"
    ))?;
    let mut rows = Vec::new();
    let mut remaining_text_bytes = limits.map(|(_, _, _, total)| total);

    let mut result_rows = select_stmt.query([])?;
    while let Some(row) = result_rows.next()? {
        let row_values: Vec<serde_json::Value> = (0..columns.len())
            .map(|i| {
                sqlite_value_to_json(
                    row,
                    i,
                    limits.map(|(_, _, max_text, _)| max_text),
                    &mut remaining_text_bytes,
                )
            })
            .collect();
        rows.push(row_values);
    }

    Ok(CustomTableInfo {
        name: table_name.to_string(),
        columns,
        rows,
        column_info,
        indexes,
    })
}

/// Convert a SQLite column value to a serde_json::Value.
fn sqlite_value_to_json(
    row: &rusqlite::Row<'_>,
    idx: usize,
    max_text_bytes: Option<usize>,
    remaining_text_bytes: &mut Option<usize>,
) -> serde_json::Value {
    use rusqlite::types::ValueRef;
    match row.get_ref(idx) {
        Ok(ValueRef::Null) => serde_json::Value::Null,
        Ok(ValueRef::Integer(i)) => serde_json::Value::Number(i.into()),
        Ok(ValueRef::Real(f)) => serde_json::Number::from_f64(f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Ok(ValueRef::Text(t)) => {
            let bounded = if let Some(max_bytes) = max_text_bytes {
                let remaining = remaining_text_bytes.unwrap_or(0);
                let mut end = t.len().min(max_bytes).min(remaining);
                while end > 0 && std::str::from_utf8(&t[..end]).is_err() {
                    end -= 1;
                }
                if let Some(remaining) = remaining_text_bytes {
                    *remaining = remaining.saturating_sub(end);
                }
                &t[..end]
            } else {
                t
            };
            serde_json::Value::String(String::from_utf8_lossy(bounded).into_owned())
        }
        Ok(ValueRef::Blob(_)) => serde_json::Value::Null, // skip blobs
        Err(_) => serde_json::Value::Null,
    }
}

#[cfg(test)]
mod tests;
