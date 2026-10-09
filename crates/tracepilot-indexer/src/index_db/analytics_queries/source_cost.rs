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
/// order.
pub(super) fn query_cost_by_source(
    conn: &Connection,
    where_clause: &str,
    bind_values: &[String],
) -> Result<Vec<SourceCostEntry>> {
    let sql = format!(
        "SELECT s.source, COUNT(*), COALESCE(SUM(s.total_tokens), 0),
                SUM(s.cost_usd), COUNT(s.cost_usd)
         FROM sessions s{}
         GROUP BY s.source",
        where_clause
    );
    let refs = to_refs(bind_values);
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
