use crate::Result;
use std::collections::HashSet;

use super::super::IndexDb;

impl IndexDb {
    /// Remove sessions from the index whose IDs are not in the given set of live IDs.
    ///
    /// Uses a batch DELETE with temp table to avoid exceeding SQLITE_MAX_VARIABLE_NUMBER.
    /// Child tables cascade via foreign keys.
    pub fn prune_deleted(&self, live_ids: &HashSet<&str>) -> Result<usize> {
        let indexed_ids = self.all_indexed_ids()?;
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
                "DELETE FROM sessions WHERE id IN (SELECT value FROM json_each(?1))",
                [&stale_json],
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
