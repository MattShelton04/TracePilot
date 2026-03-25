//! SQL query helpers and statistical functions for the index database.

use crate::Result;
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

pub(super) fn query_day_activity(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<DayActivity>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok(DayActivity {
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

/// Build an IN clause filter for arrays of values (e.g., `col IN (?, ?, ?)`).
/// Returns the SQL fragment and appends parameters to the provided vector.
///
/// If `values` is empty, returns an empty string and adds no parameters.
/// This is a pure function with no side effects other than appending to `params`.
pub(super) fn build_in_filter<T: ToSql + Clone + 'static>(
    column: &str,
    values: &[T],
    params: &mut Vec<Box<dyn ToSql>>,
) -> String {
    if values.is_empty() {
        return String::new();
    }

    let placeholders = values.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    for val in values {
        params.push(Box::new(val.clone()));
    }

    format!(" AND {} IN ({})", column, placeholders)
}

/// Build an equality filter (e.g., `col = ?`).
/// Returns the SQL fragment and appends the parameter to the provided vector.
///
/// This is a pure function with no side effects other than appending to `params`.
pub(super) fn build_eq_filter<T: ToSql + 'static>(
    column: &str,
    value: T,
    params: &mut Vec<Box<dyn ToSql>>,
) -> String {
    params.push(Box::new(value));
    format!(" AND {} = ?", column)
}

/// Build a unix timestamp range filter (e.g., `col >= ? AND col <= ?`).
/// Returns the SQL fragment and appends parameters to the provided vector.
///
/// If both `from_unix` and `to_unix` are None, returns an empty string.
pub(super) fn build_timestamp_range_filter(
    column: &str,
    from_unix: Option<i64>,
    to_unix: Option<i64>,
    params: &mut Vec<Box<dyn ToSql>>,
) -> String {
    let mut parts = Vec::new();

    if let Some(from) = from_unix {
        params.push(Box::new(from));
        parts.push(format!("{} >= ?", column));
    }

    if let Some(to) = to_unix {
        params.push(Box::new(to));
        parts.push(format!("{} <= ?", column));
    }

    if parts.is_empty() {
        String::new()
    } else {
        format!(" AND {}", parts.join(" AND "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_in_filter_empty() {
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        let sql = build_in_filter("col", &Vec::<String>::new(), &mut params);
        assert_eq!(sql, "");
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn test_build_in_filter_single_value() {
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        let sql = build_in_filter("col", &vec!["value1".to_string()], &mut params);
        assert_eq!(sql, " AND col IN (?)");
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_build_in_filter_multiple_values() {
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        let sql = build_in_filter("col", &vec!["a".to_string(), "b".to_string(), "c".to_string()], &mut params);
        assert_eq!(sql, " AND col IN (?, ?, ?)");
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn test_build_eq_filter() {
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        let sql = build_eq_filter("repository", "myrepo".to_string(), &mut params);
        assert_eq!(sql, " AND repository = ?");
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_build_timestamp_range_filter_both() {
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        let sql = build_timestamp_range_filter("timestamp_unix", Some(1000), Some(2000), &mut params);
        assert_eq!(sql, " AND timestamp_unix >= ? AND timestamp_unix <= ?");
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn test_build_timestamp_range_filter_from_only() {
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        let sql = build_timestamp_range_filter("timestamp_unix", Some(1000), None, &mut params);
        assert_eq!(sql, " AND timestamp_unix >= ?");
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_build_timestamp_range_filter_to_only() {
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        let sql = build_timestamp_range_filter("timestamp_unix", None, Some(2000), &mut params);
        assert_eq!(sql, " AND timestamp_unix <= ?");
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_build_timestamp_range_filter_neither() {
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        let sql = build_timestamp_range_filter("timestamp_unix", None, None, &mut params);
        assert_eq!(sql, "");
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn test_build_date_repo_filter_all_none() {
        let (clause, values) = build_date_repo_filter(None, None, None, false);
        assert_eq!(clause, " WHERE 1=1");
        assert_eq!(values.len(), 0);
    }

    #[test]
    fn test_build_date_repo_filter_hide_empty() {
        let (clause, values) = build_date_repo_filter(None, None, None, true);
        assert!(clause.contains("s.turn_count IS NOT NULL"));
        assert!(clause.contains("s.turn_count > 0"));
        assert_eq!(values.len(), 0);
    }

    #[test]
    fn test_build_date_repo_filter_with_dates() {
        let (clause, values) = build_date_repo_filter(
            Some("2026-01-01"),
            Some("2026-01-31"),
            None,
            false
        );
        assert!(clause.contains("date(COALESCE(s.updated_at, s.created_at)) >= ?"));
        assert!(clause.contains("date(COALESCE(s.updated_at, s.created_at)) <= ?"));
        assert_eq!(values.len(), 2);
        assert_eq!(values[0], "2026-01-01");
        assert_eq!(values[1], "2026-01-31");
    }

    #[test]
    fn test_build_date_repo_filter_with_repo() {
        let (clause, values) = build_date_repo_filter(None, None, Some("myrepo"), false);
        assert!(clause.contains("s.repository = ?"));
        assert_eq!(values.len(), 1);
        assert_eq!(values[0], "myrepo");
    }

    #[test]
    fn test_build_date_repo_filter_all_filters() {
        let (clause, values) = build_date_repo_filter(
            Some("2026-01-01"),
            Some("2026-01-31"),
            Some("myrepo"),
            true
        );
        assert!(clause.contains("s.turn_count"));
        assert!(clause.contains("date(COALESCE(s.updated_at, s.created_at)) >= ?"));
        assert!(clause.contains("date(COALESCE(s.updated_at, s.created_at)) <= ?"));
        assert!(clause.contains("s.repository = ?"));
        assert_eq!(values.len(), 3);
    }
}
