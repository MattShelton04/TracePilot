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

/// Per-session sums of the segments that ended outside the range, as alias
/// `o`: `tokens`, `cost` (legacy model-reported cost from the segment's model
/// metrics), `premium`, `nano_aiu`, `cost_usd` and `unpriced` (segments with
/// no USD figure). Undated segments are never outside.
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
    let filter = if outside.is_empty() {
        // Nothing is outside an open range.
        "0".to_string()
    } else {
        values.extend(bind_values.iter().cloned());
        format!(
            "({}) AND g.session_id IN (SELECT s.id FROM sessions s{where_clause})",
            outside.join(" OR ")
        )
    };
    values.extend(bind_values.iter().cloned());
    let mut join = String::new();
    join.push_fmt(format_args!(
        " LEFT JOIN (
            SELECT g.session_id,
                   SUM(g.total_tokens) AS tokens,
                   SUM((SELECT SUM(json_extract(j.value, '$.requests.cost'))
                        FROM json_each(g.model_metrics_json) j)) AS cost,
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
