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

        self.conn.execute_batch("BEGIN")?;
        let result = (|| -> Result<()> {
            // Use json_each() to pass all live IDs as a single JSON array parameter,
            // avoiding the N individual INSERT statements into a temp table.
            let live_json = serde_json::to_string(&live_ids.iter().collect::<Vec<_>>())
                .expect("string serialization is infallible");

            self.conn.execute(
                "DELETE FROM sessions WHERE id NOT IN (SELECT value FROM json_each(?1))",
                [&live_json],
            )?;
            self.conn.execute(
                "DELETE FROM search_content WHERE session_id NOT IN (SELECT value FROM json_each(?1))",
                [&live_json],
            )?;
            Ok(())
        })();

        match result {
            Ok(()) => {
                self.conn.execute_batch("COMMIT")?;
                Ok(count)
            }
            Err(e) => {
                if let Err(rb_err) = self.conn.execute_batch("ROLLBACK") {
                    tracing::warn!(error = %rb_err, "ROLLBACK after prune_deleted failed");
                }
                Err(e)
            }
        }
    }
}
