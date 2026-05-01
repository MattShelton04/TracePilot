//! Migration runner and error mapping.

use super::columns::post_migration_fixups;
use super::plan::INDEX_DB_PLAN;
use crate::Result;
use crate::error::IndexerError;
use rusqlite::Connection;
use std::path::Path;
use tracepilot_core::utils::migrator::{MigratorOptions, run_migrations as core_run_migrations};

/// Run all pending schema migrations in order.
///
/// `db_path` is `None` for in-memory databases (tests); otherwise backups
/// are written to `{db_parent}/backups/database/` as `{db}.pre-v{N}.bak`
/// per applied version.
pub(in crate::index_db) fn run_migrations(
    conn: &mut Connection,
    db_path: Option<&Path>,
) -> Result<()> {
    let backup_dir = db_path.and_then(|p| p.parent()).map(|parent| {
        tracepilot_core::paths::TracePilotPaths::from_root(parent).database_backups_dir()
    });
    let opts = MigratorOptions {
        backup: db_path.is_some(),
        backup_dir,
        ..Default::default()
    };
    core_run_migrations(conn, db_path, &INDEX_DB_PLAN, &opts).map_err(map_migration_err)?;

    // Idempotent ALTER TABLE additions for Migration 6 columns.
    // Always run (not gated on current_version) so that partial failures
    // where version 6 committed but columns weren't added are recovered.
    // add_column_if_missing is safe to call repeatedly — it checks PRAGMA table_info.
    post_migration_fixups(conn)?;

    Ok(())
}

fn map_migration_err(err: tracepilot_core::utils::migrator::MigrationError) -> IndexerError {
    use tracepilot_core::utils::migrator::MigrationError as ME;
    match err {
        ME::SchemaVersion(s) => IndexerError::DatabaseConfiguration {
            details: "schema_version table setup failed".to_string(),
            source: s,
        },
        ME::Migration { source, .. } => IndexerError::Database(source),
        ME::BackupSqlite { source, .. } => IndexerError::DatabaseConfiguration {
            details: "pre-migration backup failed".to_string(),
            source,
        },
        ME::Backup { source, .. } => IndexerError::Io(source),
    }
}
