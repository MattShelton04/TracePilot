//! SQL query helpers and statistical functions for the index database.

use anyhow::Result;
use rusqlite::{params_from_iter, types::ToSql, Connection};

use tracepilot_core::analytics::types::*;

/// Build a WHERE clause for date range + repo filtering on the sessions table.
///
/// Returns `(where_clause, bind_values)` where `where_clause` starts with
/// `" WHERE 1=1"` and may include additional AND conditions.
pub(super) fn build_date_repo_filter(
    from_date: Option<&str>,
    to_date: Option<&str>,
    repo: Option<&str>,
    hide_empty: bool,
) -> (String, Vec<String>) {
    let mut clause = String::from(" WHERE 1=1");
    let mut values: Vec<String> = Vec::new();

    if hide_empty {
        clause.push_str(" AND s.turn_count IS NOT NULL AND s.turn_count > 0");
    }

    if let Some(from) = from_date {
        values.push(from.to_string());
        clause.push_str(&format!(
            " AND (date(COALESCE(s.updated_at, s.created_at)) >= ?{} OR (s.updated_at IS NULL AND s.created_at IS NULL))",
            values.len()
        ));
    }
    if let Some(to) = to_date {
        values.push(to.to_string());
        clause.push_str(&format!(
            " AND (date(COALESCE(s.updated_at, s.created_at)) <= ?{} OR (s.updated_at IS NULL AND s.created_at IS NULL))",
            values.len()
        ));
    }
    if let Some(repo) = repo {
        values.push(repo.to_string());
        clause.push_str(&format!(" AND s.repository = ?{}", values.len()));
    }

    (clause, values)
}

pub(super) fn to_refs(values: &[String]) -> Vec<&dyn ToSql> {
    values.iter().map(|v| v as &dyn ToSql).collect()
}

pub(super) fn query_day_tokens(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<DayTokens>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok(DayTokens {
            date: row.get(0)?,
            tokens: row.get::<_, i64>(1)? as u64,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(super) fn query_day_sessions(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<DaySessions>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok(DaySessions {
            date: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(super) fn query_day_cost(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<DayCost>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok(DayCost {
            date: row.get(0)?,
            cost: row.get(1)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(super) fn query_model_distribution(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<ModelDistEntry>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, f64>(5)?,
            row.get::<_, i64>(6)?,
        ))
    })?;
    let mut entries: Vec<(String, i64, i64, i64, i64, f64, i64)> = Vec::new();
    let mut grand_total: i64 = 0;
    for row in rows {
        let (model, tokens, input_t, output_t, cache_read, cost, request_count) = row?;
        grand_total += tokens;
        entries.push((model, tokens, input_t, output_t, cache_read, cost, request_count));
    }
    Ok(entries
        .into_iter()
        .map(
            |(model, tokens, input_t, output_t, cache_read, cost, request_count)| {
                let percentage = if grand_total > 0 {
                    (tokens as f64 / grand_total as f64) * 100.0
                } else {
                    0.0
                };
                ModelDistEntry {
                    model,
                    tokens: tokens as u64,
                    percentage,
                    input_tokens: input_t as u64,
                    output_tokens: output_t as u64,
                    cache_read_tokens: cache_read as u64,
                    premium_requests: cost,
                    request_count: request_count as u64,
                }
            },
        )
        .collect())
}

pub(super) fn query_durations(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<u64>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        row.get::<_, i64>(0)
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row? as u64);
    }
    Ok(result)
}

pub(super) fn compute_duration_stats(durations: &[u64]) -> ApiDurationStats {
    if durations.is_empty() {
        return ApiDurationStats {
            avg_ms: 0.0,
            median_ms: 0.0,
            p95_ms: 0.0,
            min_ms: 0,
            max_ms: 0,
            total_sessions_with_duration: 0,
        };
    }

    let mut sorted = durations.to_vec();
    sorted.sort_unstable();
    let n = sorted.len();
    let sum: u64 = sorted.iter().sum();

    let avg_ms = sum as f64 / n as f64;
    let median_ms = if n % 2 == 0 {
        (sorted[n / 2 - 1] + sorted[n / 2]) as f64 / 2.0
    } else {
        sorted[n / 2] as f64
    };
    let p95_idx = ((n as f64 * 0.95).ceil() as usize).min(n) - 1;
    let p95_ms = sorted[p95_idx] as f64;

    ApiDurationStats {
        avg_ms,
        median_ms,
        p95_ms,
        min_ms: sorted[0],
        max_ms: sorted[n - 1],
        total_sessions_with_duration: n as u32,
    }
}
