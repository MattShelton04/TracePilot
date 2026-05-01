//! Idempotent migration column hooks and fixups.

use crate::Result;
use rusqlite::Connection;

/// Pre-hook for migration 9: ensure the `search_indexed_at` / `search_extractor_version`
/// columns exist before the migration body references them in its `UPDATE`.
pub(super) fn ensure_search_columns(conn: &Connection) -> rusqlite::Result<()> {
    add_column_if_missing(conn, "sessions", "search_indexed_at", "TEXT")?;
    add_column_if_missing(
        conn,
        "sessions",
        "search_extractor_version",
        "INTEGER DEFAULT 0",
    )?;
    Ok(())
}

/// Idempotent post-migration fixups that run on every open.
pub(super) fn post_migration_fixups(conn: &Connection) -> Result<()> {
    add_column_if_missing(conn, "sessions", "search_indexed_at", "TEXT")?;
    add_column_if_missing(
        conn,
        "sessions",
        "search_extractor_version",
        "INTEGER DEFAULT 0",
    )?;
    Ok(())
}

/// Add a column to a table only if it doesn't already exist.
fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    col_type: &str,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let has_column = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .any(|r| r.as_deref() == Ok(column));
    if !has_column {
        conn.execute_batch(&format!(
            "ALTER TABLE {} ADD COLUMN {} {}",
            table, column, col_type
        ))?;
    }
    Ok(())
}
