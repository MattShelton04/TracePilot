use rusqlite::Connection;

/// Check if a table exists in a SQLite database.
///
/// # Arguments
/// * `conn` - Open SQLite connection
/// * `table_name` - Name of the table to check
///
/// # Returns
/// - `true` if the table exists
/// - `false` if the table doesn't exist or query fails
///
/// # Example
/// ```no_run
/// use tracepilot_core::utils::sqlite::{open_readonly, table_exists};
/// use std::path::Path;
///
/// let conn = open_readonly(Path::new("/path/to/db.sqlite"))?;
/// if table_exists(&conn, "todos") {
///     // Table exists, query it
/// }
/// # Ok::<(), tracepilot_core::error::TracePilotError>(())
/// ```
#[must_use = "table existence check is useless if not used"]
#[inline]
pub fn table_exists(conn: &Connection, table_name: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table_name],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
    .unwrap_or(false)
}

/// Check if a column exists in a table.
///
/// Useful for schema evolution and optional column handling.
///
/// # Safety Note
/// Table names cannot be parameterized in SQL PRAGMA statements, so we escape
/// quotes manually using the SQL standard method (' becomes ''). This is safe
/// because the escaped string is treated as a literal.
///
/// # Example
/// ```no_run
/// use tracepilot_core::utils::sqlite::{open_readonly, column_exists};
/// use std::path::Path;
///
/// let conn = open_readonly(Path::new("/path/to/db.sqlite"))?;
/// if column_exists(&conn, "users", "email") {
///     // Column exists
/// }
/// # Ok::<(), tracepilot_core::error::TracePilotError>(())
/// ```
#[must_use = "column existence check is useless if not used"]
pub fn column_exists(conn: &Connection, table_name: &str, column_name: &str) -> bool {
    // Escape single quotes per SQL standard ('' = escaped ')
    // PRAGMA doesn't support parameter binding, so manual escaping is required
    let query = format!("PRAGMA table_info('{}')", table_name.replace("'", "''"));
    conn.prepare(&query)
        .and_then(|mut stmt| {
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let col: String = row.get(1)?;
                if col == column_name {
                    return Ok(true);
                }
            }
            Ok(false)
        })
        .unwrap_or(false)
}

/// Get the row count of a table efficiently.
///
/// Returns None if the table doesn't exist or query fails.
///
/// # Safety Note
/// Table names are escaped using SQL double-quote escaping (" becomes "").
#[must_use = "row count is useless if not used"]
pub fn row_count(conn: &Connection, table_name: &str) -> Option<i64> {
    // Escape double quotes per SQL standard ("" = escaped ")
    let query = format!(
        "SELECT COUNT(*) FROM \"{}\"",
        table_name.replace("\"", "\"\"")
    );
    conn.query_row(&query, [], |row| row.get(0)).ok()
}
