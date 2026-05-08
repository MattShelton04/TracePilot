//! Day-bucketed SQL builder shared by the dashboard analytics queries.
//!
//! All three day-bucketed dashboard charts (tokens, activity, cost) share
//! the same skeleton:
//!
//! ```text
//! SELECT date(<bucket_column>) AS d, <aggregate>
//!   FROM <source>
//!   <session-level WHERE> AND date(<bucket_column>) BETWEEN ? AND ?
//!     AND d IS NOT NULL
//!   GROUP BY d ORDER BY d
//! ```
//!
//! They differ only in the source FROM/JOIN and the aggregate expression.
//! [`query_day_bucketed`] owns the boilerplate (date bucket projection,
//! segment-range clamp, prepared-statement execution, row collection) and
//! takes a closure that converts a `&Row` into the caller's row type.
//!
//! The helper composes the per-segment date filter via
//! [`append_segment_date_filter`] so callers cannot accidentally string-
//! concatenate user-supplied date values into the SQL.

use rusqlite::{Connection, params_from_iter, types::ToSql};

use crate::Result;
use crate::index_db::helpers::append_segment_date_filter;

/// Description of a single day-bucketed query shape.
///
/// All fields are static SQL fragments composed by the caller from
/// hard-coded strings — never from user input. User-supplied date and repo
/// filters flow through `base_where` / `base_values` / `from_date` /
/// `to_date` and are bound as `?` placeholders.
pub(super) struct DayBucketSpec<'a> {
    /// FROM-clause body (without the leading `FROM`), e.g.
    /// `"session_segments m JOIN sessions s ON s.id = m.session_id"`.
    pub from_clause: &'a str,
    /// Aggregate `SELECT` expression, e.g.
    /// `"COALESCE(SUM(m.total_tokens), 0)"`. Becomes column 1 of the
    /// projection (column 0 is the bucketed `date(...)` value).
    pub aggregate_expr: &'a str,
    /// Timestamp column to bucket on, e.g. `"m.end_timestamp"`. Used both
    /// in the `date(...)` projection and to clamp the segment date range.
    pub bucket_column: &'a str,
}

/// Run a day-bucketed aggregate query and collect one mapped row per day.
///
/// Builds:
///
/// ```text
/// SELECT date(<spec.bucket_column>) AS d, <spec.aggregate_expr>
///   FROM <spec.from_clause>
///   <base_where> AND date(<spec.bucket_column>) >= ? AND date(<...>) <= ?
///     AND d IS NOT NULL
///   GROUP BY d ORDER BY d
/// ```
///
/// where the `>=` / `<=` clauses are appended by
/// [`append_segment_date_filter`] only when `from_date` / `to_date` are
/// `Some`. Bound parameters are `base_values` followed by the segment
/// range bounds — never inlined.
pub(super) fn query_day_bucketed<T, F>(
    conn: &Connection,
    spec: DayBucketSpec<'_>,
    base_where: &str,
    base_values: &[String],
    from_date: Option<&str>,
    to_date: Option<&str>,
    mut mapper: F,
) -> Result<Vec<T>>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let (where_clause, values) = append_segment_date_filter(
        base_where,
        base_values,
        from_date,
        to_date,
        spec.bucket_column,
    );
    let sql = format!(
        "SELECT date({col}) AS d, {agg} FROM {from} {where_clause} AND d IS NOT NULL GROUP BY d ORDER BY d",
        col = spec.bucket_column,
        agg = spec.aggregate_expr,
        from = spec.from_clause,
    );
    let refs: Vec<&dyn ToSql> = values.iter().map(|v| v as &dyn ToSql).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| mapper(row))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Build an in-memory database with a `sessions` row and three
    /// `session_segments` rows on three distinct days. Exercises the
    /// helper for each of the three concrete dashboard call-sites
    /// (tokens, activity, cost) and checks columns parity against the
    /// pre-extraction shape.
    fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                turn_count INTEGER,
                updated_at TEXT,
                created_at TEXT,
                repository TEXT
            );
            CREATE TABLE session_segments (
                session_id TEXT,
                end_timestamp TEXT,
                total_tokens INTEGER,
                total_premium_requests REAL
            );
            INSERT INTO sessions (id, turn_count, updated_at, created_at, repository)
                VALUES ('s1', 3, '2026-01-15T10:00:00Z', '2026-01-15T09:00:00Z', 'repo-a');
            INSERT INTO session_segments VALUES
                ('s1', '2026-01-15T10:00:00Z', 100, 0.5),
                ('s1', '2026-01-16T10:00:00Z', 200, 1.5),
                ('s1', '2026-01-17T10:00:00Z', 300, 2.5);
            "#,
        )
        .unwrap();
        conn
    }

    const FROM_SEGMENTS: &str = "session_segments m JOIN sessions s ON s.id = m.session_id";

    #[test]
    fn tokens_call_site_shape() {
        let conn = fixture();
        let rows: Vec<(String, u64)> = query_day_bucketed(
            &conn,
            DayBucketSpec {
                from_clause: FROM_SEGMENTS,
                aggregate_expr: "COALESCE(SUM(m.total_tokens), 0)",
                bucket_column: "m.end_timestamp",
            },
            " WHERE 1=1",
            &[],
            None,
            None,
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64)),
        )
        .unwrap();
        assert_eq!(
            rows,
            vec![
                ("2026-01-15".into(), 100u64),
                ("2026-01-16".into(), 200),
                ("2026-01-17".into(), 300),
            ]
        );
    }

    #[test]
    fn activity_call_site_shape() {
        let conn = fixture();
        let rows: Vec<(String, i64)> = query_day_bucketed(
            &conn,
            DayBucketSpec {
                from_clause: FROM_SEGMENTS,
                aggregate_expr: "COUNT(*)",
                bucket_column: "m.end_timestamp",
            },
            " WHERE 1=1",
            &[],
            None,
            None,
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
        assert_eq!(
            rows,
            vec![
                ("2026-01-15".into(), 1i64),
                ("2026-01-16".into(), 1),
                ("2026-01-17".into(), 1),
            ]
        );
    }

    #[test]
    fn cost_call_site_shape() {
        let conn = fixture();
        let rows: Vec<(String, f64)> = query_day_bucketed(
            &conn,
            DayBucketSpec {
                from_clause: FROM_SEGMENTS,
                aggregate_expr: "COALESCE(SUM(m.total_premium_requests), 0.0)",
                bucket_column: "m.end_timestamp",
            },
            " WHERE 1=1",
            &[],
            None,
            None,
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
        assert_eq!(
            rows,
            vec![
                ("2026-01-15".into(), 0.5f64),
                ("2026-01-16".into(), 1.5),
                ("2026-01-17".into(), 2.5),
            ]
        );
    }

    #[test]
    fn segment_date_clamp_bound_via_placeholders() {
        // Verifies `from_date` / `to_date` clamp the segment range without
        // inlining values into the SQL string (they go through `?`-bound
        // params via `append_segment_date_filter`).
        let conn = fixture();
        let rows: Vec<(String, u64)> = query_day_bucketed(
            &conn,
            DayBucketSpec {
                from_clause: FROM_SEGMENTS,
                aggregate_expr: "COALESCE(SUM(m.total_tokens), 0)",
                bucket_column: "m.end_timestamp",
            },
            " WHERE 1=1",
            &[],
            Some("2026-01-16"),
            Some("2026-01-16"),
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64)),
        )
        .unwrap();
        assert_eq!(rows, vec![("2026-01-16".into(), 200u64)]);
    }
}
