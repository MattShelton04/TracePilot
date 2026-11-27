//! Replace only the part of a session's search rows that changed.
//!
//! A live session is re-indexed every few seconds while it grows. Its new
//! rows are its stored rows plus a few at the end, so deleting and
//! re-inserting all of them (each delete and insert also an FTS5 write)
//! cost far more than reading them back to compare.

use rusqlite::types::ValueRef;

use super::SearchContentRow;
use crate::Result;
use crate::index_db::IndexDb;
use tracepilot_core::ids::SessionId;

impl IndexDb {
    /// Keep the session's stored rows that equal the start of `rows`, in
    /// order, and delete the rest. Returns how many were kept: the caller
    /// inserts `rows[kept..]`. Stops reading at the first difference, so a
    /// session whose every row changed (an extractor upgrade) reads one.
    pub(super) fn delete_changed_search_rows(
        &self,
        session_id: &SessionId,
        rows: &[&SearchContentRow],
    ) -> Result<usize> {
        let mut statement = self.conn.prepare_cached(
            "SELECT id, content_type, turn_number, event_index, timestamp_unix,
                    tool_name, content, metadata_json
             FROM search_content WHERE session_id = ?1 ORDER BY id",
        )?;
        let mut stored = statement.query([session_id.as_str()])?;
        let mut kept = 0;
        let mut first_changed = None;
        while let Some(row) = stored.next()? {
            let same = match rows.get(kept) {
                Some(new) => same_row(row, new)?,
                None => false,
            };
            if !same {
                first_changed = Some(row.get::<_, i64>(0)?);
                break;
            }
            kept += 1;
        }
        drop(stored);
        if let Some(id) = first_changed {
            self.conn.execute(
                "DELETE FROM search_content WHERE session_id = ?1 AND id >= ?2",
                rusqlite::params![session_id.as_str(), id],
            )?;
        }
        Ok(kept)
    }
}

fn same_row(stored: &rusqlite::Row<'_>, new: &SearchContentRow) -> rusqlite::Result<bool> {
    Ok(text(stored.get_ref(1)?)? == Some(new.content_type)
        && stored.get::<_, Option<i64>>(2)? == new.turn_number
        && stored.get::<_, Option<i64>>(3)? == Some(new.event_index)
        && stored.get::<_, Option<i64>>(4)? == new.timestamp_unix
        && text(stored.get_ref(5)?)? == new.tool_name.as_deref()
        && text(stored.get_ref(6)?)? == Some(new.content.as_str())
        && text(stored.get_ref(7)?)? == new.metadata_json.as_deref())
}

fn text(value: ValueRef<'_>) -> rusqlite::Result<Option<&str>> {
    match value {
        ValueRef::Null => Ok(None),
        other => other.as_str().map(Some).map_err(Into::into),
    }
}
