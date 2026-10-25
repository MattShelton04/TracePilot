//! Headline usage limited to the requested date range.
//!
//! A date range selects the sessions with activity in it: those last active
//! in it, and, for a range with an end date, those with a run (segment) that
//! ended in it ([`range_session_filter`]). A session last active in the range
//! contributes its lifetime total minus the segments that ended on a day
//! outside the range. Whatever the segments do not account for (a session
//! never split into segments, an undated shutdown, usage after the last
//! segment) stays with it, on its last-active day inside the range. A session
//! last active outside the range (resumed after it) contributes only its
//! segments that ended in the range: what its segments do not account for
//! belongs to its last-active day, outside the range. Either way the headline
//! totals match the day charts, which count every segment that ended in the
//! range. Without a date filter nothing is outside, so the totals stay the
//! lifetime values exactly.

use tracepilot_core::utils::InfallibleWrite;

/// Whether the session `s` was last active in the range, with its bind
/// values; `"1"` for an open range. Matches the date guard of
/// [`build_date_repo_filter`](super::build_date_repo_filter): an undated
/// session counts as inside.
fn last_active_in_range(from_date: Option<&str>, to_date: Option<&str>) -> (String, Vec<String>) {
    const DAY: &str = "date(COALESCE(s.updated_at, s.created_at))";
    const UNDATED: &str = "(s.updated_at IS NULL AND s.created_at IS NULL)";
    let mut parts = Vec::new();
    let mut values = Vec::new();
    if let Some(from) = from_date {
        parts.push(format!("({DAY} >= ? OR {UNDATED})"));
        values.push(from.to_string());
    }
    if let Some(to) = to_date {
        parts.push(format!("({DAY} <= ? OR {UNDATED})"));
        values.push(to.to_string());
    }
    if parts.is_empty() {
        return ("1".to_string(), values);
    }
    (format!("({})", parts.join(" AND ")), values)
}

/// `1` when the session `s` was last active outside the range (or on an
/// unreadable day), else `0`.
fn last_active_elsewhere(from_date: Option<&str>, to_date: Option<&str>) -> (String, Vec<String>) {
    let (inside, values) = last_active_in_range(from_date, to_date);
    (format!("CASE WHEN {inside} THEN 0 ELSE 1 END"), values)
}

/// Whether segment `alias` ended on a day in the range; `"1"` for an open
/// range. Undated segments are never in it.
fn segment_in_range(
    alias: &str,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> (String, Vec<String>) {
    let mut parts = Vec::new();
    let mut values = Vec::new();
    if let Some(from) = from_date {
        parts.push(format!("date({alias}.end_timestamp) >= ?"));
        values.push(from.to_string());
    }
    if let Some(to) = to_date {
        parts.push(format!("date({alias}.end_timestamp) <= ?"));
        values.push(to.to_string());
    }
    if parts.is_empty() {
        return ("1".to_string(), values);
    }
    (format!("({})", parts.join(" AND ")), values)
}

/// Whether segment `g` ended on a dated day outside the range; `"0"` for an
/// open range. Undated segments are never outside.
fn segment_outside(from_date: Option<&str>, to_date: Option<&str>) -> (String, Vec<String>) {
    let mut parts = Vec::new();
    let mut values = Vec::new();
    if let Some(from) = from_date {
        parts.push("date(g.end_timestamp) < ?");
        values.push(from.to_string());
    }
    if let Some(to) = to_date {
        parts.push("date(g.end_timestamp) > ?");
        values.push(to.to_string());
    }
    if parts.is_empty() {
        return ("0".to_string(), values);
    }
    (format!("({})", parts.join(" OR ")), values)
}

/// Whether a range can have late sessions (last active outside it, with a run
/// in it). Without an end date a late session would need a run that ended
/// after its last activity, so open-ended ranges (presets) skip that work.
fn has_late_sessions(to_date: Option<&str>) -> bool {
    to_date.is_some()
}

/// The sessions with activity in the range: `base_where` (a
/// [`build_date_repo_filter`](super::build_date_repo_filter) clause without
/// dates, plus any source filter) narrowed to the sessions last active in
/// the range or, with an end date, with a segment that ended in it. Without
/// a date filter it is `base_where` unchanged.
pub(in crate::index_db) fn range_session_filter(
    base_where: &str,
    base_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> (String, Vec<String>) {
    if from_date.is_none() && to_date.is_none() {
        return (base_where.to_string(), base_values.to_vec());
    }
    let (last_active, mut values) = last_active_in_range(from_date, to_date);
    let mut clause = base_where.to_string();
    if has_late_sessions(to_date) {
        let (ran, ran_values) = segment_in_range("x", from_date, to_date);
        values.extend(ran_values);
        // Correlated on purpose: SQLite probes a session's own segments (by
        // the `session_id` key) only when it was not last active in the
        // range. An uncorrelated `s.id IN (SELECT ...)` scans every segment
        // once per copy of this clause.
        clause.push_fmt(format_args!(
            " AND ({last_active} OR EXISTS (
                SELECT 1 FROM session_segments x WHERE x.session_id = s.id AND {ran}))"
        ));
    } else {
        clause.push_fmt(format_args!(" AND {last_active}"));
    }
    let mut all = base_values.to_vec();
    all.extend(values);
    (clause, all)
}

/// Per-session segment sums, as alias `o`, among the sessions the filter
/// selects. `late` is 1 for a session last active outside the range.
///
/// A session last active in the range (`late` 0) has the sums of its
/// segments that ended outside the range: `tokens`, `premium`, `nano_aiu`,
/// `cost_usd`, `unpriced` (segments with no USD figure) and, with
/// `legacy_cost`, `cost` (legacy model-reported cost from the segments' model
/// metrics). A late session has the same sums, with an `in_` prefix, of its
/// segments that ended in the range. Each session reads only the sums for
/// its kind, so the other columns are `NULL`, and only the segments those
/// sums need are scanned. A session with neither has no row, which counts as
/// not late with nothing outside; [`range_session_filter`] selects a late
/// session only for a run in the range, so every late session has one.
/// Without an end date no session is late, so only the first kind is built;
/// without a date filter nothing is outside either, so no session has a row.
///
/// `where_clause` and `bind_values` are the sessions filter
/// ([`range_session_filter`], or a narrower one). Returns the `LEFT JOIN`
/// fragment to place between `FROM sessions s` and `where_clause`, and every
/// bind value for that statement in order.
pub(in crate::index_db) fn out_of_range_join(
    where_clause: &str,
    bind_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
    legacy_cost: bool,
) -> (String, Vec<String>) {
    let (outside, mut values) = segment_outside(from_date, to_date);
    let with_late = has_late_sessions(to_date);
    let (late, late_values) = if with_late {
        last_active_elsewhere(from_date, to_date)
    } else {
        (String::new(), Vec::new())
    };
    // The selected sessions of one kind; with no late branch, all of them.
    let selected = |is_late: u8| {
        if from_date.is_none() && to_date.is_none() {
            return String::new();
        }
        let kind = if with_late {
            format!(" AND {late} = {is_late}")
        } else {
            String::new()
        };
        format!(" AND g.session_id IN (SELECT s.id FROM sessions s{where_clause}{kind})")
    };
    if from_date.is_some() || to_date.is_some() {
        values.extend(bind_values.iter().cloned());
        values.extend(late_values.iter().cloned());
    }
    let late_branch = if with_late {
        let (ran, ran_values) = segment_in_range("g", from_date, to_date);
        values.extend(ran_values);
        values.extend(bind_values.iter().cloned());
        values.extend(late_values);
        Some(ran)
    } else {
        None
    };
    values.extend(bind_values.iter().cloned());

    let mut sums = vec![
        ("tokens", "SUM(g.total_tokens)"),
        ("premium", "SUM(g.total_premium_requests)"),
        ("nano_aiu", "SUM(g.total_nano_aiu)"),
        ("cost_usd", "SUM(g.cost_usd)"),
        ("unpriced", "COUNT(*) - COUNT(g.cost_usd)"),
    ];
    if legacy_cost {
        sums.push((
            "cost",
            "SUM((SELECT SUM(json_extract(j.value, '$.requests.cost'))
                  FROM json_each(g.model_metrics_json) j))",
        ));
    }
    // One branch per kind of session: the sums it reads, `NULL` for the rest.
    // The two branches select disjoint sessions, so each has one row at most.
    let branch = |is_late: u8, segments: &str| {
        let mut columns = String::new();
        for prefix in ["", "in_"] {
            let live = (prefix == "in_") == (is_late == 1);
            for (name, sum) in &sums {
                let expr = if live { *sum } else { "NULL" };
                columns.push_fmt(format_args!(", {expr} AS {prefix}{name}"));
            }
        }
        format!(
            "SELECT g.session_id, {is_late} AS late{columns}
             FROM session_segments g
             WHERE {segments}{}
             GROUP BY g.session_id",
            selected(is_late)
        )
    };
    let mut join = format!(" LEFT JOIN (\n            {}", branch(0, &outside));
    if let Some(ran) = late_branch {
        join.push_fmt(format_args!(
            "\n            UNION ALL\n            {}",
            branch(1, &ran)
        ));
    }
    join.push_str("\n        ) o ON o.session_id = s.id");
    (join, values)
}

/// A `WITH mr AS (...)` clause: one row per selected session and model with
/// its in-range usage. Columns: `source`, `model_name`, `input_tokens`,
/// `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost`
/// (legacy), `request_count`, `reasoning_tokens` and `total_nano_aiu`
/// (`NULL` when never observed for the model), and `cost_usd`.
///
/// A session last active in the range has the lifetime
/// `session_model_metrics` row minus that model's usage in the session's
/// segments outside the range. A session last active outside it has the
/// model's usage in its segments that ended in the range. Segments record no
/// per-model USD, so a model that also ran outside the range has an unknown
/// (`NULL`) `cost_usd` for that session, as do all models of a session last
/// active outside it. A model left with no usage in the range has no row.
/// Without a date filter the rows are the lifetime rows.
pub(in crate::index_db) fn in_range_models_cte(
    where_clause: &str,
    bind_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> (String, Vec<String>) {
    let (outside, mut values) = segment_outside(from_date, to_date);
    let with_late = has_late_sessions(to_date);
    // Only sessions last active in the range subtract their outside runs.
    // Without late sessions the filter selects only those already.
    let (last_active, last_active_values) = if with_late {
        let (last_active, last_active_values) = last_active_in_range(from_date, to_date);
        (format!(" AND {last_active}"), last_active_values)
    } else {
        (String::new(), Vec::new())
    };
    let outside_filter = if from_date.is_none() && to_date.is_none() {
        outside
    } else {
        values.extend(bind_values.iter().cloned());
        values.extend(last_active_values.iter().cloned());
        format!(
            "{outside} AND g.session_id IN (
                SELECT s.id FROM sessions s{where_clause}{last_active})"
        )
    };
    values.extend(bind_values.iter().cloned());
    values.extend(last_active_values);

    let field = |path: &str| format!("SUM(COALESCE(json_extract(j.value, '$.{path}'), 0))");
    let (input, output) = (field("usage.inputTokens"), field("usage.outputTokens"));
    let (cache_read, cache_write) = (
        field("usage.cacheReadTokens"),
        field("usage.cacheWriteTokens"),
    );
    let (requests, cost) = (field("requests.count"), field("requests.cost"));
    // Sessions last active outside the range: their in-range segments alone.
    let late_rows = if !with_late {
        String::new()
    } else {
        let (late, late_values) = last_active_elsewhere(from_date, to_date);
        let (ran, ran_values) = segment_in_range("g", from_date, to_date);
        values.extend(bind_values.iter().cloned());
        values.extend(late_values);
        values.extend(ran_values);
        format!(
            "
                UNION ALL
                SELECT s.source, j.key, {input}, {output}, {cache_read}, {cache_write},
                       {cost}, {requests},
                       SUM(json_extract(j.value, '$.usage.reasoningTokens')),
                       SUM(json_extract(j.value, '$.totalNanoAiu')),
                       NULL, 1
                FROM session_segments g JOIN sessions s ON s.id = g.session_id,
                     json_each(g.model_metrics_json) j{where_clause}
                  AND {late} = 1 AND {ran}
                GROUP BY s.id, j.key"
        )
    };
    let cte = format!(
        "WITH mr AS (
            SELECT * FROM (
                SELECT s.source AS source, m.model_name AS model_name,
                       MAX(0, m.input_tokens - COALESCE(om.input, 0)) AS input_tokens,
                       MAX(0, m.output_tokens - COALESCE(om.output, 0)) AS output_tokens,
                       MAX(0, m.cache_read_tokens - COALESCE(om.cache_read, 0)) AS cache_read_tokens,
                       MAX(0, m.cache_write_tokens - COALESCE(om.cache_write, 0)) AS cache_write_tokens,
                       MAX(0.0, m.cost - COALESCE(om.cost, 0.0)) AS cost,
                       MAX(0, m.request_count - COALESCE(om.requests, 0)) AS request_count,
                       MAX(0, m.reasoning_tokens - COALESCE(om.reasoning, 0)) AS reasoning_tokens,
                       MAX(0, m.total_nano_aiu - COALESCE(om.nano_aiu, 0)) AS total_nano_aiu,
                       CASE WHEN om.session_id IS NULL THEN m.cost_usd END AS cost_usd,
                       om.session_id IS NOT NULL AS ran_outside
                FROM session_model_metrics m
                JOIN sessions s ON s.id = m.session_id
                LEFT JOIN (
                    SELECT g.session_id, j.key AS model,
                           {input} AS input, {output} AS output,
                           {cache_read} AS cache_read, {cache_write} AS cache_write,
                           {reasoning} AS reasoning, {requests} AS requests,
                           {cost} AS cost, {nano} AS nano_aiu
                    FROM session_segments g, json_each(g.model_metrics_json) j
                    WHERE {outside_filter}
                    GROUP BY g.session_id, j.key
                ) om ON om.session_id = m.session_id AND om.model = m.model_name{where_clause}{last_active}{late_rows}
            )
            WHERE NOT (ran_outside
                AND COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
                    + COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0)
                    + COALESCE(request_count, 0) + COALESCE(total_nano_aiu, 0) = 0
                AND COALESCE(cost, 0) = 0)
        )",
        reasoning = field("usage.reasoningTokens"),
        nano = field("totalNanoAiu"),
    );
    (cte, values)
}

/// In-range tokens for one session; needs [`out_of_range_join`].
pub(in crate::index_db) const IN_RANGE_TOKENS: &str = "CASE WHEN o.late THEN COALESCE(o.in_tokens, 0) \
     ELSE MAX(0, s.total_tokens - COALESCE(o.tokens, 0)) END";
/// In-range legacy model-reported cost; `NULL` when the session has none.
/// Needs [`out_of_range_join`] with `legacy_cost`.
pub(in crate::index_db) const IN_RANGE_COST: &str = "CASE WHEN o.late THEN o.in_cost \
     ELSE MAX(0.0, s.total_cost - COALESCE(o.cost, 0.0)) END";
/// In-range premium requests; `NULL` when the session has none.
pub(in crate::index_db) const IN_RANGE_PREMIUM: &str = "CASE WHEN o.late THEN o.in_premium \
     ELSE MAX(0.0, s.total_premium_requests - COALESCE(o.premium, 0.0)) END";
/// In-range AI Credits in nano units; `NULL` when none were observed.
pub(in crate::index_db) const IN_RANGE_NANO_AIU: &str = "CASE WHEN o.late THEN o.in_nano_aiu \
     ELSE MAX(0, s.total_nano_aiu - COALESCE(o.nano_aiu, 0)) END";
/// In-range provider USD. Unknown (`NULL`) when a run it counts is unpriced;
/// for a session last active in the range, also when the session is
/// unpriced or a run outside the range is, since that share cannot be
/// removed.
pub(in crate::index_db) const IN_RANGE_COST_USD: &str = "CASE \
     WHEN o.late THEN CASE WHEN o.in_unpriced > 0 THEN NULL ELSE o.in_cost_usd END \
     WHEN COALESCE(o.unpriced, 0) > 0 THEN NULL \
     ELSE MAX(0.0, s.cost_usd - COALESCE(o.cost_usd, 0.0)) END";
/// 1 when the session is counted from its in-range segments alone (last
/// active outside the range); needs [`out_of_range_join`].
pub(in crate::index_db) const LAST_ACTIVE_ELSEWHERE: &str = "COALESCE(o.late, 0)";
