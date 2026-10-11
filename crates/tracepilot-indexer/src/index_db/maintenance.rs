//! Background maintenance for [`IndexDb`]: `ANALYZE`, FTS5 segment merges,
//! incremental vacuum, WAL checkpoint, plus epoch-based throttling so the
//! work only runs once every few hours instead of on every refresh cycle.
//!
//! Each statement holds the database write lock while it runs, and another
//! writer (the session indexer runs alongside search maintenance) gives up
//! after its 5 s busy timeout. So the long operations are split into short
//! transactions or skipped when they have nothing to do.

use std::time::{Duration, Instant};

use super::IndexDb;

/// FTS5 pages written per merge step, each step its own transaction. On a
/// 650 MB index a step takes about 0.2 s, where one `optimize` statement held
/// the lock for 3 to 12 s.
const FTS_MERGE_STEP_PAGES: i64 = 500;
/// A pause between merge steps, so a writer waiting on the lock gets it.
const FTS_MERGE_YIELD: Duration = Duration::from_millis(20);
/// Bounds one pass; that 650 MB index merges in about 40 steps and 9 s. A
/// write to the FTS index between steps makes FTS5 start the merge over, so
/// without a budget a busy index could keep the loop rewriting segments. A
/// pass that stops early leaves a valid index; the next maintenance resumes.
const FTS_MERGE_BUDGET: Duration = Duration::from_secs(30);

impl IndexDb {
    /// Run SQLite `ANALYZE` to update query-planner statistics.
    ///
    /// Should be called after bulk write operations (full reindex, search rebuild)
    /// so the query planner has accurate cardinality data for FTS5 and index selection.
    /// It scans every table and index in one statement: about 1 to 4 s on a
    /// 650 MB index, holding the write lock throughout.
    pub fn analyze(&self) {
        if let Err(e) = self.conn.execute_batch("ANALYZE") {
            tracing::warn!(error = %e, "ANALYZE failed (non-fatal)");
        }
    }

    /// Run database maintenance to keep the file compact.
    ///
    /// Uses a startup-only strategy: full maintenance (FTS optimize, vacuum,
    /// WAL checkpoint, ANALYZE) runs at most once every 4 hours, so it
    /// naturally fires on the first indexing pass after app startup but is a
    /// complete no-op during the frequent auto-refresh cycles (every ~5 s).
    ///
    /// Call [`Self::maintenance_force`] after bulk operations (e.g. rebuild) to
    /// bypass the time gate.
    pub fn maintenance(&self) {
        const MIN_INTERVAL_SECS: i64 = 4 * 3600; // 4 hours

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let last_run = self.read_maintenance_epoch();
        if (now - last_run) < MIN_INTERVAL_SECS {
            return;
        }

        if self.run_full_maintenance() {
            self.write_maintenance_epoch(now);
        }
        // Re-analyze only tables without statistics or whose row count
        // changed tenfold. A first index still gets full statistics (with
        // `sqlite_stat4`); routine startups skip a multi-second `ANALYZE`.
        if let Err(e) = self.conn.execute_batch("PRAGMA optimize=0x10002") {
            tracing::warn!(error = %e, "PRAGMA optimize failed (non-fatal)");
        }
    }

    /// Run full maintenance unconditionally, bypassing the time gate.
    ///
    /// Use after bulk operations like `rebuild_search_content` where
    /// large amounts of data were deleted and re-inserted.
    pub fn maintenance_force(&self) {
        if self.run_full_maintenance() {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            self.write_maintenance_epoch(now);
        }
        self.analyze();
    }

    /// Core maintenance operations: FTS merge → vacuum → WAL checkpoint.
    /// Returns `true` if at least the vacuum or checkpoint succeeded.
    fn run_full_maintenance(&self) -> bool {
        let start = std::time::Instant::now();
        let mut any_succeeded = false;

        // 1. Merge the FTS5 search index into one segment, like `optimize`,
        // which frees pages. Must run BEFORE vacuum so freed pages are
        // reclaimed in the same pass.
        let mut merge_steps = 0;
        match self.merge_fts_segments(FTS_MERGE_BUDGET) {
            Ok(steps) => {
                merge_steps = steps;
                any_succeeded = true;
            }
            Err(e) => tracing::warn!(error = %e, "FTS merge failed (non-fatal)"),
        }

        // 2. Reclaim freelist pages (requires incremental auto_vacuum)
        let freelist: i64 = self
            .conn
            .query_row("PRAGMA freelist_count", [], |row| row.get(0))
            .unwrap_or(0);
        let mut reclaimed: i64 = 0;
        if freelist > 0 {
            let cap = freelist.min(50_000);
            if let Err(e) = self
                .conn
                .execute_batch(&format!("PRAGMA incremental_vacuum({cap})"))
            {
                tracing::warn!(error = %e, "incremental_vacuum failed (non-fatal)");
            } else {
                let after: i64 = self
                    .conn
                    .query_row("PRAGMA freelist_count", [], |row| row.get(0))
                    .unwrap_or(0);
                reclaimed = freelist - after;
                any_succeeded = true;
            }
        }

        // 3. WAL checkpoint — truncate to reclaim WAL file space
        if let Err(e) = self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)") {
            tracing::warn!(error = %e, "WAL checkpoint failed (non-fatal)");
        } else {
            any_succeeded = true;
        }

        tracing::debug!(
            merge_steps,
            reclaimed_pages = reclaimed,
            freelist_before = freelist,
            elapsed_ms = start.elapsed().as_millis(),
            "Full maintenance complete"
        );

        any_succeeded
    }

    /// Merge every FTS5 segment into one, as `optimize` does, in bounded
    /// steps that each commit on their own. A negative `merge` argument
    /// merges segments from all levels; FTS5 records two or more changes for
    /// a step that did work. Stops once a step finds nothing to merge or the
    /// steps have run for `budget`. Returns the number of steps that did work.
    pub(super) fn merge_fts_segments(&self, budget: Duration) -> rusqlite::Result<usize> {
        let start = Instant::now();
        let mut steps = 0;
        loop {
            let before = self.conn.total_changes();
            self.conn.execute(
                "INSERT INTO search_fts(search_fts, rank) VALUES('merge', ?1)",
                [-FTS_MERGE_STEP_PAGES],
            )?;
            if self.conn.total_changes() - before < 2 {
                return Ok(steps);
            }
            steps += 1;
            if start.elapsed() >= budget {
                return Ok(steps);
            }
            std::thread::sleep(FTS_MERGE_YIELD);
        }
    }

    // ── Maintenance timestamp helpers ─────────────────────────────────

    pub(super) fn read_maintenance_epoch(&self) -> i64 {
        self.conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM maintenance_state WHERE key = 'last_run_epoch'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0)
    }

    fn write_maintenance_epoch(&self, epoch: i64) {
        if let Err(e) = self.conn.execute(
            "INSERT OR REPLACE INTO maintenance_state (key, value) VALUES ('last_run_epoch', ?1)",
            [epoch],
        ) {
            tracing::warn!(error = %e, "Failed to write maintenance timestamp (non-fatal)");
        }
    }
}
