use crate::Result;
use std::collections::HashSet;
use tracepilot_core::provider::SessionSource;

use crate::indexing::scope::stale_source;

use super::super::IndexDb;

impl IndexDb {
    /// Remove `source`'s sessions whose IDs are not in `live_ids`, the
    /// source's complete inventory. Other sources' rows are never touched.
    ///
    /// Uses a batch DELETE with temp table to avoid exceeding SQLITE_MAX_VARIABLE_NUMBER.
    /// Child tables cascade via foreign keys.
    pub fn prune_deleted(&self, source: SessionSource, live_ids: &HashSet<&str>) -> Result<usize> {
        self.prune_source(source, live_ids, &|| true)
    }

    /// [`Self::prune_deleted`], rolled back unless `is_current` still holds
    /// once the deletes hold the write lock.
    pub(crate) fn prune_source(
        &self,
        source: SessionSource,
        live_ids: &HashSet<&str>,
        is_current: &dyn Fn() -> bool,
    ) -> Result<usize> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM sessions WHERE source = ?1")?;
        let indexed_ids = stmt
            .query_map([source.as_str()], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let stale: Vec<&String> = indexed_ids
            .iter()
            .filter(|id| !live_ids.contains(id.as_str()))
            .collect();
        if stale.is_empty() {
            return Ok(0);
        }

        // Target only the IDs already known to be stale. In the common case
        // this keeps the JSON payload and DELETE work proportional to the
        // number of removed sessions rather than the full live corpus.
        let stale_json = serde_json::to_string(&stale)?;
        self.delete_guarded(source, is_current, || {
            self.conn.execute(
                "DELETE FROM sessions
                 WHERE source = ?1 AND id IN (SELECT value FROM json_each(?2))",
                [source.as_str(), &stale_json],
            )
        })
    }

    /// Remove every session of `source`, for a source that was disabled or
    /// moved. Analytics, search content and FTS rows go with them (foreign
    /// key cascades and triggers). Other sources' rows are never touched.
    ///
    /// Rolled back unless `is_current` still holds once the delete holds the
    /// write lock.
    pub fn purge_source(
        &self,
        source: SessionSource,
        is_current: &dyn Fn() -> bool,
    ) -> Result<usize> {
        self.delete_guarded(source, is_current, || {
            self.conn
                .execute("DELETE FROM sessions WHERE source = ?1", [source.as_str()])
        })
    }

    /// Run `delete` in a savepoint that commits only while `is_current`.
    fn delete_guarded(
        &self,
        source: SessionSource,
        is_current: &dyn Fn() -> bool,
        delete: impl FnOnce() -> rusqlite::Result<usize>,
    ) -> Result<usize> {
        self.conn.execute_batch("SAVEPOINT delete_sessions")?;
        let result = (|| -> Result<usize> {
            let deleted = delete()?;
            if !is_current() {
                return Err(stale_source(source));
            }
            Ok(deleted)
        })();

        match result {
            Ok(deleted) => {
                self.conn
                    .execute_batch("RELEASE SAVEPOINT delete_sessions")?;
                Ok(deleted)
            }
            Err(e) => {
                if let Err(rb_err) = self
                    .conn
                    .execute_batch("ROLLBACK TO SAVEPOINT delete_sessions")
                {
                    tracing::warn!(error = %rb_err, "ROLLBACK after session delete failed");
                }
                // An unreleased savepoint would keep the transaction open.
                if let Err(rel_err) = self.conn.execute_batch("RELEASE SAVEPOINT delete_sessions") {
                    tracing::warn!(error = %rel_err, "RELEASE after session delete failed");
                }
                Err(e)
            }
        }
    }
}
