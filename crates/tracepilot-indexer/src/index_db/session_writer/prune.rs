use crate::Result;
use std::collections::HashSet;
use tracepilot_core::provider::SessionSource;

use super::super::IndexDb;

impl IndexDb {
    /// Remove `source`'s sessions whose IDs are not in `live_ids`, the
    /// source's complete inventory. Other sources' rows are never touched.
    ///
    /// Uses a batch DELETE with temp table to avoid exceeding SQLITE_MAX_VARIABLE_NUMBER.
    /// Child tables cascade via foreign keys.
    pub fn prune_deleted(&self, source: SessionSource, live_ids: &HashSet<&str>) -> Result<usize> {
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
        let count = stale.len();
        if count == 0 {
            return Ok(0);
        }

        self.conn.execute_batch("SAVEPOINT prune_deleted")?;
        let result = (|| -> Result<()> {
            // Target only the IDs already known to be stale. In the common case
            // this keeps the JSON payload and DELETE work proportional to the
            // number of removed sessions rather than the full live corpus.
            let stale_json = serde_json::to_string(&stale)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

            self.conn.execute(
                "DELETE FROM sessions
                 WHERE source = ?1 AND id IN (SELECT value FROM json_each(?2))",
                [source.as_str(), &stale_json],
            )?;
            Ok(())
        })();

        match result {
            Ok(()) => {
                self.conn.execute_batch("RELEASE SAVEPOINT prune_deleted")?;
                Ok(count)
            }
            Err(e) => {
                if let Err(rb_err) = self
                    .conn
                    .execute_batch("ROLLBACK TO SAVEPOINT prune_deleted")
                {
                    tracing::warn!(error = %rb_err, "ROLLBACK after prune_deleted failed");
                }
                Err(e)
            }
        }
    }
}
