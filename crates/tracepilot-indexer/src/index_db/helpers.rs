//! SQL query helpers and statistical functions for the index database.

use crate::Result;
use rusqlite::{Connection, params_from_iter, types::ToSql};

use tracepilot_core::analytics::types::*;

/// Build a WHERE clause for date range + repo filtering on the sessions table.
///
/// Returns `(where_clause, bind_values)` where `where_clause` starts with
/// `" WHERE 1=1"` and may include additional AND conditions.
///
/// Uses anonymous `?` placeholders (consistent with the other helpers in this
/// module). Callers pass
/// the returned `bind_values` through `to_refs` + `params_from_iter`.
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
        clause.push_str(
            " AND (date(COALESCE(s.updated_at, s.created_at)) >= ? OR (s.updated_at IS NULL AND s.created_at IS NULL))",
        );
    }
    if let Some(to) = to_date {
        values.push(to.to_string());
        clause.push_str(
            " AND (date(COALESCE(s.updated_at, s.created_at)) <= ? OR (s.updated_at IS NULL AND s.created_at IS NULL))",
        );
    }
    if let Some(repo) = repo {
        values.push(repo.to_string());
        clause.push_str(" AND s.repository = ?");
    }

    (clause, values)
}

pub(super) fn to_refs(values: &[String]) -> Vec<&dyn ToSql> {
    values.iter().map(|v| v as &dyn ToSql).collect()
}

pub(super) fn execute_query_map<T, F, P>(
    conn: &Connection,
    sql: &str,
    params: P,
    mut mapper: F,
) -> Result<Vec<T>>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    P: IntoIterator,
    P::Item: ToSql,
{
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(params), |row| mapper(row))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(super) fn query_day_tokens(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<DayTokens>> {
    execute_query_map(conn, sql, refs.iter().copied(), |row| {
        Ok(DayTokens {
            date: row.get(0)?,
            tokens: row.get::<_, i64>(1)? as u64,
        })
    })
}

pub(super) fn query_day_activity(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<DayActivity>> {
    execute_query_map(conn, sql, refs.iter().copied(), |row| {
        Ok(DayActivity {
            date: row.get(0)?,
            count: row.get(1)?,
        })
    })
}

pub(super) fn query_day_cost(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<DayCost>> {
    execute_query_map(conn, sql, refs.iter().copied(), |row| {
        Ok(DayCost {
            date: row.get(0)?,
            cost: row.get(1)?,
        })
    })
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
            row.get::<_, i64>(7)?,
            row.get::<_, i64>(8)?,
        ))
    })?;
    let mut entries: Vec<(String, i64, i64, i64, i64, f64, i64, i64, bool)> = Vec::new();
    let mut grand_total: i64 = 0;
    for row in rows {
        let (
            model,
            tokens,
            input_t,
            output_t,
            cache_read,
            cost,
            request_count,
            reasoning_sum,
            has_reasoning,
        ) = row?;
        grand_total += tokens;
        entries.push((
            model,
            tokens,
            input_t,
            output_t,
            cache_read,
            cost,
            request_count,
            reasoning_sum,
            has_reasoning != 0,
        ));
    }
    Ok(entries
        .into_iter()
        .map(
            |(
                model,
                tokens,
                input_t,
                output_t,
                cache_read,
                cost,
                request_count,
                reasoning_sum,
                has_reasoning,
            )| {
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
                    reasoning_tokens: if has_reasoning {
                        Some(reasoning_sum as u64)
                    } else {
                        None
                    },
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
    execute_query_map(conn, sql, refs.iter().copied(), |row| {
        Ok(row.get::<_, i64>(0)? as u64)
    })
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
    let median_ms = if n.is_multiple_of(2) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_eq_filter() {
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        let sql = build_eq_filter("repository", "myrepo".to_string(), &mut params);
        assert_eq!(sql, " AND repository = ?");
        assert_eq!(params.len(), 1);
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
        let (clause, values) =
            build_date_repo_filter(Some("2026-01-01"), Some("2026-01-31"), None, false);
        assert!(clause.contains("date(COALESCE(s.updated_at, s.created_at)) >= ?"));
        assert!(clause.contains("date(COALESCE(s.updated_at, s.created_at)) <= ?"));
        // Ensure anonymous placeholders are used (not indexed ?1, ?2, …)
        assert_no_indexed_params(&clause);
        assert_eq!(values.len(), 2);
        assert_eq!(values[0], "2026-01-01");
        assert_eq!(values[1], "2026-01-31");
    }

    #[test]
    fn test_build_date_repo_filter_with_repo() {
        let (clause, values) = build_date_repo_filter(None, None, Some("myrepo"), false);
        assert!(clause.contains("s.repository = ?"));
        // Ensure anonymous placeholder is used (not indexed ?1)
        assert_no_indexed_params(&clause);
        assert_eq!(values.len(), 1);
        assert_eq!(values[0], "myrepo");
    }

    #[test]
    fn test_build_date_repo_filter_all_filters() {
        let (clause, values) =
            build_date_repo_filter(Some("2026-01-01"), Some("2026-01-31"), Some("myrepo"), true);
        assert!(clause.contains("s.turn_count"));
        assert!(clause.contains("date(COALESCE(s.updated_at, s.created_at)) >= ?"));
        assert!(clause.contains("date(COALESCE(s.updated_at, s.created_at)) <= ?"));
        assert!(clause.contains("s.repository = ?"));
        // Ensure anonymous placeholders are used throughout
        assert_no_indexed_params(&clause);
        assert_eq!(values.len(), 3);
    }

    /// Helper: check that a WHERE clause contains no indexed placeholders (`?N`).
    /// This is stricter than checking `?1`/`?2`/`?3` individually because it
    /// catches any `?` immediately followed by an ASCII digit (e.g. `?10`).
    fn assert_no_indexed_params(clause: &str) {
        let has_indexed = clause
            .as_bytes()
            .windows(2)
            .any(|w| w[0] == b'?' && w[1].is_ascii_digit());
        assert!(
            !has_indexed,
            "unexpected indexed placeholder in clause: {clause}"
        );
    }

    /// Verify that the number of `?` placeholders in the generated clause
    /// always equals the number of bind values returned.  This guards against
    /// accidental mismatches when the function is modified in the future.
    #[test]
    fn test_build_date_repo_filter_placeholder_count_matches_values() {
        type TestCase = (
            Option<&'static str>,
            Option<&'static str>,
            Option<&'static str>,
            bool,
            usize,
        );
        let cases: Vec<TestCase> = vec![
            (None, None, None, false, 0),
            (None, None, None, true, 0),
            (Some("2026-01-01"), None, None, false, 1),
            (None, Some("2026-01-31"), None, false, 1),
            (None, None, Some("myrepo"), false, 1),
            (Some("2026-01-01"), Some("2026-01-31"), None, false, 2),
            (Some("2026-01-01"), None, Some("myrepo"), false, 2),
            (None, Some("2026-01-31"), Some("myrepo"), false, 2),
            (
                Some("2026-01-01"),
                Some("2026-01-31"),
                Some("myrepo"),
                false,
                3,
            ),
            (
                Some("2026-01-01"),
                Some("2026-01-31"),
                Some("myrepo"),
                true,
                3,
            ),
        ];
        for (from, to, repo, hide_empty, expected_params) in cases {
            let (clause, values) = build_date_repo_filter(from, to, repo, hide_empty);
            let placeholder_count = clause.matches('?').count();
            assert_eq!(
                placeholder_count, expected_params,
                "placeholder count mismatch for from={from:?} to={to:?} repo={repo:?} hide_empty={hide_empty}"
            );
            assert_eq!(
                values.len(),
                expected_params,
                "bind value count mismatch for from={from:?} to={to:?} repo={repo:?} hide_empty={hide_empty}"
            );
            // No indexed params (`?N`) in any combination
            assert_no_indexed_params(&clause);
        }
    }

    /// Integration test: the WHERE clause produced by `build_date_repo_filter`
    /// must bind correctly when executed against a real (in-memory) SQLite
    /// connection.  This catches any param-order or placeholder-style regressions
    /// that pure string assertions cannot detect.
    ///
    /// Rows with NULL dates always pass the date filter (via the `OR NULL` guard)
    /// so that sessions whose timestamps were never recorded are still visible
    /// in the analytics dashboard.  This is intentional design behaviour.
    #[test]
    fn test_build_date_repo_filter_executes_correctly() {
        use rusqlite::Connection;
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE sessions (
                id           TEXT PRIMARY KEY,
                created_at   TEXT,
                updated_at   TEXT,
                repository   TEXT,
                turn_count   INTEGER
            );
            -- s1: Jan 2026, repo-a, has turns
            INSERT INTO sessions VALUES ('s1', '2026-01-05', '2026-01-05', 'repo-a', 3);
            -- s2: Feb 2026, repo-b (different month + repo)
            INSERT INTO sessions VALUES ('s2', '2026-02-05', '2026-02-05', 'repo-b', 0);
            -- s3: Jan 2026, repo-a, has turns
            INSERT INTO sessions VALUES ('s3', '2026-01-15', '2026-01-15', 'repo-a', 2);
            -- s4: Dec 2025, repo-a (out of range)
            INSERT INTO sessions VALUES ('s4', '2025-12-01', '2025-12-01', 'repo-a', 1);
            -- s5: NULL dates, repo-a — always matches date filter (OR NULL guard)
            INSERT INTO sessions VALUES ('s5', NULL, NULL, 'repo-a', 5);
            -- s6: Jan 2026, repo-a, zero turns (tests hide_empty)
            INSERT INTO sessions VALUES ('s6', '2026-01-20', '2026-01-20', 'repo-a', 0);",
        )
        .expect("setup");

        // Test 1: January 2026, repo-a, include empty sessions.
        // Expected: s1, s3, s5 (NULL-dates OR guard), s6 (zero turns) = 4
        let (clause, bind_values) = build_date_repo_filter(
            Some("2026-01-01"),
            Some("2026-01-31"),
            Some("repo-a"),
            false,
        );
        let sql = format!("SELECT COUNT(*) FROM sessions s{}", clause);
        let refs = to_refs(&bind_values);
        let count: i64 = conn
            .query_row(&sql, params_from_iter(refs.iter().copied()), |r| r.get(0))
            .expect("query1");
        assert_eq!(count, 4, "expected s1, s3, s5, s6 (include empty)");

        // Test 2: January 2026, repo-a, hide empty sessions (turn_count > 0).
        // Expected: s1, s3, s5 = 3 (s6 excluded because turn_count = 0)
        let (clause2, bind_values2) =
            build_date_repo_filter(Some("2026-01-01"), Some("2026-01-31"), Some("repo-a"), true);
        let sql2 = format!("SELECT COUNT(*) FROM sessions s{}", clause2);
        let refs2 = to_refs(&bind_values2);
        let count2: i64 = conn
            .query_row(&sql2, params_from_iter(refs2.iter().copied()), |r| r.get(0))
            .expect("query2");
        assert_eq!(count2, 3, "expected s1, s3, s5 (hide_empty excludes s6)");

        // Test 3: repo-b only, no date range.
        // Expected: s2 = 1
        let (clause3, bind_values3) = build_date_repo_filter(None, None, Some("repo-b"), false);
        let sql3 = format!("SELECT COUNT(*) FROM sessions s{}", clause3);
        let refs3 = to_refs(&bind_values3);
        let count3: i64 = conn
            .query_row(&sql3, params_from_iter(refs3.iter().copied()), |r| r.get(0))
            .expect("query3");
        assert_eq!(count3, 1, "expected only s2 for repo-b");

        // Test 4: no filters at all — all sessions returned.
        let (clause4, bind_values4) = build_date_repo_filter(None, None, None, false);
        let sql4 = format!("SELECT COUNT(*) FROM sessions s{}", clause4);
        let refs4 = to_refs(&bind_values4);
        let count4: i64 = conn
            .query_row(&sql4, params_from_iter(refs4.iter().copied()), |r| r.get(0))
            .expect("query4");
        assert_eq!(count4, 6, "expected all 6 sessions with no filter");
    }
    #[test]
    fn test_execute_query_map_collects_rows() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE test (id INTEGER PRIMARY KEY, value INTEGER);
             INSERT INTO test (value) VALUES (10), (20), (30);",
        )
        .expect("setup");

        let result: Vec<i64> = execute_query_map(
            &conn,
            "SELECT value FROM test WHERE value > ? ORDER BY value",
            [15],
            |row| row.get(0),
        )
        .expect("query succeeds");

        assert_eq!(result, vec![20, 30]);
    }

    #[test]
    fn test_execute_query_map_propagates_mapper_errors() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT);
             INSERT INTO test (value) VALUES ('not a number');",
        )
        .expect("setup");

        let result: Result<Vec<i64>> = execute_query_map(
            &conn,
            "SELECT value FROM test",
            std::iter::empty::<i64>(),
            |row| row.get(0),
        );

        assert!(result.is_err());
    }
}
