//! Writing one session's enrichment atomically.
//!
//! Replacement, not merge. The source has no update feed — no tombstones, no
//! per-row version, and `sessions.updated_at` is not proven to move on every
//! usage write — so an `id > last_seen` cursor would miss mutations and break
//! outright once the store is rebuilt with reused IDs. At the observed scale
//! a complete per-session reread is both cheap and always correct.
//!
//! The one thing replacement must never do is confuse a failed read with an
//! empty one, so the caller only reaches here after a successful read.

use rusqlite::{OptionalExtension, params, types::Value};

use crate::Result;

use super::super::IndexDb;
use super::rows::{
    delete_session_enrichment, write_coverage, write_links, write_requests, write_work_refs,
};
use super::types::{CURRENT_ENRICHMENT_VERSION, SessionEnrichmentWrite, StoreSourceRow};

impl IndexDb {
    /// Record a bound source and its current state.
    pub(crate) fn upsert_store_source(&self, source: &StoreSourceRow, success: bool) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO session_store_sources (
                 source_id, db_path, copilot_home, session_state_dir, generation,
                 capability_fingerprint, source_schema_version, capabilities,
                 availability, status_detail, last_attempt_at, last_success_at,
                 revision, enrichment_version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13)
             ON CONFLICT(source_id) DO UPDATE SET
                 db_path = excluded.db_path,
                 copilot_home = excluded.copilot_home,
                 session_state_dir = excluded.session_state_dir,
                 generation = excluded.generation,
                 capability_fingerprint = excluded.capability_fingerprint,
                 source_schema_version = excluded.source_schema_version,
                 capabilities = excluded.capabilities,
                 availability = excluded.availability,
                 status_detail = excluded.status_detail,
                 last_attempt_at = excluded.last_attempt_at,
                 -- A failed attempt must not erase the last time this source
                 -- was actually read; the UI shows cached data as of then.
                 last_success_at = COALESCE(excluded.last_success_at, session_store_sources.last_success_at),
                 enrichment_version = excluded.enrichment_version",
            params![
                source.source_id,
                source.db_path,
                source.copilot_home,
                source.session_state_dir,
                source.generation,
                source.capability_fingerprint,
                source.source_schema_version,
                source.capabilities,
                source.availability,
                source.status_detail,
                now,
                success.then(|| now.clone()),
                CURRENT_ENRICHMENT_VERSION,
            ],
        )?;
        Ok(())
    }

    /// Replace one session's enrichment inside a savepoint.
    ///
    /// Returns whether anything a reader would see changed, so a refresh that
    /// found the source unmoved does not publish a new revision and
    /// needlessly invalidate UI caches.
    pub(crate) fn replace_session_enrichment(
        &self,
        write: &SessionEnrichmentWrite<'_>,
    ) -> Result<bool> {
        // No `sessions` row means the baseline pipeline has not indexed this
        // session, and the foreign keys below would reject every insert.
        if !self.session_row_exists(write.session_id)? {
            return Ok(false);
        }
        let previous = self.enrichment_digest(write.session_id)?;
        let previous_revision = self.session_coverage_revision(write.session_id)?;

        self.conn.execute_batch("SAVEPOINT replace_enrichment")?;
        let result = (|| -> Result<()> {
            delete_session_enrichment(&self.conn, write.session_id)?;
            write_requests(&self.conn, write)?;
            write_work_refs(&self.conn, write)?;
            write_links(&self.conn, write)?;
            write_coverage(&self.conn, write)?;
            Ok(())
        })();

        match result {
            Ok(()) => {
                let changed = self.enrichment_digest(write.session_id)? != previous;
                if changed {
                    self.bump_enrichment_revision(write.source_id, write.session_id)?;
                } else if let Some(revision) = previous_revision {
                    // The rewrite stamped the source's current revision; an
                    // unchanged session keeps the one its evidence last
                    // changed at, or every sweep would expire its cursors.
                    self.conn.execute(
                        "UPDATE session_store_coverage SET revision = ?2 WHERE session_id = ?1",
                        params![write.session_id, revision],
                    )?;
                }
                self.conn.execute_batch("RELEASE replace_enrichment")?;
                Ok(changed)
            }
            Err(error) => {
                if let Err(rollback) = self.conn.execute_batch("ROLLBACK TO replace_enrichment") {
                    tracing::warn!(error = %rollback, "ROLLBACK TO replace_enrichment failed");
                }
                if let Err(release) = self.conn.execute_batch("RELEASE replace_enrichment") {
                    tracing::warn!(error = %release, "RELEASE replace_enrichment failed");
                }
                Err(error)
            }
        }
    }

    fn session_coverage_revision(&self, session_id: &str) -> Result<Option<i64>> {
        Ok(self.conn.query_row(
            "SELECT MAX(revision) FROM session_store_coverage WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )?)
    }

    fn session_row_exists(&self, session_id: &str) -> Result<bool> {
        Ok(self
            .conn
            .query_row("SELECT 1 FROM sessions WHERE id = ?1", [session_id], |_| {
                Ok(())
            })
            .optional()?
            .is_some())
    }

    /// Compare all persisted evidence, including joins and coverage. Read
    /// timestamps and revision bookkeeping do not constitute new evidence.
    fn enrichment_digest(&self, session_id: &str) -> Result<Vec<Vec<Vec<Value>>>> {
        let mut snapshot = Vec::new();
        for (table, order) in [
            ("session_request_usage", "source_id, source_row_id"),
            (
                "session_request_billing_items",
                "source_id, source_row_id, ordinal",
            ),
            ("session_work_refs", "source_id, ref_identity"),
            ("session_request_links", "source_id, source_row_id"),
            ("session_store_coverage", "source_id"),
        ] {
            let mut stmt = self.conn.prepare(&format!(
                "SELECT * FROM {table} WHERE session_id = ?1 ORDER BY {order}"
            ))?;
            let columns: Vec<usize> = stmt
                .column_names()
                .iter()
                .enumerate()
                .filter(|(_, name)| !matches!(**name, "read_at" | "revision"))
                .map(|(index, _)| index)
                .collect();
            let rows = stmt
                .query_map([session_id], |row| {
                    columns
                        .iter()
                        .map(|index| row.get::<_, Value>(*index))
                        .collect::<rusqlite::Result<Vec<_>>>()
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            snapshot.push(rows);
        }
        Ok(snapshot)
    }

    fn bump_enrichment_revision(&self, source_id: &str, session_id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE session_store_sources SET revision = revision + 1 WHERE source_id = ?1",
            [source_id],
        )?;
        let revision: i64 = self.conn.query_row(
            "SELECT revision FROM session_store_sources WHERE source_id = ?1",
            [source_id],
            |row| row.get(0),
        )?;
        self.conn.execute(
            "UPDATE session_store_coverage SET revision = ?2 WHERE session_id = ?1",
            params![session_id, revision],
        )?;
        Ok(())
    }

    /// Remove every enrichment row this feature owns.
    ///
    /// Used when the setting is turned off: disabling must stop retention,
    /// not merely hide the data. Baseline session rows are untouched.
    pub fn purge_session_store_enrichment(&self) -> Result<()> {
        let transaction = self.conn.unchecked_transaction()?;
        self.conn.execute_batch(
            "DELETE FROM session_request_billing_items;
             DELETE FROM session_request_links;
             DELETE FROM session_request_usage;
             DELETE FROM session_work_refs;
             DELETE FROM session_store_coverage;
             DELETE FROM session_store_sources;",
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Drop rows belonging to superseded generations of a source.
    ///
    /// Called only after a replacement generation has been fully staged, so a
    /// failed rebuild leaves the previous generation intact.
    pub(crate) fn purge_stale_generations(&self, source_id: &str, keep: &str) -> Result<usize> {
        let mut removed = 0usize;
        for table in [
            "session_request_billing_items",
            "session_request_links",
            "session_request_usage",
            "session_work_refs",
            "session_store_coverage",
        ] {
            removed += self.conn.execute(
                &format!("DELETE FROM {table} WHERE source_id = ?1 AND generation <> ?2"),
                params![source_id, keep],
            )?;
        }
        Ok(removed)
    }
}
