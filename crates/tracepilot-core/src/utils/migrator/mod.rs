//! Shared SQLite migration framework for TracePilot databases.
//!
//! Provides:
//! - A canonical `schema_version(version, applied_at)` table used by all DBs.
//! - Backup-before-migrate semantics producing `{db}.pre-v{N}.bak` on disk.
//! - Rollback on failure: every migration runs inside an explicit transaction;
//!   on transaction failure the DB reverts to the prior state. If a migration
//!   fails in a way that leaves the file dirty, the matching `.pre-vN.bak`
//!   file is left on disk for manual recovery and logged.
//!
//! # Module layout
//!
//! - [`types`] — public types (`Migration`, `MigrationPlan`, `MigratorOptions`,
//!   `MigrationReport`, `MigrationError`, `RestoreOutcome`).
//! - [`backup`] — snapshot writing, path computation, retention pruning.
//! - [`schema`] — `schema_version` table bootstrap.
//! - `tests` — `#[cfg(test)]` integration tests.
//!
//! Consumers should import from this module directly; re-exports below keep
//! the public surface at `tracepilot_core::utils::migrator::<Type>`.
//!
//! # Usage
//!
//! ```no_run
//! use tracepilot_core::utils::migrator::{
//!     Migration, MigrationPlan, MigratorOptions, run_migrations,
//! };
//! use rusqlite::Connection;
//!
//! static MIGRATIONS: &[Migration] = &[Migration {
//!     version: 1,
//!     name: "base schema",
//!     sql: "CREATE TABLE foo (id INTEGER);",
//!     pre_hook: None,
//! }];
//!
//! static PLAN: MigrationPlan = MigrationPlan { migrations: MIGRATIONS };
//!
//! let mut conn = Connection::open("/tmp/example.db")?;
//! let report = run_migrations(
//!     &mut conn,
//!     Some(std::path::Path::new("/tmp/example.db")),
//!     &PLAN,
//!     &MigratorOptions::default(),
//! )?;
//! println!("applied: {:?}", report.applied);
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```
//!
//! # Stability
//!
//! Semi-stable. Signatures are considered stable within a minor version;
//! `MigrationError` may gain variants.

mod backup;
mod schema;
mod types;

#[cfg(test)]
mod tests;

use rusqlite::Connection;
use std::path::Path;

pub use backup::backup_path_for;
pub use schema::ensure_schema_version_table;
pub use types::{
    Migration, MigrationError, MigrationPlan, MigrationReport, MigratorOptions, RestoreOutcome,
};

use backup::{map_backup_err, prune_backups, write_backup};

/// Run all pending migrations in the plan.
///
/// - Creates a `schema_version(version INTEGER NOT NULL, applied_at TEXT DEFAULT (datetime('now')))`
///   table if absent.
/// - Reads `current = COALESCE(MAX(version), 0)`.
/// - For each migration in the plan with `version > current`:
///     1. (on-disk only, `backup=true`) writes `{db}.pre-v{N}.bak` using
///        `rusqlite::backup::Backup` so WAL-mode databases capture the latest
///        commits.
///     2. Runs `pre_hook` (if any) inside an `unchecked_transaction`.
///     3. Runs `sql` in the same transaction.
///     4. Inserts the row into `schema_version` and commits.
/// - On any step failure the transaction auto-rolls back, the backup (if any)
///   is left on disk, and the function returns an error.
pub fn run_migrations(
    conn: &mut Connection,
    db_path: Option<&Path>,
    plan: &MigrationPlan,
    opts: &MigratorOptions,
) -> Result<MigrationReport, MigrationError> {
    ensure_schema_version_table(conn).map_err(MigrationError::SchemaVersion)?;

    let current_version: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(MigrationError::SchemaVersion)?
        .max(0) as u32;

    let mut report = MigrationReport {
        from_version: current_version,
        to_version: current_version,
        applied: Vec::new(),
        last_backup_path: None,
    };

    let do_backup = opts.backup && db_path.is_some();

    for migration in plan.migrations {
        if migration.version <= current_version {
            continue;
        }

        let backup_path = if do_backup {
            let path = backup_path_for(
                db_path.expect("db_path is Some when do_backup is true"),
                migration.version,
                opts.backup_dir.as_deref(),
            );
            write_backup(conn, &path).map_err(|err| map_backup_err(migration.version, err))?;
            Some(path)
        } else {
            None
        };

        let tx_result: rusqlite::Result<()> = (|| {
            let tx = conn.unchecked_transaction()?;
            if let Some(hook) = migration.pre_hook {
                hook(&tx)?;
            }
            tx.execute_batch(migration.sql)?;
            tx.execute(
                "INSERT INTO schema_version (version) VALUES (?1)",
                [migration.version as i64],
            )?;
            tx.commit()?;
            Ok(())
        })();

        match tx_result {
            Ok(()) => {
                tracing::info!(
                    version = migration.version,
                    name = migration.name,
                    "Applied migration"
                );
                report.applied.push(migration.version);
                report.to_version = migration.version;
                report.last_backup_path = backup_path.clone();

                if do_backup && opts.backup_retention > 0 {
                    if let Some(db) = db_path {
                        prune_backups(db, opts.backup_dir.as_deref(), opts.backup_retention);
                    }
                }
            }
            Err(source) => {
                let outcome = match &backup_path {
                    Some(p) => {
                        tracing::error!(
                            version = migration.version,
                            name = migration.name,
                            backup = %p.display(),
                            error = %source,
                            "Migration failed; backup retained for manual recovery"
                        );
                        format!("backup preserved at {}", p.display())
                    }
                    None => {
                        tracing::error!(
                            version = migration.version,
                            name = migration.name,
                            error = %source,
                            "Migration failed; transaction rolled back (no backup)"
                        );
                        "transaction rolled back, no backup taken".to_string()
                    }
                };
                return Err(MigrationError::Migration {
                    version: migration.version,
                    name: migration.name,
                    source,
                    restore_outcome: outcome,
                });
            }
        }
    }

    Ok(report)
}
