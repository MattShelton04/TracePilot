//! Headline usage limited to the requested date range.
//!
//! Sessions are selected by their last-active day, but a session resumed
//! across days also holds usage from runs that ended before (or after) the
//! range. Each session contributes its lifetime total minus the segments that
//! ended on a day outside the range, so headline totals match the day charts,
//! which count only in-range segments. Whatever the segments do not account
//! for (a session never split into segments, an undated shutdown, usage after
//! the last segment) stays with the session, on its last-active day inside the
//! range. Without a date filter nothing is outside, so the totals stay the
//! lifetime values exactly.

use tracepilot_core::utils::InfallibleWrite;

/// The `WHERE` body selecting the segments `g` that ended on a dated day
/// outside the range, among the sessions the filter selects, with its bind
/// values. `"0"` (nothing) for an open range. Undated segments are never
/// outside.
fn outside_segments(
    where_clause: &str,
    bind_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> (String, Vec<String>) {
    let mut outside = Vec::new();
    let mut values = Vec::new();
    if let Some(from) = from_date {
        outside.push("date(g.end_timestamp) < ?");
        values.push(from.to_string());
    }
    if let Some(to) = to_date {
        outside.push("date(g.end_timestamp) > ?");
        values.push(to.to_string());
    }
    if outside.is_empty() {
        return ("0".to_string(), values);
    }
    values.extend(bind_values.iter().cloned());
    let filter = format!(
        "({}) AND g.session_id IN (SELECT s.id FROM sessions s{where_clause})",
        outside.join(" OR ")
    );
    (filter, values)
}

/// Per-session sums of the segments that ended outside the range, as alias
/// `o`: `tokens`, `premium`, `nano_aiu`, `cost_usd`, `unpriced` (segments with
/// no USD figure) and, with `legacy_cost`, `cost` (legacy model-reported cost
/// from the segments' model metrics).
///
/// `where_clause` and `bind_values` are the sessions filter
/// ([`build_date_repo_filter`](super::build_date_repo_filter)); only the
/// selected sessions' segments are read. Returns the `LEFT JOIN` fragment to
/// place between `FROM sessions s` and `where_clause`, and every bind value
/// for that statement in order.
pub(in crate::index_db) fn out_of_range_join(
    where_clause: &str,
    bind_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
    legacy_cost: bool,
) -> (String, Vec<String>) {
    let (filter, mut values) = outside_segments(where_clause, bind_values, from_date, to_date);
    values.extend(bind_values.iter().cloned());
    let cost = if legacy_cost {
        "SUM((SELECT SUM(json_extract(j.value, '$.requests.cost'))
                        FROM json_each(g.model_metrics_json) j)) AS cost,"
    } else {
        ""
    };
    let mut join = String::new();
    join.push_fmt(format_args!(
        " LEFT JOIN (
            SELECT g.session_id,
                   SUM(g.total_tokens) AS tokens,
                   {cost}
                   SUM(g.total_premium_requests) AS premium,
                   SUM(g.total_nano_aiu) AS nano_aiu,
                   SUM(g.cost_usd) AS cost_usd,
                   COUNT(*) - COUNT(g.cost_usd) AS unpriced
            FROM session_segments g
            WHERE {filter}
            GROUP BY g.session_id
        ) o ON o.session_id = s.id"
    ));
    (join, values)
}

/// A `WITH mr AS (...)` clause: one row per selected session and model with
/// its in-range usage, the lifetime `session_model_metrics` row minus that
/// model's usage in the session's segments outside the range. Columns:
/// `source`, `model_name`, `input_tokens`, `output_tokens`,
/// `cache_read_tokens`, `cache_write_tokens`, `cost` (legacy),
/// `request_count`, `reasoning_tokens`, `total_nano_aiu` (`NULL` when never
/// observed for the model) and `cost_usd`.
///
/// Segments record no per-model USD, so a model that also ran outside the
/// range has an unknown (`NULL`) `cost_usd` for that session. A model left
/// with no usage in the range has no row. Without a date filter the rows are
/// the lifetime rows.
pub(in crate::index_db) fn in_range_models_cte(
    where_clause: &str,
    bind_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> (String, Vec<String>) {
    let (filter, mut values) = outside_segments(where_clause, bind_values, from_date, to_date);
    values.extend(bind_values.iter().cloned());
    let field = |path: &str| format!("SUM(COALESCE(json_extract(j.value, '$.{path}'), 0))");
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
                    WHERE {filter}
                    GROUP BY g.session_id, j.key
                ) om ON om.session_id = m.session_id AND om.model = m.model_name{where_clause}
            )
            WHERE NOT (ran_outside
                AND COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
                    + COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0)
                    + COALESCE(request_count, 0) + COALESCE(total_nano_aiu, 0) = 0
                AND COALESCE(cost, 0) = 0)
        )",
        input = field("usage.inputTokens"),
        output = field("usage.outputTokens"),
        cache_read = field("usage.cacheReadTokens"),
        cache_write = field("usage.cacheWriteTokens"),
        reasoning = field("usage.reasoningTokens"),
        requests = field("requests.count"),
        cost = field("requests.cost"),
        nano = field("totalNanoAiu"),
    );
    (cte, values)
}

/// In-range tokens for one session; needs [`out_of_range_join`].
pub(in crate::index_db) const IN_RANGE_TOKENS: &str =
    "MAX(0, s.total_tokens - COALESCE(o.tokens, 0))";
/// In-range legacy model-reported cost; `NULL` when the session has none.
pub(in crate::index_db) const IN_RANGE_COST: &str =
    "MAX(0.0, s.total_cost - COALESCE(o.cost, 0.0))";
/// In-range premium requests; `NULL` when the session has none.
pub(in crate::index_db) const IN_RANGE_PREMIUM: &str =
    "MAX(0.0, s.total_premium_requests - COALESCE(o.premium, 0.0))";
/// In-range AI Credits in nano units; `NULL` when none were observed.
pub(in crate::index_db) const IN_RANGE_NANO_AIU: &str =
    "MAX(0, s.total_nano_aiu - COALESCE(o.nano_aiu, 0))";
/// In-range provider USD. Unknown (`NULL`) when the session is unpriced, or
/// when a run outside the range is, since its share cannot be removed.
pub(in crate::index_db) const IN_RANGE_COST_USD: &str = "CASE WHEN COALESCE(o.unpriced, 0) > 0 THEN NULL \
     ELSE MAX(0.0, s.cost_usd - COALESCE(o.cost_usd, 0.0)) END";
