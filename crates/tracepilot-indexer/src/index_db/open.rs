//! Connection lifecycle for [`IndexDb`]: open/create, read-only open,
//! incremental auto_vacuum conversion, and transaction delimiters.

use super::IndexDb;
use super::migrations::run_migrations;
use crate::{Result, error::IndexerError};
use rusqlite::{Connection, Transaction, TransactionBehavior};
use std::path::Path;

/// Page cache (negative = KiB) and in-memory temp storage for the writer.
const WRITER_PRAGMAS: &str = "PRAGMA cache_size=-65536; PRAGMA temp_store=MEMORY;";

impl IndexDb {
    /// Open or create the index database, running migrations as needed.
    pub fn open_or_create(path: &Path) -> Result<Self> {
        tracepilot_core::utils::fs::ensure_parent_dir(path)?;

        let mut conn =
            Connection::open(path).map_err(|e| IndexerError::database_open(path.display(), e))?;

        // Performance and correctness pragmas (shared with orchestrator).
        tracepilot_core::utils::sqlite::configure_connection(&conn)
            .map_err(|e| IndexerError::database_config("Failed to set database pragmas", e))?;

        // Writer-only tuning. Search indexing inserts hundreds of thousands of
        // rows into a table with several secondary indexes plus FTS5; with
        // SQLite's default ~2 MiB page cache most index pages are evicted and
        // re-read between inserts. At most one writer connection is active
        // (indexing gates), so a larger cache is a bounded cost.
        conn.execute_batch(WRITER_PRAGMAS)
            .map_err(|e| IndexerError::database_config("Failed to set writer pragmas", e))?;

        // Enable incremental auto_vacuum so freed pages can be reclaimed on
        // demand via `PRAGMA incremental_vacuum(N)` without a full VACUUM.
        // For existing databases with auto_vacuum=NONE, a one-time VACUUM is
        // required to convert the file format.
        Self::ensure_incremental_auto_vacuum(&conn, path)?;

        run_migrations(&mut conn, Some(path))?;

        let mut db = Self { conn };

        tracepilot_core::attach_slow_query_profiler!(&mut db.conn, "index");

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

    /// Run `f` inside a `BEGIN DEFERRED` transaction.
    ///
    /// - `f` returns `Ok`: the transaction is committed and the value returned.
    ///   If `COMMIT` fails, its error is returned and the transaction is rolled
    ///   back.
    /// - `f` returns `Err`: the transaction is rolled back and `f`'s error is
    ///   returned. A failed `ROLLBACK` is logged via `tracing::error!`.
    /// - `f` panics: the transaction is rolled back while unwinding and the
    ///   panic continues, so a caller that catches it gets the connection back
    ///   in autocommit mode.
    ///
    /// The rollbacks after a failed `COMMIT` and during a panic are best effort:
    /// their own errors are discarded. Neither runs if the transaction has
    /// already ended, for example because SQLite rolled it back after
    /// `SQLITE_FULL`.
    ///
    /// The transaction must be the outermost one: if the connection is already
    /// inside a transaction, `BEGIN` fails, `f` doesn't run, and the outer
    /// transaction is left untouched.
    pub fn with_transaction<R>(&self, f: impl FnOnce(&IndexDb) -> Result<R>) -> Result<R> {
        // This is `unchecked_transaction()` with the behavior pinned. Dropping
        // the guard (a failed commit or a panic in `f`) rolls back.
        let transaction = Transaction::new_unchecked(&self.conn, TransactionBehavior::Deferred)?;
        match f(self) {
            Ok(value) => {
                transaction.commit()?;
                Ok(value)
            }
            Err(err) => {
                if let Err(rb) = transaction.rollback() {
                    tracing::error!(
                        error = %rb,
                        "Failed to roll back transaction after closure error"
                    );
                }
                Err(err)
            }
        }
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
