//! Analytics + incident tests: aggregate queries, tool analysis, code impact,
//! duration statistics, and incident indexing.

use super::common::{write_session_with_incidents, write_session_with_tools};
use crate::index_db::IndexDb;
use crate::index_db::helpers::compute_duration_stats;

#[test]
fn test_query_analytics_basic() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let s1 = write_session_with_tools(
        tmp.path(),
        "a1111111-1111-1111-1111-111111111111",
        "org/repo-a",
        "2026-03-10T07:15:00Z",
    );
    let s2 = write_session_with_tools(
        tmp.path(),
        "b2222222-2222-2222-2222-222222222222",
        "org/repo-b",
        "2026-03-11T09:00:00Z",
    );
    db.upsert_session(&s1).unwrap();
    db.upsert_session(&s2).unwrap();

    let result = db.query_analytics(None, None, None, false).unwrap();
    assert_eq!(result.total_sessions, 2);
    assert!(!result.activity_per_day.is_empty());
}

#[test]
fn test_query_analytics_repo_filter() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let s1 = write_session_with_tools(
        tmp.path(),
        "c3333333-3333-3333-3333-333333333333",
        "org/repo-a",
        "2026-03-10T07:15:00Z",
    );
    let s2 = write_session_with_tools(
        tmp.path(),
        "d4444444-4444-4444-4444-444444444444",
        "org/repo-b",
        "2026-03-11T09:00:00Z",
    );
    db.upsert_session(&s1).unwrap();
    db.upsert_session(&s2).unwrap();

    let filtered = db
        .query_analytics(None, None, Some("org/repo-a"), false)
        .unwrap();
    assert_eq!(filtered.total_sessions, 1);

    let all = db.query_analytics(None, None, None, false).unwrap();
    assert_eq!(all.total_sessions, 2);
}

#[test]
fn test_query_tool_analysis_aggregates_tool_calls() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let s = write_session_with_tools(
        tmp.path(),
        "e5555555-5555-5555-5555-555555555555",
        "org/repo",
        "2026-03-10T07:15:00Z",
    );
    db.upsert_session(&s).unwrap();

    let result = db.query_tool_analysis(None, None, None, false).unwrap();
    assert_eq!(result.total_calls, 2, "should count 2 tool calls");
    assert!(
        result.tools.len() >= 2,
        "should have read_file and edit_file entries"
    );

    let read = result.tools.iter().find(|t| t.name == "read_file");
    assert!(read.is_some(), "should have read_file entry");
    assert_eq!(read.unwrap().call_count, 1);
    assert_eq!(read.unwrap().success_rate, 1.0);

    let edit = result.tools.iter().find(|t| t.name == "edit_file");
    assert!(edit.is_some(), "should have edit_file entry");
    assert_eq!(edit.unwrap().call_count, 1);
    assert_eq!(edit.unwrap().success_rate, 0.0); // failed
}

#[test]
fn test_query_code_impact_empty() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    // No sessions → zero impact
    let result = db.query_code_impact(None, None, None, false).unwrap();
    assert_eq!(result.files_modified, 0);
    assert_eq!(result.lines_added, 0);
    assert_eq!(result.lines_removed, 0);
}

#[test]
fn test_query_analytics_date_filtering() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let s1 = write_session_with_tools(
        tmp.path(),
        "date-aaa-1111-1111-1111-111111111111",
        "org/repo",
        "2026-03-10T07:15:00Z",
    );
    let s2 = write_session_with_tools(
        tmp.path(),
        "date-bbb-2222-2222-2222-222222222222",
        "org/repo",
        "2026-03-20T09:00:00Z",
    );
    db.upsert_session(&s1).unwrap();
    db.upsert_session(&s2).unwrap();

    // Only sessions from/after March 15
    let after = db
        .query_analytics(Some("2026-03-15"), None, None, false)
        .unwrap();
    assert_eq!(after.total_sessions, 1);

    // Only sessions before March 15
    let before = db
        .query_analytics(None, Some("2026-03-15"), None, false)
        .unwrap();
    assert_eq!(before.total_sessions, 1);

    // All sessions in range
    let all = db
        .query_analytics(Some("2026-03-01"), Some("2026-03-31"), None, false)
        .unwrap();
    assert_eq!(all.total_sessions, 2);
}

#[test]
fn test_compute_duration_stats() {
    // Empty
    let empty = compute_duration_stats(&[]);
    assert_eq!(empty.total_sessions_with_duration, 0);
    assert_eq!(empty.avg_ms, 0.0);

    // Single value
    let single = compute_duration_stats(&[5000]);
    assert_eq!(single.total_sessions_with_duration, 1);
    assert_eq!(single.avg_ms, 5000.0);
    assert_eq!(single.median_ms, 5000.0);
    assert_eq!(single.min_ms, 5000);
    assert_eq!(single.max_ms, 5000);

    // Multiple values — sorted: [1000, 2000, 3000, 4000, 10000]
    let multi = compute_duration_stats(&[3000, 1000, 10000, 2000, 4000]);
    assert_eq!(multi.total_sessions_with_duration, 5);
    assert_eq!(multi.avg_ms, 4000.0);
    assert_eq!(multi.median_ms, 3000.0);
    assert_eq!(multi.min_ms, 1000);
    assert_eq!(multi.max_ms, 10000);
}

#[test]
fn test_incident_indexing_and_retrieval() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session_dir =
        write_session_with_incidents(tmp.path(), "aaaa1111-1111-1111-1111-111111111111");

    db.upsert_session(&session_dir).unwrap();

    // Verify aggregate counts on the session row
    let sessions = db.list_sessions(None, None, None, false).unwrap();
    assert_eq!(sessions.len(), 1);
    let s = &sessions[0];
    assert_eq!(s.error_count, Some(2), "should count 2 errors");
    assert_eq!(s.rate_limit_count, Some(1), "should count 1 rate limit");
    assert_eq!(s.compaction_count, Some(1), "should count 1 compaction");
    assert_eq!(s.truncation_count, Some(1), "should count 1 truncation");

    // Verify individual incident rows
    let incidents = db
        .get_session_incidents("aaaa1111-1111-1111-1111-111111111111")
        .unwrap();
    assert_eq!(incidents.len(), 4, "should have 4 incident rows");

    // First incident: rate limit error
    assert_eq!(incidents[0].event_type, "error");
    assert_eq!(incidents[0].source_event_type, "session.error");
    assert_eq!(incidents[0].severity, "error"); // rate limits are errors
    assert_eq!(incidents[0].summary, "Rate limit hit");

    // Second incident: API error
    assert_eq!(incidents[1].event_type, "error");
    assert_eq!(incidents[1].severity, "error");

    // Third incident: compaction
    assert_eq!(incidents[2].event_type, "compaction");
    assert_eq!(
        incidents[2].source_event_type,
        "session.compaction_complete"
    );
    assert_eq!(incidents[2].severity, "info"); // successful compaction
    assert!(incidents[2].summary.contains("succeeded"));

    // Fourth incident: truncation
    assert_eq!(incidents[3].event_type, "truncation");
    assert_eq!(incidents[3].severity, "warning");
    assert!(incidents[3].summary.contains("5000 tokens"));

    // Verify analytics aggregation includes incident data
    let analytics = db.query_analytics(None, None, None, false).unwrap();
    assert_eq!(analytics.sessions_with_errors, 1);
    assert_eq!(analytics.total_rate_limits, 1);
    assert_eq!(analytics.total_compactions, 1);
    assert_eq!(analytics.total_truncations, 1);
}
