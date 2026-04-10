//! Task database — dedicated SQLite store for AI agent tasks.
//!
//! Separate from `index.db` to avoid write contention. Single-writer (Tauri app).
//! The orchestrator agent communicates via file-based IPC, not direct DB access.

pub mod operations;
pub mod schema;
pub mod types;

use crate::error::{OrchestratorError, Result};
use rusqlite::Connection;
use std::path::Path;

pub use operations::*;
pub use types::*;

/// Handle to the task database.
pub struct TaskDb {
    pub(crate) conn: Connection,
}

impl TaskDb {
    /// Get a reference to the underlying connection.
    pub fn conn(&self) -> &Connection {
        &self.conn
    }
    /// Open or create the task database at the given path.
    pub fn open_or_create(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut conn = Connection::open(path).map_err(|e| {
            OrchestratorError::Task(format!(
                "Failed to open task database at {}: {e}",
                path.display()
            ))
        })?;

        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;
             PRAGMA busy_timeout=5000;",
        )
        .map_err(|e| OrchestratorError::Task(format!("Failed to set task DB pragmas: {e}")))?;

        Self::run_migrations(&conn)?;

        #[cfg(debug_assertions)]
        conn.profile(Some(|query: &str, duration: std::time::Duration| {
            if duration.as_millis() > 10 {
                tracing::warn!(
                    duration_ms = duration.as_millis(),
                    query = %query.chars().take(200).collect::<String>(),
                    "Slow task DB query"
                );
            }
        }));

        Ok(Self { conn })
    }

    /// Default database path: `~/.copilot/tracepilot/tasks.db`
    pub fn default_path() -> Result<std::path::PathBuf> {
        let home = crate::launcher::copilot_home()?;
        Ok(home.join("tracepilot").join("tasks.db"))
    }

    /// Run schema migrations.
    fn run_migrations(conn: &Connection) -> Result<()> {
        let current_version: i32 = conn
            .query_row(
                "SELECT value FROM task_meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .and_then(|v: String| {
                v.parse::<i32>()
                    .map_err(|e| rusqlite::Error::InvalidParameterName(e.to_string()))
            })
            .unwrap_or(0);

        if current_version < schema::SCHEMA_VERSION {
            if current_version == 0 {
                conn.execute_batch(schema::SCHEMA_V1)?;
                // Also apply v2 columns on fresh DBs
                conn.execute_batch(schema::MIGRATION_V2)?;
                conn.execute(
                    "INSERT OR REPLACE INTO task_meta (key, value) VALUES ('schema_version', ?1)",
                    rusqlite::params![schema::SCHEMA_VERSION.to_string()],
                )?;
                tracing::info!(
                    version = schema::SCHEMA_VERSION,
                    "Task DB schema initialized"
                );
            }
            if current_version >= 1 && current_version < 2 {
                conn.execute_batch(schema::MIGRATION_V2)?;
                conn.execute(
                    "INSERT OR REPLACE INTO task_meta (key, value) VALUES ('schema_version', '2')",
                    [],
                )?;
                tracing::info!("Task DB migrated v1 → v2 (added claimed_at, started_at)");
            }
        }

        Ok(())
    }

    /// Run startup maintenance: release stale tasks, expire exhausted retries.
    pub fn startup_maintenance(&self) -> Result<()> {
        let stale = operations::release_stale_tasks(&self.conn, 60)?;
        let expired = operations::expire_exhausted_tasks(&self.conn)?;
        if stale > 0 || expired > 0 {
            tracing::info!(
                stale_released = stale,
                retries_exhausted = expired,
                "Task DB startup maintenance"
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_open_or_create() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let db = TaskDb::open_or_create(&db_path).unwrap();

        // Verify schema was created
        let count: i32 = db
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tasks'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_migrations_idempotent() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");

        // Open twice — migrations should be idempotent
        let _db1 = TaskDb::open_or_create(&db_path).unwrap();
        drop(_db1);
        let _db2 = TaskDb::open_or_create(&db_path).unwrap();
    }
}
