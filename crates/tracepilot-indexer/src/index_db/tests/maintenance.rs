//! Maintenance & auto-vacuum tests.

use super::common::write_session;
use crate::index_db::IndexDb;
use crate::index_db::search_writer::SearchContentRow;

#[test]
fn test_new_db_has_incremental_auto_vacuum() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let auto_vacuum: i64 = db
        .conn
        .query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        auto_vacuum, 2,
        "New databases should use incremental auto_vacuum"
    );
}

#[test]
fn test_maintenance_force_runs_without_error() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    // Insert some data so maintenance has something to work with
    let session_dir = write_session(
        tmp.path(),
        "maint-1111-1111-1111-111111111111",
        "Test maintenance",
        "org/repo",
        "main",
        "hello world",
        "goodbye world",
    );
    db.upsert_session(&session_dir).unwrap();

    let rows = vec![SearchContentRow {
        session_id: "maint-1111-1111-1111-111111111111".to_string(),
        content_type: "user_message",
        turn_number: Some(0),
        event_index: 0,
        timestamp_unix: Some(1000),
        tool_name: None,
        content: "hello world maintenance test".to_string(),
        metadata_json: None,
    }];
    db.upsert_search_content("maint-1111-1111-1111-111111111111", &rows)
        .unwrap();

    // maintenance_force bypasses the time gate
    db.maintenance_force();

    // Verify freelist is small after maintenance
    let freelist: i64 = db
        .conn
        .query_row("PRAGMA freelist_count", [], |row| row.get(0))
        .unwrap();
    assert!(
        freelist < 10,
        "Freelist should be small after maintenance, got {freelist}"
    );
}

#[test]
fn test_maintenance_throttles_repeated_calls() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    // Fresh DB has no epoch. First maintenance() should run and set it.
    assert_eq!(
        db.read_maintenance_epoch(),
        0,
        "Fresh DB should have no epoch"
    );
    db.maintenance();
    let epoch = db.read_maintenance_epoch();
    assert!(epoch > 0, "First maintenance() should set the epoch");

    // A second maintenance() call should be throttled (no-op)
    db.maintenance();
    let after = db.read_maintenance_epoch();
    assert_eq!(
        epoch, after,
        "Throttled maintenance should not update epoch"
    );
}

#[test]
fn test_reopen_preserves_incremental_auto_vacuum() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("index.db");

    // Create the DB
    let db = IndexDb::open_or_create(&db_path).unwrap();
    drop(db);

    // Reopen and verify auto_vacuum is still incremental
    let db2 = IndexDb::open_or_create(&db_path).unwrap();
    let auto_vacuum: i64 = db2
        .conn
        .query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
        .unwrap();
    assert_eq!(auto_vacuum, 2, "auto_vacuum should persist across reopens");
}
