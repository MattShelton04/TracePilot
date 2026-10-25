//! Cost split by source. Each source keeps its own unit: Copilot is billed in
//! AI Credits (priced from model usage), Claude Code has provider USD
//! estimates in `cost_usd`. Nothing here sums cost across sources.

use crate::Result;
use rusqlite::{Connection, params_from_iter};

use tracepilot_core::analytics::types::{DayCost, SourceCostEntry};
use tracepilot_core::provider::SessionSource;

use super::super::helpers::*;
use super::day_bucket::{DayBucketSpec, query_day_bucketed};

/// One entry per source with sessions in the filter, in `SessionSource::ALL`
/// order. Sessions are the ones with activity in the range; tokens and USD
/// count only usage inside the range, like the dashboard's headline totals
/// (see `helpers::range_usage`).
pub(super) fn query_cost_by_source(
    conn: &Connection,
    where_clause: &str,
    bind_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<Vec<SourceCostEntry>> {
    let (usage_join, values) =
        out_of_range_join(where_clause, bind_values, from_date, to_date, false);
    let sql = format!(
        "SELECT s.source, COUNT(*), COALESCE(SUM({IN_RANGE_TOKENS}), 0),
                SUM({IN_RANGE_COST_USD}), COUNT({IN_RANGE_COST_USD})
         FROM sessions s{usage_join}{where_clause}
         GROUP BY s.source"
    );
    let refs = to_refs(&values);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, u32>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, Option<f64>>(3)?,
            row.get::<_, u32>(4)?,
        ))
    })?;
    let mut entries = Vec::new();
    for row in rows {
        let (source, sessions, tokens, cost_usd, sessions_with_cost_usd) = row?;
        let Some(source) = SessionSource::from_stored(&source) else {
            continue;
        };
        entries.push(SourceCostEntry {
            source,
            sessions,
            tokens: tokens.max(0) as u64,
            cost_usd,
            sessions_with_cost_usd,
        });
    }
    entries.sort_by_key(|entry| entry.source);
    Ok(entries)
}

/// Provider USD per day from per-run segments, bucketed by the day each run
/// ended like the other per-day charts. Days with no USD figure are absent.
///
/// `where_clause` must not carry the session last-activity date guard; the
/// range applies to each run's `m.end_timestamp` (see `query_analytics`).
pub(super) fn query_cost_usd_by_day(
    conn: &Connection,
    where_clause: &str,
    bind_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<Vec<DayCost>> {
    query_day_bucketed(
        conn,
        DayBucketSpec {
            from_clause: "session_segments m JOIN sessions s ON s.id = m.session_id",
            aggregate_expr: "SUM(m.cost_usd)",
            bucket_column: "m.end_timestamp",
        },
        &format!("{where_clause} AND m.cost_usd IS NOT NULL"),
        bind_values,
        from_date,
        to_date,
        |row| {
            Ok(DayCost {
                date: row.get(0)?,
                cost: row.get(1)?,
            })
        },
    )
}
