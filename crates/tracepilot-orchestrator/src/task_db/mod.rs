//! Task database — dedicated SQLite store for AI agent tasks.
//!
//! Separate from `index.db` to avoid write contention. Single-writer (Tauri app).
//! The orchestrator agent communicates via file-based IPC, not direct DB access.

pub mod operations;
pub(crate) mod schema;
pub mod types;

use crate::error::{OrchestratorError, Result};
use rusqlite::Connection;
use std::path::Path;
use tracepilot_core::utils::migrator::{
    Migration, MigrationPlan, MigratorOptions, ensure_schema_version_table,
    run_migrations as core_run_migrations,
};

pub use operations::*;
pub use types::*;

/// Handle to the task database.
pub struct TaskDb {
    pub(crate) conn: Connection,
}

/// TaskDb migration plan. Migrations are ordered; each advances to its `version`.
/// - v1: base schema (`SCHEMA_V1`).
/// - v2: adds `claimed_at` / `started_at` to `tasks` (idempotent via `migrate_v1_to_v2`).
static TASK_DB_MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "base schema",
        sql: schema::SCHEMA_V1,
        pre_hook: None,
    },
    Migration {
        version: 2,
        name: "claimed_at + started_at",
        // SQL body is a no-op; the column additions are performed by the
        // idempotent `pre_hook` so we survive legacy DBs that already have
        // these columns (pre-framework partial migrations).
        sql: "SELECT 1;",
        pre_hook: Some(task_db_v2_hook),
    },
];

fn task_db_v2_hook(conn: &Connection) -> rusqlite::Result<()> {
    schema::migrate_v1_to_v2(conn)
}

static TASK_DB_PLAN: MigrationPlan = MigrationPlan {
    migrations: TASK_DB_MIGRATIONS,
};

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
            OrchestratorError::task_ctx(
                format!("Failed to open task database at {}", path.display()),
                e,
            )
        })?;

        tracepilot_core::utils::sqlite::configure_connection(&conn)
            .map_err(|e| OrchestratorError::task_ctx("Failed to set task DB pragmas", e))?;

        Self::run_migrations(&mut conn, Some(path))?;

        tracepilot_core::attach_slow_query_profiler!(&mut conn, "tasks");

        Ok(Self { conn })
    }

    /// Default database path: `~/.copilot/tracepilot/tasks.db`
    pub fn default_path() -> Result<std::path::PathBuf> {
        let home = crate::launcher::copilot_home()?;
        Ok(home.join("tracepilot").join("tasks.db"))
    }

    /// Run schema migrations through the shared framework, honouring the legacy
    /// `task_meta`-based version tracking used by pre-framework databases.
    fn run_migrations(conn: &mut Connection, db_path: Option<&Path>) -> Result<()> {
        bootstrap_legacy_schema_version(conn).map_err(|e| {
            OrchestratorError::task_ctx("Legacy schema_version bootstrap failed", e)
        })?;

        let backup_dir = db_path
            .and_then(|p| p.parent())
            .map(|parent| parent.join("backups").join("database"));
        let opts = MigratorOptions {
            backup: db_path.is_some(),
            backup_dir,
            ..Default::default()
        };
        let report =
            core_run_migrations(conn, db_path, &TASK_DB_PLAN, &opts).map_err(map_migration_err)?;

        if !report.applied.is_empty() {
            tracing::info!(
                from = report.from_version,
                to = report.to_version,
                applied = ?report.applied,
                "Task DB migrations applied"
            );
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

fn map_migration_err(err: tracepilot_core::utils::migrator::MigrationError) -> OrchestratorError {
    use tracepilot_core::utils::migrator::MigrationError as ME;
    match err {
        // Reading/writing the `schema_version` tracking table — treat as a
        // direct task-DB operation.
        ME::SchemaVersion(s) => OrchestratorError::TaskDb(s),
        // A migration step (DDL/DML) failed. Preserve the step name so the
        // triage message is actionable rather than a bare rusqlite error.
        ME::Migration { name, source, .. } => OrchestratorError::TaskDbMigration {
            name: name.to_string(),
            source,
        },
        // Pre-migration SQLite backup failed — distinct pipeline from CRUD.
        ME::BackupSqlite { source, .. } => OrchestratorError::TaskDbBackup(source),
        ME::Backup { source, .. } => OrchestratorError::Io(source),
    }
}

/// Dual-read bootstrap: if a legacy `task_meta.schema_version` row exists and
/// the canonical `schema_version` table is missing/empty, back-fill rows for
/// versions `1..=N` so the framework sees the correct `current_version` and
/// does not re-run already-applied migrations.
///
/// We keep `task_meta` intact for backwards-read compatibility; new code only
/// writes to `schema_version`.
fn bootstrap_legacy_schema_version(conn: &Connection) -> rusqlite::Result<()> {
    let task_meta_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='task_meta'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n > 0)
        .unwrap_or(false);

    if !task_meta_exists {
        return Ok(());
    }

    let legacy_version: Option<i64> = conn
        .query_row(
            "SELECT value FROM task_meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse::<i64>().ok());

    let Some(legacy) = legacy_version else {
        return Ok(());
    };
    if legacy <= 0 {
        return Ok(());
    }

    ensure_schema_version_table(conn)?;

    let existing: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if existing >= legacy {
        return Ok(());
    }

    // Back-fill only the missing versions, preserving any already present.
    for v in (existing + 1)..=legacy {
        conn.execute("INSERT INTO schema_version (version) VALUES (?1)", [v])?;
    }

    tracing::info!(
        legacy_version = legacy,
        "Bootstrapped canonical schema_version from legacy task_meta"
    );
    Ok(())
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

    #[test]
    fn test_new_db_records_schema_version_rows() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("fresh.db");
        let db = TaskDb::open_or_create(&db_path).unwrap();

        let count: i64 = db
            .conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2, "expected one row per applied migration (1, 2)");

        let max: i64 = db
            .conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(max, 2);
    }

    #[test]
    fn test_legacy_task_meta_v2_dual_read_skips_migrations() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("legacy.db");

        // Simulate a legacy TaskDb at schema version 2: full v2 schema present,
        // schema_version tracked only in task_meta, no `schema_version` table.
        {
            let conn = Connection::open(&db_path).unwrap();
            tracepilot_core::utils::sqlite::configure_connection(&conn).unwrap();
            conn.execute_batch(schema::SCHEMA_V1).unwrap();
            schema::migrate_v1_to_v2(&conn).unwrap();
            conn.execute(
                "INSERT OR REPLACE INTO task_meta (key, value) VALUES ('schema_version', '2')",
                [],
            )
            .unwrap();
        }

        // Opening through the new framework must NOT re-run migrations.
        let db = TaskDb::open_or_create(&db_path).unwrap();
        let max: i64 = db
            .conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(max, 2);

        // Legacy table is preserved for back-compat reads.
        let legacy: String = db
            .conn
            .query_row(
                "SELECT value FROM task_meta WHERE key = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(legacy, "2");

        // No pre-v*.bak files should exist: nothing was applied.
        let backups: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_str()
                    .map(|n| n.contains(".pre-v") && n.ends_with(".bak"))
                    .unwrap_or(false)
            })
            .collect();
        assert!(
            backups.is_empty(),
            "no migrations should run; no backups expected"
        );
    }

    #[test]
    fn test_legacy_task_meta_v1_upgrades_to_v2() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("legacy_v1.db");

        // Legacy v1 DB: only SCHEMA_V1 + task_meta says "1".
        {
            let conn = Connection::open(&db_path).unwrap();
            tracepilot_core::utils::sqlite::configure_connection(&conn).unwrap();
            conn.execute_batch(schema::SCHEMA_V1).unwrap();
            conn.execute(
                "INSERT OR REPLACE INTO task_meta (key, value) VALUES ('schema_version', '1')",
                [],
            )
            .unwrap();
        }

        let db = TaskDb::open_or_create(&db_path).unwrap();
        let max: i64 = db
            .conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(max, 2);

        // claimed_at/started_at columns should now exist
        let pragma: Vec<String> = db
            .conn
            .prepare("PRAGMA table_info(tasks)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(std::result::Result::ok)
            .collect();
        assert!(pragma.contains(&"claimed_at".to_string()));
        assert!(pragma.contains(&"started_at".to_string()));
    }
}
