//! Connection lifecycle for [`IndexDb`]: open/create, read-only open,
//! incremental auto_vacuum conversion, and transaction delimiters.

use super::IndexDb;
use super::migrations::run_migrations;
use crate::{Result, error::IndexerError};
use rusqlite::Connection;
use std::path::Path;

impl IndexDb {
    /// Open or create the index database, running migrations as needed.
    pub fn open_or_create(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let mut conn =
            Connection::open(path).map_err(|e| IndexerError::database_open(path.display(), e))?;

        // Performance and correctness pragmas (shared with orchestrator).
        tracepilot_core::utils::sqlite::configure_connection(&conn)
            .map_err(|e| IndexerError::database_config("Failed to set database pragmas", e))?;

        // Enable incremental auto_vacuum so freed pages can be reclaimed on
        // demand via `PRAGMA incremental_vacuum(N)` without a full VACUUM.
        // For existing databases with auto_vacuum=NONE, a one-time VACUUM is
        // required to convert the file format.
        Self::ensure_incremental_auto_vacuum(&conn, path)?;

        run_migrations(&mut conn, Some(path))?;

        let mut db = Self { conn };

        // Debug-only: log slow SQL queries (>10ms) via tracing
        #[cfg(debug_assertions)]
        db.conn
            .profile(Some(|query: &str, duration: std::time::Duration| {
                if duration.as_millis() > 10 {
                    tracing::warn!(
                        duration_ms = duration.as_millis(),
                        query = %query.chars().take(200).collect::<String>(),
                        "Slow SQL query"
                    );
                }
            }));

        Ok(db)
    }

    /// Open the index database in read-only mode (no WAL/SHM side-effects).
    ///
    /// Delegates to [`tracepilot_core::utils::sqlite::open_readonly`] for the
    /// read-only flag setup (`SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX`),
    /// then applies the indexer-specific `busy_timeout` PRAGMA on top. The
    /// `TracePilotError` surfaced by the core helper flows into
    /// [`IndexerError::SessionParse`] via `From`.
    ///
    /// Use for all read operations (search, facets, analytics, listing).
    /// Skips migrations and won't create the DB if it doesn't exist.
    pub fn open_readonly(path: &Path) -> Result<Self> {
        let conn = tracepilot_core::utils::sqlite::open_readonly(path)?;

        conn.execute_batch("PRAGMA busy_timeout=5000;")
            .map_err(|e| IndexerError::database_config("Failed to set readonly pragmas", e))?;

        Ok(Self { conn })
    }

    /// Begin a deferred transaction for batch operations.
    pub fn begin_transaction(&self) -> Result<()> {
        self.conn.execute_batch("BEGIN DEFERRED")?;
        Ok(())
    }

    /// Commit the current transaction.
    pub fn commit_transaction(&self) -> Result<()> {
        self.conn.execute_batch("COMMIT")?;
        Ok(())
    }

    /// Ensure the database uses incremental auto_vacuum.
    ///
    /// For new databases the pragma is a no-op. For existing databases that
    /// still have `auto_vacuum=NONE`, a one-time VACUUM converts the format.
    fn ensure_incremental_auto_vacuum(conn: &Connection, path: &Path) -> Result<()> {
        let current: i64 = conn
            .query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
            .unwrap_or(0);
        if current == 2 {
            return Ok(());
        }

        conn.execute_batch("PRAGMA auto_vacuum = INCREMENTAL")
            .map_err(|e| IndexerError::database_config("Failed to set auto_vacuum", e))?;

        // Existing non-empty DB needs VACUUM to persist the mode change.
        // Failure is non-fatal — retries on next open.
        let pages: i64 = conn
            .query_row("PRAGMA page_count", [], |row| row.get(0))
            .unwrap_or(0);
        if pages > 0 {
            tracing::info!(
                "Converting to incremental auto_vacuum (one-time VACUUM): {}",
                path.display()
            );
            if let Err(e) = conn.execute_batch("VACUUM") {
                tracing::warn!(error = %e, "One-time VACUUM failed (will retry on next open)");
            }
        }
        Ok(())
    }
}
