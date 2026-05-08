use std::collections::BTreeMap;

use crate::Result;
use rusqlite::{Connection, params_from_iter};

use tracepilot_core::analytics::types::*;
use tracepilot_core::models::event_types::ModelMetricDetail;

use super::super::helpers::*;
use super::day_bucket::{DayBucketSpec, query_day_bucketed};

/// FROM/JOIN fragment shared by all three day-bucketed dashboard charts.
const SEGMENTS_JOIN_SESSIONS: &str = "session_segments m JOIN sessions s ON s.id = m.session_id";

pub(super) fn query_analytics(
    conn: &Connection,
    from_date: Option<&str>,
    to_date: Option<&str>,
    repo: Option<&str>,
    hide_empty: bool,
) -> Result<AnalyticsData> {
    let (where_clause, bind_values) = build_date_repo_filter(from_date, to_date, repo, hide_empty);

    // Aggregate session-level stats.
    //
    // NOTE: These sums (`total_tokens`, `total_cost`, `total_premium_requests`) are
    // session-lifetime values stored on the `sessions` row.  For a cross-day session that
    // was last active on the final day of the filter window, its full lifetime total is
    // included here even though the per-day charts (which use `session_segments`) are
    // correctly clamped to the requested window.  For sessions that do not cross the
    // window boundary the numbers are consistent.
    let agg_sql = format!(
        "SELECT COUNT(*), COALESCE(SUM(total_tokens), 0), COALESCE(SUM(total_cost), 0.0),
                    COALESCE(SUM(turn_count), 0), COALESCE(SUM(tool_call_count), 0),
                    COUNT(CASE WHEN turn_count > 0 THEN 1 END),
                    COALESCE(SUM(total_premium_requests), 0.0),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN total_api_duration_ms END), 0),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN total_tokens END), 0),
                    COUNT(CASE WHEN error_count > 0 THEN 1 END),
                    COALESCE(SUM(rate_limit_count), 0),
                    COALESCE(SUM(compaction_count), 0),
                    COALESCE(SUM(truncation_count), 0)
             FROM sessions s{}",
        where_clause
    );
    let refs = to_refs(&bind_values);
    #[allow(clippy::type_complexity)]
    let (
        total_sessions,
        total_tokens,
        total_cost,
        total_turns,
        total_tool_calls,
        sessions_with_turns,
        total_premium_requests,
        total_api_duration_ms_sum,
        total_tokens_with_duration,
        sessions_with_errors,
        total_rate_limits,
        total_compactions,
        total_truncations,
    ): (
        u32,
        i64,
        f64,
        i64,
        i64,
        u32,
        f64,
        i64,
        i64,
        u32,
        i64,
        i64,
        i64,
    ) = conn.query_row(&agg_sql, params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
            row.get(8)?,
            row.get(9)?,
            row.get(10)?,
            row.get(11)?,
            row.get(12)?,
        ))
    })?;

    // Tokens by day — clamp segment end_timestamp to the requested window to
    // prevent segments from sessions that *overlap* the range from leaking
    // data points outside the filter window.
    let token_usage_by_day = query_day_bucketed(
        conn,
        DayBucketSpec {
            from_clause: SEGMENTS_JOIN_SESSIONS,
            aggregate_expr: "COALESCE(SUM(m.total_tokens), 0)",
            bucket_column: "m.end_timestamp",
        },
        &where_clause,
        &bind_values,
        from_date,
        to_date,
        |row| {
            Ok(DayTokens {
                date: row.get(0)?,
                tokens: row.get::<_, i64>(1)? as u64,
            })
        },
    )?;

    // Activity (segments) by day — count segments by the day they *ended*.
    // Using end_timestamp keeps the activity chart consistent with the token and cost
    // charts (which also group by end_timestamp), so all three series agree on which
    // day a segment belongs to.
    let activity_per_day = query_day_bucketed(
        conn,
        DayBucketSpec {
            from_clause: SEGMENTS_JOIN_SESSIONS,
            aggregate_expr: "COUNT(*)",
            bucket_column: "m.end_timestamp",
        },
        &where_clause,
        &bind_values,
        from_date,
        to_date,
        |row| {
            Ok(DayActivity {
                date: row.get(0)?,
                count: row.get(1)?,
            })
        },
    )?;

    // Cost by day — clamp segment end_timestamp to the requested window.
    let cost_by_day = query_day_bucketed(
        conn,
        DayBucketSpec {
            from_clause: SEGMENTS_JOIN_SESSIONS,
            aggregate_expr: "COALESCE(SUM(m.total_premium_requests), 0.0)",
            bucket_column: "m.end_timestamp",
        },
        &where_clause,
        &bind_values,
        from_date,
        to_date,
        |row| {
            Ok(DayCost {
                date: row.get(0)?,
                cost: row.get(1)?,
            })
        },
    )?;
    let model_usage_by_day =
        query_model_usage_by_day(conn, &where_clause, &bind_values, from_date, to_date)?;

    // Model distribution from session_model_metrics
    let mdist_sql = format!(
        "SELECT m.model_name,
                    SUM(m.input_tokens + m.output_tokens),
                    SUM(m.input_tokens),
                    SUM(m.output_tokens),
                    SUM(m.cache_read_tokens),
                    SUM(m.cache_write_tokens),
                    SUM(m.cost),
                    SUM(m.request_count),
                    SUM(COALESCE(m.reasoning_tokens, 0)),
                    MAX(CASE WHEN m.reasoning_tokens IS NOT NULL THEN 1 ELSE 0 END)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id{}
             GROUP BY m.model_name ORDER BY 2 DESC",
        where_clause
    );
    let refs = to_refs(&bind_values);
    let model_distribution = query_model_distribution(conn, &mdist_sql, &refs)?;

    // Cache stats from session_model_metrics
    let cache_sql = format!(
        "SELECT COALESCE(SUM(m.cache_read_tokens), 0), COALESCE(SUM(m.input_tokens), 0)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id{}",
        where_clause
    );
    let refs = to_refs(&bind_values);
    let (total_cache_read_tokens, total_input_tokens): (i64, i64) =
        conn.query_row(&cache_sql, params_from_iter(refs.iter().copied()), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;
    let total_cache_read_tokens = total_cache_read_tokens.max(0) as u64;
    let total_input_tokens = total_input_tokens.max(0) as u64;
    let cache_hit_rate = if total_input_tokens > 0 {
        (total_cache_read_tokens as f64 / total_input_tokens as f64) * 100.0
    } else {
        0.0
    };
    let cache_stats = CacheStats {
        total_cache_read_tokens,
        total_input_tokens,
        cache_hit_rate,
        non_cached_input_tokens: total_input_tokens.saturating_sub(total_cache_read_tokens),
    };

    // Duration statistics
    let dur_sql = format!(
        "SELECT s.total_api_duration_ms FROM sessions s{} AND s.total_api_duration_ms IS NOT NULL AND s.total_api_duration_ms > 0",
        where_clause
    );
    let refs = to_refs(&bind_values);
    let durations = query_durations(conn, &dur_sql, &refs)?;
    let api_duration_stats = compute_duration_stats(&durations);

    // Productivity metrics
    let avg_turns_per_session = if sessions_with_turns > 0 {
        total_turns as f64 / sessions_with_turns as f64
    } else {
        0.0
    };
    let avg_tool_calls_per_turn = if total_turns > 0 {
        total_tool_calls as f64 / total_turns as f64
    } else {
        0.0
    };
    let avg_tokens_per_turn = if total_turns > 0 {
        total_tokens as f64 / total_turns as f64
    } else {
        0.0
    };
    let avg_tokens_per_api_second = if total_api_duration_ms_sum > 0 {
        total_tokens_with_duration as f64 / (total_api_duration_ms_sum as f64 / 1000.0)
    } else {
        0.0
    };

    // Incidents by day.
    //
    // NOTE: Incident counts (`error_count`, `rate_limit_count`, etc.) are pre-aggregated
    // on the session row with no per-segment or per-turn timestamps.  Incidents are
    // therefore attributed to the session's *last-active* date
    // (`COALESCE(updated_at, created_at)`), not to the exact day they occurred.  For
    // single-day sessions this is exact; for long-running sessions that span the range
    // boundary the chart date reflects when the session ended, not when each incident
    // happened.  Fixing this would require storing per-incident timestamps (future work).
    let ibd_sql = format!(
        "SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    COALESCE(SUM(s.error_count), 0),
                    COALESCE(SUM(s.rate_limit_count), 0),
                    COALESCE(SUM(s.compaction_count), 0),
                    COALESCE(SUM(s.truncation_count), 0)
             FROM sessions s{} AND d IS NOT NULL GROUP BY d ORDER BY d",
        where_clause
    );
    let refs = to_refs(&bind_values);
    let mut ibd_stmt = conn.prepare(&ibd_sql)?;
    let incidents_by_day: Vec<DayIncidents> = ibd_stmt
        .query_map(params_from_iter(refs.iter().copied()), |row| {
            Ok(DayIncidents {
                date: row.get(0)?,
                errors: row.get::<_, i64>(1)?.max(0) as u64,
                rate_limits: row.get::<_, i64>(2)?.max(0) as u64,
                compactions: row.get::<_, i64>(3)?.max(0) as u64,
                truncations: row.get::<_, i64>(4)?.max(0) as u64,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;

    Ok(AnalyticsData {
        total_sessions,
        total_tokens: total_tokens.max(0) as u64,
        total_cost,
        total_premium_requests,
        token_usage_by_day,
        activity_per_day,
        model_distribution,
        cost_by_day,
        model_usage_by_day,
        api_duration_stats,
        productivity_metrics: ProductivityMetrics {
            avg_turns_per_session,
            avg_tool_calls_per_turn,
            avg_tokens_per_turn,
            avg_tokens_per_api_second,
        },
        cache_stats,
        sessions_with_errors,
        total_rate_limits: total_rate_limits.max(0) as u64,
        total_compactions: total_compactions.max(0) as u64,
        total_truncations: total_truncations.max(0) as u64,
        incidents_by_day,
    })
}

#[derive(Default)]
struct DayModelUsageTotals {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    reasoning_tokens_sum: u64,
    has_reasoning_tokens: bool,
}

fn query_model_usage_by_day(
    conn: &Connection,
    where_clause: &str,
    bind_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<Vec<DayModelUsage>> {
    let mut totals: BTreeMap<(String, String), DayModelUsageTotals> = BTreeMap::new();

    let (segment_where, segment_values) = append_segment_date_filter(
        where_clause,
        bind_values,
        from_date,
        to_date,
        "m.end_timestamp",
    );
    let segment_sql = format!(
        "SELECT date(m.end_timestamp) as d, m.model_metrics_json
             FROM session_segments m
             JOIN sessions s ON s.id = m.session_id
             {} AND d IS NOT NULL AND m.model_metrics_json IS NOT NULL
             ORDER BY d",
        segment_where
    );
    let refs = to_refs(&segment_values);
    let mut stmt = conn.prepare(&segment_sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (date, json) = row?;
        let model_metrics: std::collections::HashMap<String, ModelMetricDetail> =
            serde_json::from_str(&json)?;
        for (model, detail) in model_metrics {
            add_model_usage(&mut totals, &date, &model, &detail);
        }
    }

    let fallback_sql = format!(
        "SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    m.model_name,
                    COALESCE(SUM(m.input_tokens), 0),
                    COALESCE(SUM(m.output_tokens), 0),
                    COALESCE(SUM(m.cache_read_tokens), 0),
                    COALESCE(SUM(m.cache_write_tokens), 0),
                    COALESCE(SUM(COALESCE(m.reasoning_tokens, 0)), 0),
                    MAX(CASE WHEN m.reasoning_tokens IS NOT NULL THEN 1 ELSE 0 END)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id{}
             AND d IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1 FROM session_segments seg WHERE seg.session_id = s.id
             )
             GROUP BY d, m.model_name
             ORDER BY d, m.model_name",
        where_clause
    );
    let refs = to_refs(bind_values);
    let mut stmt = conn.prepare(&fallback_sql)?;
    let fallback_rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
            row.get::<_, i64>(7)?,
        ))
    })?;
    for row in fallback_rows {
        let (date, model, input, output, cache_read, cache_write, reasoning, has_reasoning) = row?;
        let entry = totals.entry((date.clone(), model.clone())).or_default();
        entry.input_tokens += input.max(0) as u64;
        entry.output_tokens += output.max(0) as u64;
        entry.cache_read_tokens += cache_read.max(0) as u64;
        entry.cache_write_tokens += cache_write.max(0) as u64;
        if has_reasoning != 0 {
            entry.reasoning_tokens_sum += reasoning.max(0) as u64;
            entry.has_reasoning_tokens = true;
        }
    }

    Ok(totals
        .into_iter()
        .map(|((date, model), totals)| DayModelUsage {
            date,
            model,
            input_tokens: totals.input_tokens,
            output_tokens: totals.output_tokens,
            cache_read_tokens: totals.cache_read_tokens,
            cache_write_tokens: totals.cache_write_tokens,
            reasoning_tokens: if totals.has_reasoning_tokens {
                Some(totals.reasoning_tokens_sum)
            } else {
                None
            },
        })
        .collect())
}

fn add_model_usage(
    totals: &mut BTreeMap<(String, String), DayModelUsageTotals>,
    date: &str,
    model: &str,
    detail: &ModelMetricDetail,
) {
    let Some(usage) = detail.usage.as_ref() else {
        return;
    };
    let entry = totals
        .entry((date.to_string(), model.to_string()))
        .or_default();
    entry.input_tokens += usage.input_tokens.unwrap_or(0);
    entry.output_tokens += usage.output_tokens.unwrap_or(0);
    entry.cache_read_tokens += usage.cache_read_tokens.unwrap_or(0);
    entry.cache_write_tokens += usage.cache_write_tokens.unwrap_or(0);
    if let Some(reasoning_tokens) = usage.reasoning_tokens {
        entry.reasoning_tokens_sum += reasoning_tokens;
        entry.has_reasoning_tokens = true;
    }
}
