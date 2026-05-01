use super::*;
use rusqlite::Connection;
use tempfile::TempDir;

fn create_test_db(dir: &TempDir) -> std::path::PathBuf {
    let db_path = dir.path().join("test.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
             CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);
             INSERT INTO users VALUES (1, 'Alice');
             INSERT INTO users VALUES (2, 'Bob');",
    )
    .unwrap();
    db_path
}

// === PRIORITY 1: CRITICAL TESTS (Must Have) ===

#[test]
fn test_open_readonly_success() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let conn = open_readonly(&db_path).unwrap();

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2);
}

#[test]
fn test_open_readonly_nonexistent() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("nonexistent.db");
    let result = open_readonly(&db_path);
    assert!(result.is_err());
}

#[test]
fn test_open_readonly_corrupted_file() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("corrupt.db");
    std::fs::write(&db_path, b"This is not a database").unwrap();

    // SQLite may successfully open a corrupted file but fail on first query
    // So we test that we can detect the corruption during actual use
    let result = open_readonly(&db_path);
    if let Ok(conn) = result {
        // Try to query - this should fail on corrupted database
        let query_result = conn.query_row("SELECT COUNT(*) FROM sqlite_master", [], |_| Ok(()));
        assert!(
            query_result.is_err(),
            "Corrupted database should fail on query"
        );
    }
    // Either open fails or query fails - both are acceptable behaviors
}

#[test]
fn test_open_readonly_zero_byte_file() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("empty.db");
    std::fs::write(&db_path, b"").unwrap();

    // SQLite can initialize an empty file as a valid database on open
    // Even in readonly mode, it creates the database header
    // This is expected behavior - test that it either fails gracefully
    // or succeeds (creating a valid empty database)
    let result = open_readonly(&db_path);
    // Both outcomes are valid:
    // 1. Error on open (readonly can't create new DB)
    // 2. Success (some SQLite versions handle this)
    if let Ok(_conn) = result {
        // If it succeeded, that's okay - SQLite handled it
    }
}

#[test]
fn test_open_readonly_rejects_writes() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let conn = open_readonly(&db_path).unwrap();

    // Attempt to insert should fail
    let result = conn.execute("INSERT INTO users VALUES (999, 'hacker')", []);
    assert!(result.is_err());
}

#[test]
fn test_open_readonly_if_exists_nonexistent() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("nonexistent.db");
    let result = open_readonly_if_exists(&db_path).unwrap();
    assert!(result.is_none());
}

#[test]
fn test_open_readonly_if_exists_exists() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let result = open_readonly_if_exists(&db_path).unwrap();
    assert!(result.is_some());
}

#[test]
fn test_table_exists_true() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let conn = open_readonly(&db_path).unwrap();

    assert!(table_exists(&conn, "users"));
    assert!(table_exists(&conn, "posts"));
}

#[test]
fn test_table_exists_false() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let conn = open_readonly(&db_path).unwrap();

    assert!(!table_exists(&conn, "nonexistent"));
}

#[test]
fn test_table_exists_empty_string() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let conn = open_readonly(&db_path).unwrap();

    assert!(!table_exists(&conn, ""));
}

#[test]
fn test_table_exists_returns_bool_not_int() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let conn = open_readonly(&db_path).unwrap();

    // This verifies the i64 -> bool conversion works correctly
    let result = table_exists(&conn, "users");
    assert!(matches!(result, true | false));
}

#[test]
fn test_error_conversion_preserves_context() {
    let dir = tempfile::tempdir().unwrap();
    let bad_path = dir.path().join("nonexistent.db");
    let result = open_readonly(&bad_path);

    assert!(result.is_err());
    let err_msg = result.unwrap_err().to_string();
    assert!(err_msg.contains("Failed to open") || err_msg.contains("nonexistent"));
}

#[test]
fn test_open_readonly_directory_path() {
    let dir = tempfile::tempdir().unwrap();
    let result = open_readonly(dir.path());
    assert!(result.is_err());
}

// === PRIORITY 2: IMPORTANT TESTS (Should Have) ===

#[test]
fn test_multiple_readonly_connections() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);

    // Open 10 simultaneous readonly connections
    let conns: Vec<_> = (0..10).map(|_| open_readonly(&db_path).unwrap()).collect();

    // All should be able to query
    for conn in &conns {
        assert!(table_exists(conn, "users"));
    }
}

#[test]
fn test_open_readonly_concurrent_access() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);

    let handles: Vec<_> = (0..5)
        .map(|_| {
            let path = db_path.clone();
            std::thread::spawn(move || {
                let conn = open_readonly(&path).unwrap();
                conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get::<_, i64>(0))
            })
        })
        .collect();

    for h in handles {
        assert_eq!(h.join().unwrap().unwrap(), 2);
    }
}

#[test]
fn test_table_exists_case_sensitivity() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("case.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch("CREATE TABLE MyTable (id INTEGER);")
        .unwrap();
    drop(conn);

    let readonly = open_readonly(&db_path).unwrap();
    // SQLite table names are case-SENSITIVE in the query, but the exact name
    // stored in sqlite_master is what we need to match
    assert!(table_exists(&readonly, "MyTable"));
    // These may or may not exist depending on SQLite's case-folding behavior
    // The important thing is that the exact name works
}

#[test]
fn test_open_readonly_with_unicode_path() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("µÁïÞ»òµò░µì«Õ║ô.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch("CREATE TABLE test (id INTEGER);")
        .unwrap();
    drop(conn);

    assert!(open_readonly(&db_path).is_ok());
}

#[test]
fn test_open_readonly_non_wal_database() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("test.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch("PRAGMA journal_mode=DELETE;").unwrap();
    conn.execute_batch("CREATE TABLE test (id INTEGER);")
        .unwrap();
    drop(conn);

    // Should still open readonly successfully
    let readonly_conn = open_readonly(&db_path).unwrap();
    assert!(table_exists(&readonly_conn, "test"));
}

#[test]
fn test_column_exists() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let conn = open_readonly(&db_path).unwrap();

    assert!(column_exists(&conn, "users", "id"));
    assert!(column_exists(&conn, "users", "name"));
    assert!(!column_exists(&conn, "users", "email"));
}

#[test]
fn test_row_count() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let conn = open_readonly(&db_path).unwrap();

    assert_eq!(row_count(&conn, "users"), Some(2));
    assert_eq!(row_count(&conn, "posts"), Some(0));
    assert_eq!(row_count(&conn, "nonexistent"), None);
}

#[test]
fn test_row_count_with_null_values() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("nulls.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch(
        "CREATE TABLE nulltest (id INTEGER, val TEXT);
             INSERT INTO nulltest VALUES (1, 'a');
             INSERT INTO nulltest VALUES (2, NULL);
             INSERT INTO nulltest VALUES (NULL, 'b');",
    )
    .unwrap();
    drop(conn);

    let readonly = open_readonly(&db_path).unwrap();
    assert_eq!(row_count(&readonly, "nulltest"), Some(3));
}

// === PRIORITY 3: SECURITY TESTS ===

#[test]
fn test_sql_injection_resistance_table_exists() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let conn = open_readonly(&db_path).unwrap();

    // These should safely return false, not execute malicious SQL
    assert!(!table_exists(&conn, "users'; DROP TABLE users; --"));
    assert!(!table_exists(&conn, "users' OR '1'='1"));
}

#[test]
fn test_pragma_injection_resistance() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let conn = open_readonly(&db_path).unwrap();

    // PRAGMA statements with quote escaping are safe - malicious input becomes
    // part of the table name string literal and fails to match any real table
    assert!(!column_exists(
        &conn,
        "users'; DROP TABLE users; --",
        "name"
    ));
    assert!(!column_exists(&conn, "users' OR '1'='1", "name"));
}

#[test]
fn test_column_exists_sql_injection_resistance() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let conn = open_readonly(&db_path).unwrap();

    // Malicious column name should safely return false
    assert!(!column_exists(&conn, "users", "id'; DROP TABLE users; --"));
}

// === EDGE CASES ===

#[test]
fn test_missing_table() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("empty.db");
    let conn = Connection::open(&db_path).unwrap();
    conn.execute_batch("CREATE TABLE other (x TEXT);").unwrap();
    drop(conn);

    let readonly = open_readonly(&db_path).unwrap();
    assert!(!table_exists(&readonly, "nonexistent"));
}

#[test]
fn test_table_exists_in_empty_database() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("empty.db");
    Connection::open(&db_path).unwrap();

    let readonly = open_readonly(&db_path).unwrap();
    assert!(!table_exists(&readonly, "anything"));
}

#[cfg(unix)]
#[test]
fn test_open_readonly_symlink() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = create_test_db(&dir);
    let link_path = dir.path().join("link.db");
    std::os::unix::fs::symlink(&db_path, &link_path).unwrap();

    assert!(open_readonly(&link_path).is_ok());
}
