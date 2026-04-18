//! Public types for the migration framework.
//!
//! See the `migrator` module docs for the overall contract. This file contains
//! only types; runtime logic lives in `mod.rs`, `backup.rs`, and `schema.rs`.

use rusqlite::Connection;
use std::path::PathBuf;

/// A single schema migration step.
pub struct Migration {
    /// Monotonic version this migration advances **to** (so the first migration
    /// has `version = 1` and advances from 0 → 1).
    pub version: u32,
    /// Human-readable name for logging.
    pub name: &'static str,
    /// SQL to execute. Runs inside a transaction (where SQLite allows it).
    pub sql: &'static str,
    /// Optional hook invoked **before** the migration's SQL runs, under the
    /// same transaction. Used to perform idempotent schema fixups (e.g. adding
    /// columns required by the migration body).
    pub pre_hook: Option<fn(&Connection) -> rusqlite::Result<()>>,
}

/// Ordered list of migrations a database applies on open.
pub struct MigrationPlan {
    pub migrations: &'static [Migration],
}

/// Options controlling migration execution.
#[derive(Debug, Clone)]
pub struct MigratorOptions {
    /// Write `{db}.pre-v{N}.bak` before each migration. Default `true`.
    /// Ignored when running against an in-memory database (no `db_path`).
    pub backup: bool,
    /// If `Some`, write backups to this directory instead of alongside the DB.
    pub backup_dir: Option<PathBuf>,
    /// Maximum number of `*.pre-v*.bak` files to retain per database (by mtime).
    /// Older backups are pruned after each successful migration. Default `5`.
    pub backup_retention: usize,
}

impl Default for MigratorOptions {
    fn default() -> Self {
        Self {
            backup: true,
            backup_dir: None,
            backup_retention: 5,
        }
    }
}

/// Report summarising what `run_migrations` did.
#[derive(Debug, Clone)]
pub struct MigrationReport {
    pub from_version: u32,
    pub to_version: u32,
    pub applied: Vec<u32>,
    /// Most recent backup path written (if any).
    pub last_backup_path: Option<PathBuf>,
}

/// Outcome of the best-effort backup restore that runs after a failed migration.
#[derive(Debug)]
pub enum RestoreOutcome {
    /// DB transaction rolled back cleanly; no restore was needed.
    TransactionRolledBack,
    /// Backup file was left on disk for operator-driven manual recovery.
    BackupPreserved { path: PathBuf },
    /// No backup existed (e.g. in-memory DB or `backup=false`).
    NoBackup,
}

/// Error returned from migration operations.
#[derive(Debug, thiserror::Error)]
pub enum MigrationError {
    #[error("failed to create or read schema_version table: {0}")]
    SchemaVersion(#[source] rusqlite::Error),

    #[error("failed to write backup for version {version}: {source}")]
    Backup {
        version: u32,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to write backup for version {version} via rusqlite: {source}")]
    BackupSqlite {
        version: u32,
        #[source]
        source: rusqlite::Error,
    },

    #[error("migration {version} ({name}) failed: {source}")]
    Migration {
        version: u32,
        name: &'static str,
        #[source]
        source: rusqlite::Error,
        restore_outcome: String,
    },
}

// Suppress unused-variant dead-code warnings: RestoreOutcome is part of the
// public surface for consumers inspecting errors programmatically.
#[allow(dead_code)]
fn _restore_outcome_type_check() -> [RestoreOutcome; 3] {
    [
        RestoreOutcome::TransactionRolledBack,
        RestoreOutcome::BackupPreserved {
            path: PathBuf::new(),
        },
        RestoreOutcome::NoBackup,
    ]
}
