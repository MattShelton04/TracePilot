//! `schema_version` table management.

use rusqlite::Connection;

/// Ensure the canonical `schema_version` table exists. Safe to call multiple times.
/// The `applied_at` column is additive for databases that were originally created
/// with a bare `schema_version(version INTEGER NOT NULL)` table.
pub fn ensure_schema_version_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version    INTEGER NOT NULL,
            applied_at TEXT DEFAULT (datetime('now'))
         )",
        [],
    )?;
    // Additive: older DBs may lack applied_at; ignore failure (column exists).
    let has_applied_at = {
        let mut stmt = conn.prepare("PRAGMA table_info(schema_version)")?;
        let mut rows = stmt.query([])?;
        let mut found = false;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            if name == "applied_at" {
                found = true;
                break;
            }
        }
        found
    };
    if !has_applied_at {
        // ALTER can fail on exotic older variants; ignore errors so the table
        // remains usable with the bare `version` column.
        let _ = conn.execute_batch(
            "ALTER TABLE schema_version ADD COLUMN applied_at TEXT DEFAULT (datetime('now'))",
        );
    }
    Ok(())
}
