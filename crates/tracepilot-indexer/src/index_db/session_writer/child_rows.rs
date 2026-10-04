use crate::Result;
use rusqlite::Connection;

use super::super::batch_insert::batched_insert;
use super::super::types::SessionAnalytics;

/// Delete rows from all session child tables for a given session_id.
///
/// Consolidates the individual DELETE statements into a single helper.
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
        "DELETE FROM session_cache_windows WHERE session_id = ?1",
        "DELETE FROM session_cache_ttls WHERE session_id = ?1",
        "DELETE FROM session_agent_runs WHERE session_id = ?1",
        "DELETE FROM session_agent_selections WHERE session_id = ?1",
        "DELETE FROM session_skill_invocations WHERE session_id = ?1",
        "DELETE FROM session_effort_usage WHERE session_id = ?1",
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
         cache_read_tokens, cache_write_tokens, cost, request_count, reasoning_tokens, \
         total_nano_aiu) VALUES",
        10,
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
            params.push(&row.reasoning_tokens);
            params.push(&row.total_nano_aiu);
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
            params.push(&row.extension);
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
         current_model, model_metrics_json, total_nano_aiu) VALUES",
        10,
        &analytics.session_segment_rows,
        |row, params| {
            params.push(&session_id as &dyn rusqlite::ToSql);
            params.push(&row.start_timestamp);
            params.push(&row.end_timestamp);
            params.push(&row.tokens);
            params.push(&row.total_requests);
            params.push(&row.premium_requests);
            params.push(&row.api_duration_ms);
            params.push(&row.current_model);
            params.push(&row.model_metrics_json);
            params.push(&row.total_nano_aiu);
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
            params.push(&inc.timestamp);
            params.push(&inc.severity);
            params.push(&inc.summary);
            params.push(&inc.detail_json);
        },
    )?;

    batched_insert(
        conn,
        "INSERT INTO session_cache_windows \
        (session_id, window_index, idle_start, resume_at, idle_seconds, model, \
         expires_at, ttl_seconds, outcome, resume_source, prefix_tokens, \
         interaction_nano_aiu, change_kinds) VALUES",
        13,
        &analytics.cache_window_rows,
        |row, params| {
            params.push(&session_id as &dyn rusqlite::ToSql);
            params.push(&row.window_index);
            params.push(&row.idle_start);
            params.push(&row.resume_at);
            params.push(&row.idle_seconds);
            params.push(&row.model);
            params.push(&row.expires_at);
            params.push(&row.ttl_seconds);
            params.push(&row.outcome);
            params.push(&row.resume_source);
            params.push(&row.prefix_tokens);
            params.push(&row.interaction_nano_aiu);
            params.push(&row.change_kinds);
        },
    )?;

    batched_insert(
        conn,
        "INSERT INTO session_cache_ttls \
        (session_id, model, ttl_seconds, observation_count) VALUES",
        4,
        &analytics.cache_ttl_rows,
        |row, params| {
            params.push(&session_id as &dyn rusqlite::ToSql);
            params.push(&row.model);
            params.push(&row.ttl_seconds);
            params.push(&row.observation_count);
        },
    )?;

    write_effort_rows(conn, session_id, &analytics.effort_rows)?;

    Ok(())
}

/// A session has a handful of model/effort pairs, so rows go in one by one.
fn write_effort_rows(
    conn: &Connection,
    session_id: &str,
    rows: &[tracepilot_core::effort_usage::EffortUsageEntry],
) -> Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let mut stmt = conn.prepare_cached(
        "INSERT OR REPLACE INTO session_effort_usage          (session_id, model, reasoning_effort, user_turns, agent_turns, tool_calls, wall_ms,           observed_user_turns, requests, reasoning_tokens, output_tokens, api_duration_ms,           total_nano_aiu, subagent_requests, subagent_nano_aiu)          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
    )?;
    let int = |value: u64| i64::try_from(value).unwrap_or(i64::MAX);
    for row in rows {
        stmt.execute(rusqlite::params![
            session_id,
            row.model.as_deref().unwrap_or(""),
            row.reasoning_effort.as_deref().unwrap_or(""),
            row.user_turns,
            row.agent_turns,
            row.tool_calls,
            int(row.wall_ms),
            row.observed_user_turns,
            row.requests,
            int(row.reasoning_tokens),
            int(row.output_tokens),
            int(row.api_duration_ms),
            int(row.nano_aiu),
            row.subagent_requests,
            int(row.subagent_nano_aiu),
        ])?;
    }
    Ok(())
}
