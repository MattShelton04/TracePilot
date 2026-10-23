use crate::Result;
use rusqlite::{Connection, params_from_iter};

use tracepilot_core::analytics::types::*;
use tracepilot_core::provider::SessionSource;

use super::super::helpers::*;
use super::day_bucket::{DayBucketSpec, query_day_bucketed};
use super::model_usage_by_day::{DayFilters, query_model_usage_by_day};

/// FROM/JOIN fragment shared by all three day-bucketed dashboard charts.
const SEGMENTS_JOIN_SESSIONS: &str = "session_segments m JOIN sessions s ON s.id = m.session_id";

pub(super) fn query_analytics(
    conn: &Connection,
    from_date: Option<&str>,
    to_date: Option<&str>,
    repo: Option<&str>,
    hide_empty: bool,
    source: Option<SessionSource>,
) -> Result<AnalyticsData> {
    let repo = RepositoryScope::resolve(conn, repo.as_slice(), false)?;
    let (mut where_clause, mut bind_values) =
        build_date_repo_filter(from_date, to_date, repo.as_ref(), hide_empty);
    append_source_filter(&mut where_clause, &mut bind_values, source);

    // Per-run series select runs by the day each one ended, so they skip the
    // session last-activity guard: a run that ended in the range counts even
    // when its session was resumed later. The range itself is applied to
    // `m.end_timestamp` by `query_day_bucketed` / `append_segment_date_filter`.
    let (mut run_where, mut run_values) =
        build_date_repo_filter(None, None, repo.as_ref(), hide_empty);
    append_source_filter(&mut run_where, &mut run_values, source);

    // Aggregate session-level stats.
    //
    // Sessions are selected and counted by their last-active day. Their usage
    // (tokens, cost, premium requests, AI Credits) counts only inside the
    // range: each session's lifetime total minus its segments that ended on a
    // day outside it. Without a date filter they are the lifetime totals.
    // Turns, tool calls, compactions, truncations and the per-turn and
    // per-second averages stay whole-session values; per-model usage below
    // follows the same rule. Rate limits are the incident day rows' sum, and
    // sessions with errors are the sessions behind those rows.
    // See `helpers::range_usage`.
    //
    // The day charts count the same in-range runs plus runs of sessions last
    // active after the range (see `run_where` above), which these totals
    // leave out because the session is not selected.
    let (usage_join, agg_values) =
        out_of_range_join(&where_clause, &bind_values, from_date, to_date, true);
    let agg_sql = format!(
        "SELECT COUNT(*), COALESCE(SUM({IN_RANGE_TOKENS}), 0), COALESCE(SUM({IN_RANGE_COST}), 0.0),
                    COALESCE(SUM(turn_count), 0), COALESCE(SUM(tool_call_count), 0),
                    COUNT(CASE WHEN turn_count > 0 THEN 1 END),
                    COALESCE(SUM({IN_RANGE_PREMIUM}), 0.0),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN total_api_duration_ms END), 0),
                    COALESCE(SUM(CASE WHEN total_api_duration_ms > 0 THEN
                        (SELECT SUM(m.output_tokens) FROM session_model_metrics m WHERE m.session_id = s.id)
                    END), 0),
                    COALESCE(SUM(compaction_count), 0),
                    COALESCE(SUM(truncation_count), 0),
                    COALESCE(SUM({IN_RANGE_NANO_AIU}), 0),
                    COUNT(CASE WHEN total_nano_aiu IS NOT NULL THEN 1 END),
                    COALESCE(SUM(s.total_tokens), 0)
             FROM sessions s{usage_join}{where_clause}"
    );
    let refs = to_refs(&agg_values);
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
        output_tokens_with_duration,
        total_compactions,
        total_truncations,
        total_nano_aiu,
        sessions_with_observed_ai_credits,
        lifetime_tokens,
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
        i64,
        i64,
        i64,
        u32,
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
            row.get(13)?,
        ))
    })?;

    // Tokens by day — runs whose end_timestamp falls in the requested window.
    let token_usage_by_day = query_day_bucketed(
        conn,
        DayBucketSpec {
            from_clause: SEGMENTS_JOIN_SESSIONS,
            aggregate_expr: "COALESCE(SUM(m.total_tokens), 0)",
            bucket_column: "m.end_timestamp",
        },
        &run_where,
        &run_values,
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
        &run_where,
        &run_values,
        from_date,
        to_date,
        |row| {
            Ok(DayActivity {
                date: row.get(0)?,
                count: row.get(1)?,
            })
        },
    )?;

    // Premium requests by day — runs whose end_timestamp falls in the window.
    let cost_by_day = query_day_bucketed(
        conn,
        DayBucketSpec {
            from_clause: SEGMENTS_JOIN_SESSIONS,
            aggregate_expr: "COALESCE(SUM(m.total_premium_requests), 0.0)",
            bucket_column: "m.end_timestamp",
        },
        &run_where,
        &run_values,
        from_date,
        to_date,
        |row| {
            Ok(DayCost {
                date: row.get(0)?,
                cost: row.get(1)?,
            })
        },
    )?;
    let model_usage_by_day = query_model_usage_by_day(
        conn,
        DayFilters {
            runs: (&run_where, &run_values),
            sessions: (&where_clause, &bind_values),
            from_date,
            to_date,
        },
    )?;

    // Per-model usage follows the headline rule, so the token composition,
    // model shares and the AI Credit estimate cover the same usage.
    let (models_cte, models_values) =
        in_range_models_cte(&where_clause, &bind_values, from_date, to_date);
    let mdist_sql = format!(
        "{models_cte}
         SELECT model_name,
                    SUM(input_tokens + output_tokens),
                    SUM(input_tokens),
                    SUM(output_tokens),
                    SUM(cache_read_tokens),
                    SUM(cache_write_tokens),
                    SUM(cost),
                    SUM(request_count),
                    SUM(COALESCE(reasoning_tokens, 0)),
                    MAX(CASE WHEN reasoning_tokens IS NOT NULL THEN 1 ELSE 0 END),
                    SUM(COALESCE(total_nano_aiu, 0)),
                    MAX(CASE WHEN total_nano_aiu IS NOT NULL THEN 1 ELSE 0 END),
                    SUM(CASE WHEN total_nano_aiu IS NULL THEN input_tokens ELSE 0 END),
                    SUM(CASE WHEN total_nano_aiu IS NULL THEN output_tokens ELSE 0 END),
                    SUM(CASE WHEN total_nano_aiu IS NULL THEN cache_read_tokens ELSE 0 END),
                    SUM(CASE WHEN total_nano_aiu IS NULL THEN cache_write_tokens ELSE 0 END),
                    source,
                    SUM(cost_usd),
                    COUNT(cost_usd) > 0 AND COUNT(cost_usd) < COUNT(*)
             FROM mr
             GROUP BY model_name, source ORDER BY 2 DESC"
    );
    let refs = to_refs(&models_values);
    let model_distribution = query_model_distribution(conn, &mdist_sql, &refs)?;

    let cache_sql = format!(
        "{models_cte}
         SELECT COALESCE(SUM(cache_read_tokens), 0), COALESCE(SUM(input_tokens), 0) FROM mr"
    );
    let refs = to_refs(&models_values);
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

    let dur_sql = format!(
        "SELECT s.total_api_duration_ms FROM sessions s{} AND s.total_api_duration_ms IS NOT NULL AND s.total_api_duration_ms > 0",
        where_clause
    );
    let refs = to_refs(&bind_values);
    let durations = query_durations(conn, &dur_sql, &refs)?;
    let api_duration_stats = compute_duration_stats(&durations);

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
    // Whole-session tokens over whole-session turns.
    let avg_tokens_per_turn = if total_turns > 0 {
        lifetime_tokens as f64 / total_turns as f64
    } else {
        0.0
    };
    let avg_tokens_per_api_second = if total_api_duration_ms_sum > 0 {
        output_tokens_with_duration as f64 / (total_api_duration_ms_sum as f64 / 1000.0)
    } else {
        0.0
    };

    let incidents_by_day = query_incidents_by_day(
        conn,
        (&where_clause, &bind_values),
        (&run_where, &run_values),
        from_date,
        to_date,
    )?;
    // The day rows' sum, so the headline and the charts count the same.
    let total_rate_limits: u64 = incidents_by_day.iter().map(|d| d.rate_limits).sum();
    let sessions_with_errors =
        query_sessions_with_errors(conn, &run_where, &run_values, from_date, to_date)?;

    Ok(AnalyticsData {
        total_sessions,
        total_tokens: total_tokens.max(0) as u64,
        total_cost,
        total_premium_requests,
        total_nano_aiu: total_nano_aiu.max(0) as u64,
        sessions_with_observed_ai_credits,
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
        total_rate_limits,
        total_compactions: total_compactions.max(0) as u64,
        total_truncations: total_truncations.max(0) as u64,
        incidents_by_day,
        prompt_cache: super::prompt_cache::query_prompt_cache(
            conn,
            &where_clause,
            &bind_values,
            from_date,
            to_date,
        )?,
        cost_by_source: super::source_cost::query_cost_by_source(
            conn,
            &where_clause,
            &bind_values,
            from_date,
            to_date,
        )?,
        cost_usd_by_day: super::source_cost::query_cost_usd_by_day(
            conn,
            &run_where,
            &run_values,
            from_date,
            to_date,
        )?,
    })
}

/// The day an incident happened; an untimestamped one takes its session's
/// last-active day.
const INCIDENT_DAY: &str =
    "COALESCE(date(i.timestamp), date(COALESCE(s.updated_at, s.created_at)))";

/// Sessions with an error or rate limit on a day in the range: the sessions
/// behind the incident day rows' error and rate-limit counts, selected the
/// same way (see [`query_incidents_by_day`]).
fn query_sessions_with_errors(
    conn: &Connection,
    run_where: &str,
    run_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<u32> {
    let (where_clause, values) =
        append_segment_date_filter(run_where, run_values, from_date, to_date, INCIDENT_DAY);
    let sql = format!(
        "SELECT COUNT(DISTINCT i.session_id)
         FROM session_incidents i JOIN sessions s ON s.id = i.session_id
         {where_clause} AND i.event_type = 'error' AND {INCIDENT_DAY} IS NOT NULL"
    );
    let refs = to_refs(&values);
    Ok(
        conn.query_row(&sql, params_from_iter(refs.iter().copied()), |row| {
            row.get(0)
        })?,
    )
}

/// Incidents by day.
///
/// Every error and rate limit has its own timestamped `session_incidents` row
/// (analytics v20), so they count on the day they happened, selected like the
/// runs: by that day alone, with the repository, source and hide-empty
/// filters (`runs`). Compaction and truncation rows stop at
/// `MAX_INCIDENTS_PER_SESSION`, so those two stay the session's counts on its
/// last-active day, for the sessions `sessions` selects. Each of those
/// sessions' days has a row, even with no incidents.
fn query_incidents_by_day(
    conn: &Connection,
    sessions: (&str, &[String]),
    runs: (&str, &[String]),
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<Vec<DayIncidents>> {
    let (where_clause, bind_values) = sessions;
    let session_sql = format!(
        "SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    COALESCE(SUM(s.compaction_count), 0),
                    COALESCE(SUM(s.truncation_count), 0)
             FROM sessions s{where_clause} AND d IS NOT NULL GROUP BY d"
    );
    let refs = to_refs(bind_values);
    let mut stmt = conn.prepare(&session_sql)?;
    let session_rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    let mut counts: Vec<(String, i64, i64, i64, i64)> = Vec::new();
    for row in session_rows {
        let (date, compactions, truncations) = row?;
        counts.push((date, 0, 0, compactions, truncations));
    }

    let (run_where, run_values) = runs;
    let error_where = format!("{run_where} AND i.event_type = 'error'");
    let errors = query_day_bucketed(
        conn,
        DayBucketSpec {
            from_clause: "session_incidents i JOIN sessions s ON s.id = i.session_id",
            aggregate_expr: "COUNT(*), COUNT(CASE WHEN
                CASE WHEN json_valid(i.detail_json) THEN json_extract(i.detail_json, '$.errorType') END
                = 'rate_limit' THEN 1 END)",
            bucket_column: INCIDENT_DAY,
        },
        &error_where,
        run_values,
        from_date,
        to_date,
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )?;
    counts.extend(
        errors
            .into_iter()
            .map(|(date, errors, rate_limits)| (date, errors, rate_limits, 0, 0)),
    );

    let mut by_day: std::collections::BTreeMap<String, DayIncidents> = Default::default();
    for (date, errors, rate_limits, compactions, truncations) in counts {
        let entry = by_day.entry(date.clone()).or_insert(DayIncidents {
            date,
            errors: 0,
            rate_limits: 0,
            compactions: 0,
            truncations: 0,
        });
        entry.errors += errors.max(0) as u64;
        entry.rate_limits += rate_limits.max(0) as u64;
        entry.compactions += compactions.max(0) as u64;
        entry.truncations += truncations.max(0) as u64;
    }
    Ok(by_day.into_values().collect())
}
