use super::*;
use crate::Result;
use rusqlite::{Connection, params_from_iter, types::ToSql};

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
/// Regression test: without `append_segment_date_filter`, a single-day query
/// incorrectly produces chart data for days outside the requested window.
///
/// Scenario: session s1 was last updated on Apr 19 (→ passes the session
/// date filter for "Apr 19 only"), but its segments span Apr 15–19.
/// Without segment-level clamping the chart returns 3 distinct date rows
/// (Apr 15, Apr 17, Apr 19).  After applying `append_segment_date_filter`
/// only the Apr 19 row survives.
#[test]
fn test_segment_date_leakage_without_filter_and_fixed_with_append() {
    use rusqlite::Connection;
    let conn = Connection::open_in_memory().expect("in-memory db");
    conn.execute_batch(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                created_at TEXT,
                updated_at TEXT,
                repository TEXT,
                turn_count INTEGER
            );
            CREATE TABLE session_segments (
                session_id TEXT NOT NULL,
                start_timestamp TEXT NOT NULL,
                end_timestamp TEXT NOT NULL,
                total_tokens INTEGER DEFAULT 0
            );
            -- Session updated on Apr 19 — passes single-day filter
            INSERT INTO sessions VALUES ('s1', '2026-04-15', '2026-04-19', NULL, 5);
            -- Segments span Apr 15, Apr 17, Apr 19
            INSERT INTO session_segments VALUES ('s1', '2026-04-15T10:00:00', '2026-04-15T11:00:00', 100);
            INSERT INTO session_segments VALUES ('s1', '2026-04-17T10:00:00', '2026-04-17T11:00:00', 200);
            INSERT INTO session_segments VALUES ('s1', '2026-04-19T10:00:00', '2026-04-19T11:00:00', 300);",
        )
        .expect("setup");

    let from_date = Some("2026-04-19");
    let to_date = Some("2026-04-19");

    // ── BUG: session-level filter alone leaks segment data from prior days ──
    let (where_clause, bind_values) = build_date_repo_filter(from_date, to_date, None, false);
    let buggy_sql = format!(
        "SELECT date(m.end_timestamp) as d, SUM(m.total_tokens) \
             FROM session_segments m \
             JOIN sessions s ON s.id = m.session_id \
             {where_clause} AND d IS NOT NULL GROUP BY d ORDER BY d"
    );
    let refs = to_refs(&bind_values);
    let rows: Vec<(String, i64)> =
        execute_query_map(&conn, &buggy_sql, refs.iter().copied(), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .expect("buggy query");
    // The bug: three days appear even though only Apr 19 was requested
    assert_eq!(
        rows.len(),
        3,
        "BUG: without segment filter, {rows:?} days should leak (3 expected to confirm bug)"
    );

    // ── FIX: append segment-level date clamp ──
    let (fixed_where, fixed_values) = append_segment_date_filter(
        &where_clause,
        &bind_values,
        from_date,
        to_date,
        "m.end_timestamp",
    );
    let fixed_sql = format!(
        "SELECT date(m.end_timestamp) as d, SUM(m.total_tokens) \
             FROM session_segments m \
             JOIN sessions s ON s.id = m.session_id \
             {fixed_where} AND d IS NOT NULL GROUP BY d ORDER BY d"
    );
    let refs2 = to_refs(&fixed_values);
    let fixed_rows: Vec<(String, i64)> =
        execute_query_map(&conn, &fixed_sql, refs2.iter().copied(), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .expect("fixed query");

    assert_eq!(fixed_rows.len(), 1, "fixed: only Apr 19 should appear");
    assert_eq!(fixed_rows[0].0, "2026-04-19");
    assert_eq!(
        fixed_rows[0].1, 300,
        "only Apr 19 segment tokens (300) expected"
    );
}

/// Verify `append_segment_date_filter` placeholder count matches bind values.
#[test]
fn test_append_segment_date_filter_placeholder_count() {
    type Case = (Option<&'static str>, Option<&'static str>, usize);
    let cases: Vec<Case> = vec![
        (None, None, 0),
        (Some("2026-01-01"), None, 1),
        (None, Some("2026-01-31"), 1),
        (Some("2026-01-01"), Some("2026-01-31"), 2),
    ];
    for (from, to, extra_params) in cases {
        // Start with a base clause that already has some params
        let (base_clause, base_values) = build_date_repo_filter(from, to, Some("myrepo"), false);
        let base_q_count = base_clause.matches('?').count();

        let (new_clause, new_values) =
            append_segment_date_filter(&base_clause, &base_values, from, to, "m.end_timestamp");

        let total_q = new_clause.matches('?').count();
        assert_eq!(
            total_q,
            base_q_count + extra_params,
            "placeholder count mismatch for from={from:?} to={to:?}"
        );
        assert_eq!(
            new_values.len(),
            base_values.len() + extra_params,
            "bind value count mismatch for from={from:?} to={to:?}"
        );
    }
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
