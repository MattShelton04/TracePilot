use crate::Result;
use rusqlite::Connection;

use super::super::batch_insert::batched_insert;
use super::super::types::SessionAnalytics;

/// Delete rows from all session child tables for a given session_id.
///
/// Consolidates the 6 individual DELETE statements into a single helper.
/// Table names are hardcoded constants (not dynamic) so there is no SQL
/// injection risk.
pub(super) fn delete_child_rows(conn: &Connection, session_id: &str) -> Result<()> {
    const DELETE_SQLS: &[&str] = &[
        "DELETE FROM session_model_metrics WHERE session_id = ?1",
        "DELETE FROM session_tool_calls WHERE session_id = ?1",
        "DELETE FROM session_modified_files WHERE session_id = ?1",
        "DELETE FROM session_activity WHERE session_id = ?1",
        "DELETE FROM session_incidents WHERE session_id = ?1",
        "DELETE FROM session_segments WHERE session_id = ?1",
    ];

    for sql in DELETE_SQLS {
        conn.execute(sql, [session_id])?;
    }
    Ok(())
}

pub(super) fn write_child_rows(
    conn: &Connection,
    session_id: &str,
    analytics: &SessionAnalytics,
) -> Result<()> {
    // ──────────────────────────────────────────────────────────────
    // INSERT child rows using multi-row VALUES batching
    // ──────────────────────────────────────────────────────────────
    // Builds INSERT ... VALUES (...),(...),... in chunks of 100,
    // reducing round-trips from N to ceil(N/100).
    // ──────────────────────────────────────────────────────────────
    batched_insert(
        conn,
        "INSERT INTO session_model_metrics \
        (session_id, model_name, input_tokens, output_tokens, \
         cache_read_tokens, cache_write_tokens, cost, request_count, reasoning_tokens) VALUES",
        9,
        &analytics.model_rows,
        |row, params| {
            params.push(&session_id as &dyn rusqlite::ToSql);
            params.push(&row.model);
            params.push(&row.input_tokens);
            params.push(&row.output_tokens);
            params.push(&row.cache_read_tokens);
            params.push(&row.cache_write_tokens);
            params.push(&row.cost);
            params.push(&row.premium_requests);
            match &row.reasoning_tokens {
                Some(v) => params.push(v),
                None => params.push(&rusqlite::types::Null),
            }
        },
    )?;

    batched_insert(
        conn,
        "INSERT INTO session_tool_calls \
        (session_id, tool_name, call_count, success_count, \
         failure_count, total_duration_ms, calls_with_duration) VALUES",
        7,
        &analytics.tool_call_rows,
        |row, params| {
            params.push(&session_id as &dyn rusqlite::ToSql);
            params.push(&row.name);
            params.push(&row.calls);
            params.push(&row.success);
            params.push(&row.failure);
            params.push(&row.duration_ms);
            params.push(&row.calls_with_duration);
        },
    )?;

    batched_insert(
        conn,
        "INSERT OR IGNORE INTO session_modified_files \
        (session_id, file_path, extension) VALUES",
        3,
        &analytics.modified_file_rows,
        |row, params| {
            params.push(&session_id as &dyn rusqlite::ToSql);
            params.push(&row.file_path);
            match &row.extension {
                Some(ext) => params.push(ext),
                None => params.push(&rusqlite::types::Null),
            }
        },
    )?;

    batched_insert(
        conn,
        "INSERT INTO session_activity \
        (session_id, day_of_week, hour, tool_call_count) VALUES",
        4,
        &analytics.activity_rows,
        |row, params| {
            params.push(&session_id as &dyn rusqlite::ToSql);
            params.push(&row.day_of_week);
            params.push(&row.hour);
            params.push(&row.tool_call_count);
        },
    )?;

    batched_insert(
        conn,
        "INSERT INTO session_segments \
        (session_id, start_timestamp, end_timestamp, total_tokens, \
         total_requests, total_premium_requests, total_api_duration_ms, \
         current_model, model_metrics_json) VALUES",
        9,
        &analytics.session_segment_rows,
        |row, params| {
            params.push(&session_id as &dyn rusqlite::ToSql);
            params.push(&row.start_timestamp);
            params.push(&row.end_timestamp);
            params.push(&row.tokens);
            params.push(&row.total_requests);
            params.push(&row.premium_requests);
            params.push(&row.api_duration_ms);
            match &row.current_model {
                Some(m) => params.push(m),
                None => params.push(&rusqlite::types::Null),
            }
            match &row.model_metrics_json {
                Some(j) => params.push(j),
                None => params.push(&rusqlite::types::Null),
            }
        },
    )?;

    batched_insert(
        conn,
        "INSERT INTO session_incidents \
        (session_id, event_type, source_event_type, timestamp, \
         severity, summary, detail_json) VALUES",
        7,
        &analytics.incidents,
        |inc, params| {
            params.push(&session_id as &dyn rusqlite::ToSql);
            params.push(&inc.event_type);
            params.push(&inc.source_event_type);
            match &inc.timestamp {
                Some(t) => params.push(t),
                None => params.push(&rusqlite::types::Null),
            }
            params.push(&inc.severity);
            params.push(&inc.summary);
            match &inc.detail_json {
                Some(d) => params.push(d),
                None => params.push(&rusqlite::types::Null),
            }
        },
    )?;

    Ok(())
}
