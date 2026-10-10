//! First-index search writes that bring `search_fts` up to date once, at the
//! end of the pass.
//!
//! On a first index every session is new. Keeping `search_fts` in step
//! through the per-row sync triggers then costs more than writing
//! `search_content` itself, while one FTS5 `'rebuild'` over the finished
//! table costs a fraction of that. So while a pass started with an empty
//! `search_content`, each batch commits its rows with the triggers dropped
//! inside its transaction (they are back before it commits, and a rollback
//! restores them too), and the pass rebuilds `search_fts` once at the end.
//!
//! Until then, full-text queries do not find the deferred rows; everything
//! that reads `search_content` directly sees them as usual. Each deferred
//! commit also records [`FTS_REBUILD_PENDING`], and the rebuild clears it in
//! the same transaction. A pass that is cancelled, fails or stops before its
//! rebuild leaves the marker, so the next pass rebuilds before it writes
//! anything. FTS5 treats deleting a row it never indexed as corruption, so a
//! purge, prune or clear that lands while the marker is set rebuilds first,
//! in the same transaction as its delete.

use tracepilot_core::ids::SessionId;
use tracepilot_core::parsing::snapshot::check_cancelled;
use tracepilot_core::provider::SessionSource;

use super::SearchContentRow;
use crate::Result;
use crate::index_db::IndexDb;

/// `maintenance_state` key present while committed rows await the rebuild.
const FTS_REBUILD_PENDING: &str = "search_fts_rebuild_pending";

const DROP_FTS_TRIGGERS: &str = "DROP TRIGGER IF EXISTS search_content_ai;
     DROP TRIGGER IF EXISTS search_content_ad;
     DROP TRIGGER IF EXISTS search_content_au;";

/// The sync triggers exactly as the schema defines them (migration 9).
const CREATE_FTS_TRIGGERS: &str =
    "CREATE TRIGGER search_content_ai AFTER INSERT ON search_content BEGIN
        INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
     END;
     CREATE TRIGGER search_content_au AFTER UPDATE ON search_content BEGIN
        INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
     END;
     CREATE TRIGGER search_content_ad AFTER DELETE ON search_content BEGIN
        INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.id, old.content);
     END;";

impl IndexDb {
    /// Whether a pass may defer FTS sync: nothing in `search_content` is
    /// indexed yet, so no row the pass deletes or replaces is in `search_fts`.
    pub(crate) fn search_content_is_empty(&self) -> Result<bool> {
        Ok(self.conn.query_row(
            "SELECT NOT EXISTS (SELECT 1 FROM search_content)",
            [],
            |row| row.get(0),
        )?)
    }

    /// Commit one batch as [`Self::upsert_search_snapshots`] does, but without
    /// FTS sync: a session that fails keeps its previous content, and
    /// cancellation rolls back the whole batch.
    pub(crate) fn write_search_snapshots_deferred(
        &self,
        source: SessionSource,
        session_rows: &[(SessionId, Vec<SearchContentRow>)],
        fingerprints: &[String],
        is_cancelled: &impl Fn() -> bool,
    ) -> Result<usize> {
        let transaction = self.conn.unchecked_transaction()?;
        self.conn.execute_batch(DROP_FTS_TRIGGERS)?;
        let written = match (session_rows, fingerprints) {
            // A session alone needs no savepoint, whose in-memory journal
            // would grow with every index page a large session touches.
            ([(session_id, rows)], [fingerprint]) => {
                self.write_search_snapshot(
                    source,
                    session_id,
                    rows,
                    Some(fingerprint),
                    is_cancelled,
                )?;
                1
            }
            _ => self.write_search_snapshots(source, session_rows, fingerprints, is_cancelled)?,
        };
        self.conn.execute_batch(CREATE_FTS_TRIGGERS)?;
        self.conn.execute(
            "INSERT OR REPLACE INTO maintenance_state (key, value) VALUES (?1, '1')",
            [FTS_REBUILD_PENDING],
        )?;
        check_cancelled(is_cancelled)?;
        transaction.commit()?;
        Ok(written)
    }

    /// Rebuild `search_fts`, in a transaction of its own, if deferred rows
    /// are waiting for it. Returns whether it rebuilt.
    pub(crate) fn finish_deferred_search_fts(&self) -> Result<bool> {
        let transaction = self.conn.unchecked_transaction()?;
        let rebuilt = self.sync_deferred_search_fts()?;
        transaction.commit()?;
        Ok(rebuilt)
    }

    /// [`Self::finish_deferred_search_fts`] inside the caller's transaction.
    /// Anything that deletes from `search_content` while the triggers are in
    /// place calls this first: FTS5 rejects deleting a row it never indexed
    /// as corruption.
    pub(crate) fn sync_deferred_search_fts(&self) -> Result<bool> {
        let pending: bool = self.conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM maintenance_state WHERE key = ?1)",
            [FTS_REBUILD_PENDING],
            |row| row.get(0),
        )?;
        if !pending {
            return Ok(false);
        }
        let started = std::time::Instant::now();
        self.conn
            .execute_batch("INSERT INTO search_fts(search_fts) VALUES('rebuild')")?;
        self.conn.execute(
            "DELETE FROM maintenance_state WHERE key = ?1",
            [FTS_REBUILD_PENDING],
        )?;
        tracing::debug!(
            elapsed_ms = started.elapsed().as_millis(),
            "Rebuilt the full-text index after deferred search writes"
        );
        Ok(true)
    }
}
