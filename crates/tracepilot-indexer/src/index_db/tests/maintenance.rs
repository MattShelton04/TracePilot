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
    db.upsert_search_content(
        &tracepilot_core::ids::SessionId::from_validated("maint-1111-1111-1111-111111111111"),
        &rows,
    )
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

fn search_row(session_id: &str, content: String) -> SearchContentRow {
    SearchContentRow {
        session_id: session_id.to_string(),
        content_type: "user_message",
        turn_number: Some(0),
        event_index: 0,
        timestamp_unix: Some(1000),
        tool_name: None,
        content,
        metadata_json: None,
    }
}

fn fts_matches(db: &IndexDb, query: &str) -> i64 {
    db.conn
        .query_row(
            "SELECT count(*) FROM search_fts WHERE search_fts MATCH ?1",
            [query],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn fts_merge_steps_leave_one_segment_with_the_same_answers() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let id = "merge-1111-1111-1111-111111111111";
    let session_dir = write_session(tmp.path(), id, "Merge", "org/repo", "main", "hi", "hi");
    db.upsert_session(&session_dir).unwrap();
    let session_id = tracepilot_core::ids::SessionId::from_validated(id);
    // Each replacement writes a segment and deletes the previous rows.
    for version in 0..20 {
        let rows = (0..50)
            .map(|row| search_row(id, format!("version{version} row{row} shared words")))
            .collect::<Vec<_>>();
        db.upsert_search_content(&session_id, &rows).unwrap();
    }
    let before = (fts_matches(&db, "version19"), fts_matches(&db, "version3"));

    let budget = std::time::Duration::from_secs(60);
    assert!(
        db.merge_fts_segments(budget).unwrap() > 0,
        "segments to merge"
    );
    assert_eq!(
        db.merge_fts_segments(budget).unwrap(),
        0,
        "one segment remains"
    );
    // `optimize` finds nothing further to merge.
    let changes = db.conn.total_changes();
    db.conn
        .execute_batch("INSERT INTO search_fts(search_fts) VALUES('optimize')")
        .unwrap();
    assert!(db.conn.total_changes() - changes < 2);
    db.conn
        .execute_batch("INSERT INTO search_fts(search_fts) VALUES('integrity-check')")
        .unwrap();
    assert_eq!(before, (50, 0));
    assert_eq!(
        (fts_matches(&db, "version19"), fts_matches(&db, "version3")),
        before
    );
}

#[test]
fn fts_merge_stops_at_its_budget_and_resumes() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let id = "budget-1111-1111-1111-111111111111";
    let session_dir = write_session(tmp.path(), id, "Budget", "org/repo", "main", "hi", "hi");
    db.upsert_session(&session_dir).unwrap();
    let session_id = tracepilot_core::ids::SessionId::from_validated(id);
    for version in 0..20 {
        let rows = (0..50)
            .map(|row| search_row(id, format!("version{version} row{row} shared words")))
            .collect::<Vec<_>>();
        db.upsert_search_content(&session_id, &rows).unwrap();
    }
    // An exhausted budget still makes progress, one step per pass.
    assert_eq!(db.merge_fts_segments(std::time::Duration::ZERO).unwrap(), 1);
    db.conn
        .execute_batch("INSERT INTO search_fts(search_fts) VALUES('integrity-check')")
        .unwrap();
    assert_eq!(fts_matches(&db, "version19"), 50);
    let budget = std::time::Duration::from_secs(60);
    db.merge_fts_segments(budget).unwrap();
    assert_eq!(db.merge_fts_segments(budget).unwrap(), 0);
}

#[test]
fn first_maintenance_writes_planner_statistics() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let id = "stats-1111-1111-1111-111111111111";
    let session_dir = write_session(tmp.path(), id, "Stats", "org/repo", "main", "hi", "hi");
    db.upsert_session(&session_dir).unwrap();
    let rows = (0..20)
        .map(|row| search_row(id, format!("row{row} words")))
        .collect::<Vec<_>>();
    db.upsert_search_content(&tracepilot_core::ids::SessionId::from_validated(id), &rows)
        .unwrap();

    db.maintenance();

    let analyzed: i64 = db
        .conn
        .query_row(
            "SELECT count(*) FROM sqlite_stat1 WHERE tbl = 'search_content'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(analyzed > 0, "search_content indexes analyzed");
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
