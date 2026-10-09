//! Per-session format observations (`session_format_observations`): the
//! drift a source's parser reported, written at index time so the
//! diagnostics panel never reparses a session.

use rusqlite::Connection;
use tracepilot_core::provider::FormatObservations;

use super::super::batch_insert::batched_insert;
use crate::Result;

use super::super::format_diagnostics::{KIND_ATTACHMENT, KIND_RECORD, KIND_VERSION};

/// One stored observation: what kind of name, the name, and how many of the
/// session's records carried it.
struct Row<'a> {
    kind: &'static str,
    name: &'a str,
    records: i64,
}

/// Replace the session's observations. `None` (a source that reports none)
/// leaves the session with no rows.
pub(super) fn write(
    conn: &Connection,
    session_id: &str,
    format: Option<&FormatObservations>,
) -> Result<()> {
    conn.execute(
        "DELETE FROM session_format_observations WHERE session_id = ?1",
        [session_id],
    )?;
    let Some(format) = format else {
        return Ok(());
    };
    let rows: Vec<Row<'_>> = [
        (KIND_RECORD, &format.unmapped_record_types),
        (KIND_ATTACHMENT, &format.unmapped_attachment_types),
        (KIND_VERSION, &format.versions),
    ]
    .into_iter()
    .flat_map(|(kind, counts)| {
        counts.iter().map(move |(name, records)| Row {
            kind,
            name,
            records: i64::try_from(*records).unwrap_or(i64::MAX),
        })
    })
    .collect();
    batched_insert(
        conn,
        "INSERT INTO session_format_observations \
         (session_id, kind, name, record_count) VALUES",
        4,
        &rows,
        |row, params| {
            params.push(&session_id as &dyn rusqlite::ToSql);
            params.push(&row.kind);
            params.push(&row.name);
            params.push(&row.records);
        },
    )
}
