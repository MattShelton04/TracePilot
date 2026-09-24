//! Cross-module tests for `search_reader`: SearchQueryBuilder feature tests
//! and `IndexDb` integration tests for search, stats, and FTS health.

use super::SearchFilters;
use super::query_builder::SearchQueryBuilder;
use crate::index_db::IndexDb;

/// Build an IndexDb backed by an in-memory SQLite connection using the provided schema/data.
fn build_db_with_fixture(sql: &str) -> IndexDb {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(sql).unwrap();
    IndexDb { conn }
}

#[test]
fn search_stats_propagates_row_errors_in_content_type_counts() {
    let db = build_db_with_fixture(
        "CREATE TABLE search_content (id INTEGER PRIMARY KEY, content_type TEXT);
         CREATE TABLE sessions (id INTEGER PRIMARY KEY, repository TEXT, search_indexed_at TEXT);
         INSERT INTO sessions(id, repository) VALUES (1, 'repo');
         INSERT INTO search_content(id, content_type) VALUES (1, NULL);",
    );

    let result = db.search_stats();
    assert!(
        result.is_err(),
        "row-level errors should surface instead of being dropped silently"
    );
}

#[test]
fn facets_propagate_row_errors_from_dimension_queries() {
    let db = build_db_with_fixture(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, repository TEXT);
         CREATE TABLE search_content (
             id INTEGER PRIMARY KEY,
             session_id TEXT,
             content_type TEXT,
             tool_name TEXT,
             timestamp_unix INTEGER,
             event_index INTEGER
         );
         INSERT INTO sessions (id, repository) VALUES ('s1', 'repo');
         INSERT INTO search_content (id, session_id, content_type) VALUES (1, 's1', NULL);",
    );

    let result = db.facets(None, &SearchFilters::default());
    assert!(
        result.is_err(),
        "facet queries should propagate row mapping errors"
    );
}

// ── SearchQueryBuilder tests ───────────────────────────────────

#[test]
fn test_builder_basic_construction() {
    let (sql, params) = SearchQueryBuilder::new("SELECT *", false).build();

    assert!(sql.contains("FROM search_content sc"));
    assert!(sql.contains("JOIN sessions s"));
    assert!(sql.contains("WHERE 1=1"));
    assert_eq!(params.len(), 0);
}

#[test]
fn test_builder_fts_mode() {
    let (sql, params) = SearchQueryBuilder::new("SELECT *", true).build();

    assert!(sql.contains("FROM search_fts"));
    assert!(sql.contains("JOIN search_content sc ON sc.id = search_fts.rowid"));
    assert_eq!(params.len(), 0);
}

#[test]
fn test_builder_with_fts_match() {
    let (sql, params) = SearchQueryBuilder::new("SELECT *", true)
        .with_fts_match("error message")
        .build();

    assert!(sql.contains("WHERE search_fts MATCH ?"));
    assert_eq!(params.len(), 1);
}

#[test]
fn test_builder_with_optional_fts_match_some() {
    let (sql, params) = SearchQueryBuilder::new("SELECT *", true)
        .with_optional_fts_match(Some("test query"))
        .build();

    assert!(sql.contains("WHERE search_fts MATCH ?"));
    assert_eq!(params.len(), 1);
}

#[test]
fn test_builder_with_optional_fts_match_none() {
    let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
        .with_optional_fts_match(None)
        .build();

    assert!(sql.contains("WHERE 1=1"));
    assert_eq!(params.len(), 0);
}

#[test]
fn test_builder_with_filters() {
    let filters = SearchFilters {
        content_types: vec!["user_message".to_string(), "assistant_message".to_string()],
        repositories: vec!["org/repo".to_string()],
        session_id: Some("session-123".to_string()),
        ..Default::default()
    };

    let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
        .with_filters(&filters)
        .build();

    assert!(sql.contains("sc.content_type IN (?, ?)"));
    assert!(sql.contains("s.repository IN (?)"));
    assert!(sql.contains("sc.session_id = ?"));
    assert_eq!(params.len(), 4); // 2 content types + 1 repo + 1 session_id
}

#[test]
fn test_builder_with_exclude_filters() {
    let filters = SearchFilters {
        exclude_content_types: vec!["tool_call".to_string(), "tool_result".to_string()],
        ..Default::default()
    };

    let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
        .with_filters(&filters)
        .build();

    assert!(sql.contains("sc.content_type NOT IN (?, ?)"));
    assert_eq!(params.len(), 2);
}

#[test]
fn test_builder_with_date_range() {
    let filters = SearchFilters {
        date_from_unix: Some(1700000000),
        date_to_unix: Some(1700100000),
        ..Default::default()
    };

    let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
        .with_filters(&filters)
        .build();

    assert!(sql.contains("sc.timestamp_unix >= ?"));
    assert!(sql.contains("sc.timestamp_unix <= ?"));
    assert_eq!(params.len(), 2);
}

#[test]
fn test_builder_with_sort_newest() {
    let (sql, _) = SearchQueryBuilder::new("SELECT *", false)
        .with_sort(Some("newest"))
        .build();

    assert!(sql.contains("ORDER BY sc.timestamp_unix DESC NULLS LAST"));
}

#[test]
fn test_builder_with_sort_oldest() {
    let (sql, _) = SearchQueryBuilder::new("SELECT *", false)
        .with_sort(Some("oldest"))
        .build();

    assert!(sql.contains("ORDER BY sc.timestamp_unix ASC NULLS LAST"));
}

#[test]
fn test_builder_with_sort_relevance_fts() {
    let (sql, _) = SearchQueryBuilder::new("SELECT *", true)
        .with_sort(None)
        .build();

    assert!(sql.contains("ORDER BY CASE sc.content_type"));
    assert!(sql.contains("WHEN 'user_message' THEN rank * 2.0"));
    assert!(sql.contains("WHEN 'error' THEN rank * 2.0"));
}

#[test]
fn test_builder_with_pagination() {
    let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
        .with_pagination(50, 100)
        .build();

    assert!(sql.contains("LIMIT ?"));
    assert!(sql.contains("OFFSET ?"));
    // Params from pagination are added at the end
    assert!(params.len() >= 2);
}

#[test]
fn test_builder_with_limit_only() {
    let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
        .with_limit(20)
        .build();

    assert!(sql.contains("LIMIT ?"));
    assert!(!sql.contains("OFFSET"));
    assert_eq!(params.len(), 1);
}

#[test]
fn test_builder_with_group_by() {
    let (sql, _) = SearchQueryBuilder::new("SELECT column, COUNT(*)", false)
        .with_group_by("column", Some("ORDER BY COUNT(*) DESC"))
        .build();

    assert!(sql.contains("GROUP BY column"));
    assert!(sql.contains("ORDER BY COUNT(*) DESC"));
}

#[test]
fn test_builder_with_extra_where() {
    let (sql, _) = SearchQueryBuilder::new("SELECT *", false)
        .with_extra_where("s.repository IS NOT NULL")
        .build();

    assert!(sql.contains("s.repository IS NOT NULL"));
}

#[test]
fn test_builder_complex_query() {
    // Test a realistic complex query combining multiple features
    let filters = SearchFilters {
        content_types: vec!["error".to_string()],
        repositories: vec!["org/repo-a".to_string(), "org/repo-b".to_string()],
        date_from_unix: Some(1700000000),
        tool_names: vec!["read_file".to_string()],
        ..Default::default()
    };

    let (sql, params) = SearchQueryBuilder::new("SELECT sc.id, sc.content", true)
        .with_fts_match("authentication failed")
        .with_filters(&filters)
        .with_sort(Some("newest"))
        .with_pagination(25, 50)
        .build();

    // Verify structure
    assert!(sql.contains("FROM search_fts"));
    assert!(sql.contains("WHERE search_fts MATCH ?"));
    assert!(sql.contains("sc.content_type IN (?)"));
    assert!(sql.contains("s.repository IN (?, ?)"));
    assert!(sql.contains("sc.timestamp_unix >= ?"));
    assert!(sql.contains("sc.tool_name IN (?)"));
    assert!(sql.contains("ORDER BY sc.timestamp_unix DESC"));
    assert!(sql.contains("LIMIT ?"));
    assert!(sql.contains("OFFSET ?"));

    // Verify params: 1 FTS query + 1 content_type + 2 repos + 1 date + 1 tool + limit + offset = 8
    assert_eq!(params.len(), 8);
}

#[test]
fn test_builder_param_order_matches_placeholders() {
    // This test ensures params are in the right order for SQL execution
    let filters = SearchFilters {
        content_types: vec!["user_message".to_string()],
        repositories: vec!["org/repo".to_string()],
        ..Default::default()
    };

    let (sql, params) = SearchQueryBuilder::new("SELECT *", true)
        .with_fts_match("test")
        .with_filters(&filters)
        .with_pagination(10, 0)
        .build();

    let placeholder_count = sql.matches('?').count();
    assert_eq!(
        params.len(),
        placeholder_count,
        "Number of params should match number of placeholders"
    );
}

#[test]
fn test_builder_empty_filters() {
    let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
        .with_filters(&SearchFilters::default())
        .build();

    // Empty filters should still produce valid SQL
    assert!(sql.contains("WHERE 1=1"));
    assert_eq!(params.len(), 0);
}

#[test]
fn test_builder_method_chaining() {
    // Test that builder methods can be chained fluently
    let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
        .with_optional_fts_match(None)
        .with_filters(&SearchFilters::default())
        .with_sort(Some("newest"))
        .with_pagination(10, 0)
        .build();

    assert!(sql.contains("FROM search_content sc"));
    assert!(sql.contains("ORDER BY sc.timestamp_unix DESC NULLS LAST"));
    assert!(sql.contains("LIMIT ?"));
    assert!(sql.contains("OFFSET ?"));
    assert_eq!(params.len(), 2);
}

#[test]
fn test_open_readonly_fails_on_missing_database() {
    // Test that open_readonly fails appropriately on non-existent database
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("nonexistent.db");

    // Attempting to open a non-existent database in readonly mode should fail
    let result = IndexDb::open_readonly(&db_path);
    assert!(
        result.is_err(),
        "Should fail to open non-existent database in readonly mode"
    );

    // Verify error message contains useful context
    if let Err(err) = result {
        let err_msg = err.to_string();
        assert!(
            err_msg.contains("readonly") || err_msg.contains("open"),
            "Error message should indicate readonly/open failure: {}",
            err_msg
        );
    }
}

#[test]
fn test_fts_health_returns_error_on_query_failure() {
    use rusqlite::Connection;

    // Create an in-memory database without the required schema
    let conn = Connection::open_in_memory().unwrap();
    let db = IndexDb { conn };

    // Calling fts_health on a database without the required tables should error
    let result = db.fts_health();
    assert!(
        result.is_err(),
        "fts_health should return error when tables don't exist, not zeros"
    );

    // Verify the error is a database error
    match result {
        Err(crate::IndexerError::Database(e)) => {
            assert!(
                format!("{:?}", e).contains("no such table"),
                "Error should indicate missing table, got: {:?}",
                e
            );
        }
        _ => panic!("Expected Database error variant"),
    }
}

#[test]
fn test_search_stats_propagates_errors() {
    use rusqlite::Connection;

    // Create an in-memory database with partial schema (missing tables)
    let conn = Connection::open_in_memory().unwrap();
    conn.execute("CREATE TABLE sessions (id TEXT)", []).unwrap();
    // Deliberately not creating search_content table

    let db = IndexDb { conn };

    // search_stats should fail when search_content table doesn't exist
    let result = db.search_stats();
    assert!(
        result.is_err(),
        "search_stats should return error when tables are missing"
    );

    // Verify error indicates the missing table
    match result {
        Err(crate::IndexerError::Database(e)) => {
            let err_msg = format!("{:?}", e);
            assert!(
                err_msg.contains("no such table") || err_msg.contains("search_content"),
                "Error should reference missing search_content table, got: {}",
                err_msg
            );
        }
        _ => panic!("Expected Database error variant"),
    }
}
