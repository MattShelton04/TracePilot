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
            // Create a temp table of explicitly stale IDs to delete.
            // This is significantly faster (~3x) than using json_each() with a massive JSON array
            // of live IDs.
            self.conn
                .execute_batch("CREATE TEMP TABLE IF NOT EXISTS stale_ids (id TEXT PRIMARY KEY)")?;

            // Clear in case a previous aborted transaction left data behind
            self.conn.execute_batch("DELETE FROM temp.stale_ids")?;

            let mut stmt = self
                .conn
                .prepare("INSERT INTO temp.stale_ids (id) VALUES (?1)")?;
            for id in &stale {
                stmt.execute([id])?;
            }
            drop(stmt);

            self.conn.execute_batch(
                "DELETE FROM search_content WHERE session_id IN (SELECT id FROM temp.stale_ids);
                 DELETE FROM sessions WHERE id IN (SELECT id FROM temp.stale_ids);
                 DROP TABLE temp.stale_ids;",
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
