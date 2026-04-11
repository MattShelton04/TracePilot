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

use rusqlite::types::Value;
use super::batch_insert::batched_insert;

use crate::Result;
use rusqlite::params;
use std::path::Path;

use super::IndexDb;

// Re-export the public extraction function so external callers
// (e.g. lib.rs) can continue using `search_writer::extract_search_content`.
pub use content_extraction::extract_search_content;

/// Bump when extraction logic changes (new content types, field mapping, etc.)
/// to force re-indexing even when events.jsonl hasn't changed.
pub const CURRENT_EXTRACTOR_VERSION: i64 = 3;

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
    pub fn needs_search_reindex(&self, session_id: &str, session_path: &Path) -> bool {
        let current_events = super::types::get_events_mtime_and_size(session_path);

        let stored: Option<super::types::StalenessRow> = self
            .conn
            .query_row(
                "SELECT search_indexed_at, events_mtime, events_size, search_extractor_version
                 FROM sessions WHERE id = ?1",
                [session_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .ok();

        let Some((search_indexed_at, stored_ev_mtime, stored_ev_size, extractor_ver)) = stored
        else {
            // Session row doesn't exist in `sessions` table (Phase 1 didn't index it,
            // e.g. missing workspace.yaml in old Copilot CLI sessions). Don't attempt
            // search indexing — the FK constraint on search_content would fail.
            return false;
        };

        // Never indexed
        if search_indexed_at.is_none() {
            return true;
        }

        // Extractor version changed
        if extractor_ver.unwrap_or(0) < CURRENT_EXTRACTOR_VERSION {
            return true;
        }

        // Events file changed (mtime or size)
        match (&current_events, &stored_ev_mtime) {
            (Some((cur_mtime, cur_size)), Some(st_mtime)) => {
                if cur_mtime != st_mtime || Some(*cur_size as i64) != stored_ev_size {
                    return true;
                }
            }
            (Some(_), None) => return true,
            (None, Some(_)) => return true,
            (None, None) => {}
        }

        // Compare search_indexed_at < events_mtime
        if let (Some(sia), Some(em)) = (&search_indexed_at, &stored_ev_mtime)
            && sia < em
        {
            return true;
        }

        false
    }

    /// Index search content for a single session.
    /// Deletes existing content and inserts new rows, all within a transaction.
    pub fn upsert_search_content(
        &self,
        session_id: &str,
        rows: &[SearchContentRow],
    ) -> Result<usize> {
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
            batched_insert(
                &self.conn,
                "INSERT INTO search_content \
                    (session_id, content_type, turn_number, event_index, \
                     timestamp_unix, tool_name, content, metadata_json) VALUES",
                8,
                &non_empty,
                |row| vec![
                    Value::Text(row.session_id.clone()),
                    Value::Text(row.content_type.to_string()),
                    match row.turn_number {
                        Some(n) => Value::Integer(n),
                        None => Value::Null,
                    },
                    Value::Integer(row.event_index),
                    match row.timestamp_unix {
                        Some(n) => Value::Integer(n),
                        None => Value::Null,
                    },
                    match &row.tool_name {
                        Some(s) => Value::Text(s.clone()),
                        None => Value::Null,
                    },
                    Value::Text(row.content.clone()),
                    match &row.metadata_json {
                        Some(s) => Value::Text(s.clone()),
                        None => Value::Null,
                    },
                ],
            )?;
            let inserted = non_empty.len();

            // Update search indexing timestamp and extractor version
            let now = chrono::Utc::now().to_rfc3339();
            self.conn.execute(
                "UPDATE sessions SET search_indexed_at = ?1, search_extractor_version = ?2
                 WHERE id = ?3",
                params![now, CURRENT_EXTRACTOR_VERSION, session_id],
            )?;

            Ok(inserted)
        })();

        match result {
            Ok(count) => {
                self.conn.execute_batch("RELEASE upsert_search")?;
                Ok(count)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK TO upsert_search");
                let _ = self.conn.execute_batch("RELEASE upsert_search");
                Err(e)
            }
        }
    }

    /// Clear all search content and reset search_indexed_at for all sessions.
    pub fn clear_search_content(&self) -> Result<()> {
        self.conn.execute_batch(
            "BEGIN;
             DELETE FROM search_content;
             UPDATE sessions SET search_indexed_at = NULL, search_extractor_version = 0;
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
        session_rows: &[(String, Vec<SearchContentRow>)],
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

            for (session_id, rows) in session_rows {
                // Delete existing content for this session
                self.conn.execute(
                    "DELETE FROM search_content WHERE session_id = ?1",
                    [session_id.as_str()],
                )?;

                let non_empty: Vec<&SearchContentRow> =
                    rows.iter().filter(|r| !r.content.is_empty()).collect();
                batched_insert(
                    &self.conn,
                    "INSERT INTO search_content \
                        (session_id, content_type, turn_number, event_index, \
                         timestamp_unix, tool_name, content, metadata_json) VALUES",
                    8,
                    &non_empty,
                    |row| vec![
                        Value::Text(row.session_id.clone()),
                        Value::Text(row.content_type.to_string()),
                        match row.turn_number {
                            Some(n) => Value::Integer(n),
                            None => Value::Null,
                        },
                        Value::Integer(row.event_index),
                        match row.timestamp_unix {
                            Some(n) => Value::Integer(n),
                            None => Value::Null,
                        },
                        match &row.tool_name {
                            Some(s) => Value::Text(s.clone()),
                            None => Value::Null,
                        },
                        Value::Text(row.content.clone()),
                        match &row.metadata_json {
                            Some(s) => Value::Text(s.clone()),
                            None => Value::Null,
                        },
                    ],
                )?;
                total_inserted += non_empty.len();

                // Mark session as indexed
                self.conn.execute(
                    "UPDATE sessions SET search_indexed_at = ?1, search_extractor_version = ?2
                     WHERE id = ?3",
                    params![now, CURRENT_EXTRACTOR_VERSION, session_id.as_str()],
                )?;
            }

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

        // Helper: restore FTS triggers (idempotent via IF NOT EXISTS)
        let restore_triggers = |conn: &rusqlite::Connection| {
            let _ = conn.execute_batch(
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
            );
        };

        match result {
            Ok(count) => {
                // COMMIT can fail (SQLITE_BUSY, SQLITE_FULL, SQLITE_IOERR).
                // If it does, ROLLBACK and restore triggers before returning the error —
                // otherwise the dangling transaction would silently eat any fallback writes.
                if let Err(commit_err) = self.conn.execute_batch("COMMIT") {
                    let _ = self.conn.execute_batch("ROLLBACK");
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
                let _ = self.conn.execute_batch("ROLLBACK");
                restore_triggers(&self.conn);
                Err(e)
            }
        }
    }
}
