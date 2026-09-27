//! Deep FTS content extraction and writing.
//!
//! Extracts searchable content from session events into `search_content` rows.
//! Each row represents one searchable chunk (a message, tool call, error, etc.)
//! with a content type, turn number, and event index for deep-linking.
//!
//! Decomposed into focused sub-modules:
//! - `content_extraction` — Pure event→row mapping (`extract_search_content`)
//! - `tool_extraction` — Tool-specific JSON→text extractors and JSON flatteners

mod content_extraction;
#[cfg(test)]
mod tests;
mod tool_extraction;

use super::batch_insert::batched_insert;

use crate::Result;
use rusqlite::params;
use std::path::Path;
use tracepilot_core::ids::SessionId;

use super::IndexDb;

// Re-export the public extraction function so external callers
// (e.g. lib.rs) can continue using `search_writer::extract_search_content`.
pub use content_extraction::extract_search_content;
pub(crate) use content_extraction::extract_search_content_cancellable;

/// Bump when extraction logic changes (new content types, field mapping, etc.)
/// to force re-indexing even when events.jsonl hasn't changed.
pub const CURRENT_EXTRACTOR_VERSION: i64 = 4;

/// A single row to be inserted into `search_content`.
#[derive(Debug)]
pub struct SearchContentRow {
    pub session_id: String,
    pub content_type: &'static str,
    pub turn_number: Option<i64>,
    pub event_index: i64,
    pub timestamp_unix: Option<i64>,
    pub tool_name: Option<String>,
    pub content: String,
    pub metadata_json: Option<String>,
}

impl IndexDb {
    /// Check whether a session needs its search content re-indexed.
    pub fn needs_search_reindex(&self, session_id: &SessionId, session_path: &Path) -> bool {
        let Ok(current) = tracepilot_core::parsing::snapshot::FileFingerprint::read(
            &session_path.join("events.jsonl"),
        ) else {
            return true;
        };
        let Ok(current) = serde_json::to_string(&current) else {
            return true;
        };
        self.conn.query_row(
            "SELECT CASE WHEN search_indexed_at IS NULL THEN NULL ELSE search_source_fingerprint END,
                    search_extractor_version FROM sessions WHERE id = ?1",
            [session_id.as_str()],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, Option<i64>>(1)?)),
        ).is_ok_and(|(source, version)| {
            source.as_deref() != Some(current.as_str()) || version.unwrap_or(0) < CURRENT_EXTRACTOR_VERSION
        })
    }

    /// Index search content for a single session.
    /// Deletes existing content and inserts new rows, all within a transaction.
    pub fn upsert_search_content(
        &self,
        session_id: &SessionId,
        rows: &[SearchContentRow],
    ) -> Result<usize> {
        self.upsert_search_snapshot(session_id, rows, None, &|| false)
    }

    pub(crate) fn upsert_search_snapshot(
        &self,
        session_id: &SessionId,
        rows: &[SearchContentRow],
        source_fingerprint: Option<&str>,
        is_cancelled: &impl Fn() -> bool,
    ) -> Result<usize> {
        let session_id = session_id.as_str();
        self.conn.execute_batch("SAVEPOINT upsert_search")?;

        let result = (|| -> Result<usize> {
            // Delete existing search content for this session
            self.conn.execute(
                "DELETE FROM search_content WHERE session_id = ?1",
                [session_id],
            )?;

            // Batch insert new content (skip empty rows)
            let non_empty: Vec<&SearchContentRow> =
                rows.iter().filter(|r| !r.content.is_empty()).collect();
            for chunk in non_empty.chunks(256) {
                tracepilot_core::parsing::snapshot::check_cancelled(is_cancelled)?;
                batched_insert(
                    &self.conn,
                    "INSERT INTO search_content \
                    (session_id, content_type, turn_number, event_index, \
                     timestamp_unix, tool_name, content, metadata_json) VALUES",
                    8,
                    chunk,
                    |row, params| {
                        params.push(&row.session_id);
                        params.push(&row.content_type as &dyn rusqlite::ToSql);
                        params.push(&row.turn_number);
                        params.push(&row.event_index);
                        params.push(&row.timestamp_unix);
                        params.push(&row.tool_name);
                        params.push(&row.content);
                        params.push(&row.metadata_json);
                    },
                )?;
            }
            tracepilot_core::parsing::snapshot::check_cancelled(is_cancelled)?;
            let inserted = non_empty.len();

            // Update search indexing timestamp and extractor version
            let now = chrono::Utc::now().to_rfc3339();
            self.conn.execute(
                "UPDATE sessions SET search_indexed_at = ?1, search_extractor_version = ?2,
                    search_source_fingerprint = ?4 WHERE id = ?3",
                params![
                    now,
                    CURRENT_EXTRACTOR_VERSION,
                    session_id,
                    source_fingerprint
                ],
            )?;

            Ok(inserted)
        })();

        match result {
            Ok(count) => {
                self.conn.execute_batch("RELEASE upsert_search")?;
                Ok(count)
            }
            Err(e) => {
                // best-effort rollback/release: the primary error `e` is propagated regardless.
                if let Err(rb_err) = self.conn.execute_batch("ROLLBACK TO upsert_search") {
                    tracing::warn!(error = %rb_err, "ROLLBACK TO upsert_search failed");
                }
                if let Err(rel_err) = self.conn.execute_batch("RELEASE upsert_search") {
                    tracing::warn!(error = %rel_err, "RELEASE upsert_search failed");
                }
                Err(e)
            }
        }
    }

    /// Request a rebuild without deleting last-good content before source reads.
    pub(crate) fn invalidate_search_content(&self) -> Result<()> {
        self.conn
            .execute("UPDATE sessions SET search_source_fingerprint = NULL", [])?;
        Ok(())
    }

    /// Clear all search content and reset search_indexed_at for all sessions.
    pub fn clear_search_content(&self) -> Result<()> {
        self.conn.execute_batch(
            "BEGIN;
             DELETE FROM search_content;
             UPDATE sessions SET search_indexed_at = NULL, search_extractor_version = 0,
                search_source_fingerprint = NULL;
             COMMIT;",
        )?;
        Ok(())
    }

    /// Bulk-write search content for multiple sessions, bypassing per-row FTS triggers.
    ///
    /// Instead of firing FTS5 insert/delete triggers on every row (the normal path),
    /// this method:
    /// 1. Drops FTS sync triggers
    /// 2. Deletes + inserts all content rows into `search_content` (fast without FTS overhead)
    /// 3. Rebuilds the FTS5 index in a single pass
    /// 4. Recreates the triggers
    ///
    /// This is dramatically faster for bulk operations (e.g., first-time indexing)
    /// because FTS5 rebuild is O(N) vs O(N log N) for per-row trigger updates.
    ///
    /// **Not suitable for single-session updates** — use `upsert_search_content` for that.
    pub fn bulk_write_search_content(
        &self,
        session_rows: &[(SessionId, Vec<SearchContentRow>)],
    ) -> Result<usize> {
        self.bulk_write_search_snapshots(session_rows, &[], &|| false)
    }

    pub(crate) fn bulk_write_search_snapshots(
        &self,
        session_rows: &[(SessionId, Vec<SearchContentRow>)],
        fingerprints: &[String],
        is_cancelled: &impl Fn() -> bool,
    ) -> Result<usize> {
        let total_start = std::time::Instant::now();
        self.conn.execute_batch("BEGIN")?;

        let result = (|| -> Result<usize> {
            // Step 1: Drop FTS triggers to avoid per-row index updates
            self.conn.execute_batch(
                "DROP TRIGGER IF EXISTS search_content_ai;
                 DROP TRIGGER IF EXISTS search_content_ad;
                 DROP TRIGGER IF EXISTS search_content_au;",
            )?;

            // Step 2: Delete + insert content rows (no FTS overhead)
            let now = chrono::Utc::now().to_rfc3339();
            let mut total_inserted = 0;

            for (index, (session_id, rows)) in session_rows.iter().enumerate() {
                tracepilot_core::parsing::snapshot::check_cancelled(is_cancelled)?;
                // Delete existing content for this session
                self.conn.execute(
                    "DELETE FROM search_content WHERE session_id = ?1",
                    [session_id.as_str()],
                )?;

                let non_empty: Vec<&SearchContentRow> =
                    rows.iter().filter(|r| !r.content.is_empty()).collect();
                for chunk in non_empty.chunks(256) {
                    tracepilot_core::parsing::snapshot::check_cancelled(is_cancelled)?;
                    batched_insert(
                        &self.conn,
                        "INSERT INTO search_content \
                        (session_id, content_type, turn_number, event_index, \
                         timestamp_unix, tool_name, content, metadata_json) VALUES",
                        8,
                        chunk,
                        |row, params| {
                            params.push(&row.session_id);
                            params.push(&row.content_type as &dyn rusqlite::ToSql);
                            params.push(&row.turn_number);
                            params.push(&row.event_index);
                            params.push(&row.timestamp_unix);
                            params.push(&row.tool_name);
                            params.push(&row.content);
                            params.push(&row.metadata_json);
                        },
                    )?;
                }
                total_inserted += non_empty.len();

                // Mark session as indexed
                self.conn.execute(
                    "UPDATE sessions SET search_indexed_at = ?1, search_extractor_version = ?2,
                        search_source_fingerprint = ?4 WHERE id = ?3",
                    params![
                        now,
                        CURRENT_EXTRACTOR_VERSION,
                        session_id.as_str(),
                        fingerprints.get(index)
                    ],
                )?;
            }

            tracepilot_core::parsing::snapshot::check_cancelled(is_cancelled)?;
            // Step 3: Rebuild FTS index in a single pass
            self.conn
                .execute_batch("INSERT INTO search_fts(search_fts) VALUES('rebuild');")?;

            // Step 4: Recreate triggers
            self.conn.execute_batch(
                "CREATE TRIGGER search_content_ai AFTER INSERT ON search_content BEGIN
                    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                 END;
                 CREATE TRIGGER search_content_ad AFTER DELETE ON search_content BEGIN
                    INSERT INTO search_fts(search_fts, rowid, content)
                        VALUES ('delete', old.id, old.content);
                 END;
                 CREATE TRIGGER search_content_au AFTER UPDATE ON search_content BEGIN
                    INSERT INTO search_fts(search_fts, rowid, content)
                        VALUES ('delete', old.id, old.content);
                    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                 END;",
            )?;

            Ok(total_inserted)
        })();

        // Helper: restore FTS triggers (idempotent via IF NOT EXISTS).
        // Trigger recreation is best-effort: if it fails, the next writer call will
        // also fail and surface the root cause loudly via `?` propagation.
        let restore_triggers = |conn: &rusqlite::Connection| {
            if let Err(e) = conn.execute_batch(
                "CREATE TRIGGER IF NOT EXISTS search_content_ai AFTER INSERT ON search_content BEGIN
                    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                 END;
                 CREATE TRIGGER IF NOT EXISTS search_content_ad AFTER DELETE ON search_content BEGIN
                    INSERT INTO search_fts(search_fts, rowid, content)
                        VALUES ('delete', old.id, old.content);
                 END;
                 CREATE TRIGGER IF NOT EXISTS search_content_au AFTER UPDATE ON search_content BEGIN
                    INSERT INTO search_fts(search_fts, rowid, content)
                        VALUES ('delete', old.id, old.content);
                    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
                 END;",
            ) {
                tracing::warn!(error = %e, "Failed to restore FTS triggers after bulk write rollback");
            }
        };

        match result {
            Ok(count) => {
                // COMMIT can fail (SQLITE_BUSY, SQLITE_FULL, SQLITE_IOERR).
                // If it does, ROLLBACK and restore triggers before returning the error —
                // otherwise the dangling transaction would silently eat any fallback writes.
                if let Err(commit_err) = self.conn.execute_batch("COMMIT") {
                    if let Err(rb_err) = self.conn.execute_batch("ROLLBACK") {
                        tracing::warn!(error = %rb_err, "ROLLBACK after failed COMMIT failed");
                    }
                    restore_triggers(&self.conn);
                    return Err(commit_err.into());
                }
                tracing::debug!(
                    inserted = count,
                    sessions = session_rows.len(),
                    elapsed_ms = total_start.elapsed().as_millis(),
                    "Bulk search content write complete"
                );
                Ok(count)
            }
            Err(e) => {
                if let Err(rb_err) = self.conn.execute_batch("ROLLBACK") {
                    tracing::warn!(error = %rb_err, "ROLLBACK after bulk write failure failed");
                }
                restore_triggers(&self.conn);
                Err(e)
            }
        }
    }
}
