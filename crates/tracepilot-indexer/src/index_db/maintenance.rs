//! Background maintenance for [`IndexDb`]: `ANALYZE`, FTS5 optimize,
//! incremental vacuum, WAL checkpoint, plus epoch-based throttling so the
//! work only runs once every few hours instead of on every refresh cycle.

use super::IndexDb;

impl IndexDb {
    /// Run SQLite `ANALYZE` to update query-planner statistics.
    ///
    /// Should be called after bulk write operations (full reindex, search rebuild)
    /// so the query planner has accurate cardinality data for FTS5 and index selection.
    /// Cheap on small DBs (~1ms), still fast on large ones (<50ms for 1000+ sessions).
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
        self.analyze();
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

    /// Core maintenance operations: FTS optimize → vacuum → WAL checkpoint.
    /// Returns `true` if at least the vacuum or checkpoint succeeded.
    fn run_full_maintenance(&self) -> bool {
        let start = std::time::Instant::now();
        let mut any_succeeded = false;

        // 1. Optimize FTS5 search index (merge segments → frees pages).
        // Must run BEFORE vacuum so freed pages are reclaimed in the same pass.
        if let Err(e) = self
            .conn
            .execute_batch("INSERT INTO search_fts(search_fts) VALUES('optimize')")
        {
            tracing::warn!(error = %e, "FTS optimize failed (non-fatal)");
        } else {
            any_succeeded = true;
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
            reclaimed_pages = reclaimed,
            freelist_before = freelist,
            elapsed_ms = start.elapsed().as_millis(),
            "Full maintenance complete"
        );

        any_succeeded
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
