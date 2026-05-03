//! Type-safe row extraction helpers for SQL query results.
//!
//! These helpers extract typed structs from rusqlite Row results using column names
//! instead of hardcoded numeric indices. This makes the code more maintainable and
//! resilient to schema changes.

use rusqlite::Row;

use super::search_reader::ContextSnippet;
use super::types::*;

/// Extract an IndexedSession from a query row using column names.
///
/// Expected columns: id, path, summary, repository, branch, cwd, host_type,
/// created_at, updated_at, event_count, turn_count, current_model, copilot_version,
/// error_count, rate_limit_count, compaction_count, truncation_count
pub(super) fn indexed_session_from_row(row: &Row) -> rusqlite::Result<IndexedSession> {
    Ok(IndexedSession {
        id: row.get("id")?,
        path: row.get("path")?,
        summary: row.get("summary")?,
        repository: row.get("repository")?,
        branch: row.get("branch")?,
        cwd: row.get("cwd")?,
        host_type: row.get("host_type")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        event_count: row.get("event_count")?,
        turn_count: row.get("turn_count")?,
        current_model: row.get("current_model")?,
        copilot_version: row.get("copilot_version")?,
        error_count: row.get("error_count")?,
        rate_limit_count: row.get("rate_limit_count")?,
        compaction_count: row.get("compaction_count")?,
        truncation_count: row.get("truncation_count")?,
    })
}

/// Extract an IndexedIncident from a query row using column names.
///
/// Expected columns: event_type, source_event_type, timestamp, severity, summary, detail_json
pub(super) fn indexed_incident_from_row(row: &Row) -> rusqlite::Result<IndexedIncident> {
    Ok(IndexedIncident {
        event_type: row.get("event_type")?,
        source_event_type: row.get("source_event_type")?,
        timestamp: row.get("timestamp")?,
        severity: row.get("severity")?,
        summary: row.get("summary")?,
        detail_json: row.get("detail_json")?,
    })
}

/// Extract a ContextSnippet from a query row using column names.
///
/// Expected columns: id, content_type, turn_number, event_index, tool_name, preview
pub(super) fn context_snippet_from_row(row: &Row) -> rusqlite::Result<ContextSnippet> {
    Ok(ContextSnippet {
        id: row.get("id")?,
        content_type: row.get("content_type")?,
        turn_number: row.get("turn_number")?,
        event_index: row.get("event_index")?,
        tool_name: row.get("tool_name")?,
        preview: row.get("preview")?,
    })
}
