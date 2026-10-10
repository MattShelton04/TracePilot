//! A first index syncs `search_fts` once, after its last write; whatever
//! interrupts it, the next pass rebuilds before anything else.

use std::cell::Cell;
use std::collections::HashSet;

use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::SessionSource;

use super::common::write_session;
use crate::index_db::{IndexDb, search_writer::SearchContentRow};

fn session_id(index: usize) -> String {
    format!("22222222-2222-4222-8222-{index:012}")
}

/// `count` Copilot sessions, indexed in phase 1 but with no search content.
fn corpus(count: usize) -> (tempfile::TempDir, std::path::PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    for index in 0..count {
        let reply = format!("reply{index}");
        write_session(
            temp.path(),
            &session_id(index),
            "deferred",
            "repo",
            "main",
            "sentinel",
            &reply,
        );
    }
    let path = temp.path().join("index.db");
    crate::reindex_all(temp.path(), &path).unwrap();
    (temp, path)
}

fn hits(db: &IndexDb, term: &str) -> usize {
    db.conn
        .query_row(
            "SELECT count(*) FROM search_fts WHERE search_fts MATCH ?1",
            [term],
            |row| row.get(0),
        )
        .unwrap()
}

/// FTS5's own check that the index holds exactly `search_content`.
fn in_sync(db: &IndexDb) -> bool {
    db.conn
        .execute_batch("INSERT INTO search_fts(search_fts, rank) VALUES('integrity-check', 1)")
        .is_ok()
}

fn rebuild_pending(db: &IndexDb) -> bool {
    db.conn
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM maintenance_state WHERE key = 'search_fts_rebuild_pending')",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

fn triggers(db: &IndexDb) -> Vec<String> {
    db.conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'search_content' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

const SYNC_TRIGGERS: [&str; 3] = [
    "search_content_ad",
    "search_content_ai",
    "search_content_au",
];

fn row(id: &SessionId, content: &str) -> SearchContentRow {
    SearchContentRow {
        session_id: id.to_string(),
        content_type: "user_message",
        turn_number: Some(0),
        event_index: 0,
        timestamp_unix: None,
        tool_name: None,
        content: content.to_string(),
        metadata_json: None,
    }
}

#[test]
fn a_first_index_ends_with_the_index_in_sync_and_later_passes_use_the_triggers() {
    let (temp, path) = corpus(40);
    assert_eq!(
        crate::reindex_search_content(temp.path(), &path, |_| {}, || false).unwrap(),
        (40, 0)
    );
    let db = IndexDb::open_or_create(&path).unwrap();
    assert!(in_sync(&db));
    assert!(!rebuild_pending(&db));
    assert_eq!(triggers(&db), SYNC_TRIGGERS);
    assert_eq!(hits(&db, "sentinel"), 40);
    assert_eq!(hits(&db, "reply7"), 1);

    // An incremental pass replaces a session's rows through the triggers.
    write_session(
        temp.path(),
        &session_id(7),
        "deferred",
        "repo",
        "main",
        "edited",
        "changed",
    );
    crate::reindex_all(temp.path(), &path).unwrap();
    assert_eq!(
        crate::reindex_search_content(temp.path(), &path, |_| {}, || false).unwrap(),
        (1, 39)
    );
    assert!(in_sync(&db));
    assert_eq!(hits(&db, "reply7"), 0);
    assert_eq!(hits(&db, "changed"), 1);
    assert_eq!(hits(&db, "sentinel"), 39);
}

#[test]
fn a_cancelled_first_index_commits_whole_batches_and_the_next_pass_rebuilds_first() {
    let (temp, path) = corpus(40);
    let cancelled = Cell::new(false);
    // Cancel once the first batch (32 sessions) has committed.
    let result = crate::reindex_search_content(
        temp.path(),
        &path,
        |_| cancelled.set(true),
        || cancelled.get(),
    )
    .unwrap();
    assert_eq!(result, (32, 0));
    let db = IndexDb::open_or_create(&path).unwrap();
    let sessions_with_rows: usize = db
        .conn
        .query_row(
            "SELECT count(DISTINCT session_id) FROM search_content",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(sessions_with_rows, 32);
    // Cancelling skips the rebuild; the rows wait for the next pass.
    assert!(rebuild_pending(&db));
    assert_eq!(hits(&db, "sentinel"), 0);
    assert_eq!(triggers(&db), SYNC_TRIGGERS);

    // The next pass rebuilds, then indexes the rest through the triggers.
    assert_eq!(
        crate::reindex_search_content(temp.path(), &path, |_| {}, || false).unwrap(),
        (8, 32)
    );
    assert!(!rebuild_pending(&db));
    assert!(in_sync(&db));
    assert_eq!(hits(&db, "sentinel"), 40);
}

#[test]
fn a_pass_with_nothing_to_index_still_finishes_an_interrupted_rebuild() {
    let (temp, path) = corpus(3);
    crate::reindex_search_content(temp.path(), &path, |_| {}, || false).unwrap();
    // As if a first index had committed every batch and then crashed.
    let db = IndexDb::open_or_create(&path).unwrap();
    db.conn
        .execute_batch(
            "INSERT INTO search_fts(search_fts) VALUES('delete-all');
             INSERT INTO maintenance_state (key, value) VALUES ('search_fts_rebuild_pending', '1');",
        )
        .unwrap();
    assert_eq!(hits(&db, "sentinel"), 0);

    assert_eq!(
        crate::reindex_search_content(temp.path(), &path, |_| {}, || false).unwrap(),
        (0, 3)
    );
    assert!(!rebuild_pending(&db));
    assert!(in_sync(&db));
    assert_eq!(hits(&db, "sentinel"), 3);
}

/// Commit `count` sessions' rows without FTS sync, as a first index does.
fn deferred(db: &IndexDb, count: usize) -> Vec<SessionId> {
    let ids: Vec<_> = (0..count)
        .map(|index| SessionId::from_validated(session_id(index)))
        .collect();
    let rows: Vec<_> = ids
        .iter()
        .map(|id| (id.clone(), vec![row(id, &format!("deferred {id}"))]))
        .collect();
    assert_eq!(
        db.write_search_snapshots_deferred(
            SessionSource::Copilot,
            &rows,
            &vec!["fp".to_string(); count],
            &|| false
        )
        .unwrap(),
        count
    );
    assert!(rebuild_pending(db));
    assert_eq!(triggers(db), SYNC_TRIGGERS);
    assert!(!in_sync(db), "committed rows wait for the rebuild");
    ids
}

#[test]
fn a_prune_purge_or_clear_before_the_rebuild_rebuilds_first() {
    let (_temp, path) = corpus(3);
    let db = IndexDb::open_or_create(&path).unwrap();
    let ids = deferred(&db, 3);
    // A deleted session is pruned: its rows go through the triggers.
    let live: HashSet<&str> = [ids[0].as_str(), ids[2].as_str()].into();
    assert_eq!(db.prune_deleted(SessionSource::Copilot, &live).unwrap(), 1);
    assert!(!rebuild_pending(&db));
    assert!(in_sync(&db));
    assert_eq!(hits(&db, "deferred"), 2);

    let (_temp, path) = corpus(2);
    let db = IndexDb::open_or_create(&path).unwrap();
    deferred(&db, 2);
    assert_eq!(
        db.purge_source(SessionSource::Copilot, &|| true).unwrap(),
        2
    );
    assert!(in_sync(&db));
    assert_eq!(hits(&db, "deferred"), 0);

    let (_temp, path) = corpus(2);
    let db = IndexDb::open_or_create(&path).unwrap();
    deferred(&db, 2);
    db.clear_search_content().unwrap();
    assert!(!rebuild_pending(&db));
    assert!(in_sync(&db));
    assert_eq!(db.search_content_row_count().unwrap(), 0);
}

#[test]
fn a_stale_purge_keeps_the_rebuild_pending() {
    let (_temp, path) = corpus(2);
    let db = IndexDb::open_or_create(&path).unwrap();
    deferred(&db, 2);
    assert!(db.purge_source(SessionSource::Copilot, &|| false).is_err());
    assert!(rebuild_pending(&db));
    assert_eq!(db.search_content_row_count().unwrap(), 2);
    assert!(db.finish_deferred_search_fts().unwrap());
    assert!(!db.finish_deferred_search_fts().unwrap());
    assert!(in_sync(&db));
    assert_eq!(hits(&db, "deferred"), 2);
}

#[test]
fn a_deferred_batch_that_does_not_commit_keeps_the_triggers_and_nothing_else() {
    let (_temp, path) = corpus(2);
    let db = IndexDb::open_or_create(&path).unwrap();
    let ids: Vec<_> = (0..2)
        .map(|index| SessionId::from_validated(session_id(index)))
        .collect();
    let rows: Vec<_> = ids
        .iter()
        .map(|id| (id.clone(), vec![row(id, "uncommitted sentinel")]))
        .collect();
    let fingerprints = vec!["fp".to_string(); 2];

    // Cancelled after its writes, before the commit.
    let wrote = Cell::new(false);
    let result =
        db.write_search_snapshots_deferred(SessionSource::Copilot, &rows, &fingerprints, &|| {
            let written = db.search_content_row_count().unwrap() == 2;
            wrote.set(wrote.get() || written);
            wrote.get()
        });
    assert!(result.is_err());
    assert!(wrote.get());

    // SQLite ends the transaction itself (RAISE(ROLLBACK)), alone or in a batch.
    db.conn
        .execute_batch(
            "CREATE TRIGGER reject_test_row BEFORE INSERT ON search_content
             BEGIN SELECT RAISE(ROLLBACK, 'injected failure'); END;",
        )
        .unwrap();
    for batch in [&rows[..1], &rows[..]] {
        assert!(
            db.write_search_snapshots_deferred(
                SessionSource::Copilot,
                batch,
                &fingerprints[..batch.len()],
                &|| false
            )
            .is_err()
        );
    }
    db.conn
        .execute_batch("DROP TRIGGER reject_test_row")
        .unwrap();

    assert!(db.conn.is_autocommit());
    assert_eq!(triggers(&db), SYNC_TRIGGERS);
    assert!(!rebuild_pending(&db));
    assert_eq!(db.search_content_row_count().unwrap(), 0);
    // The triggers still keep the index in step.
    db.upsert_search_content(&ids[0], &[row(&ids[0], "synced sentinel")])
        .unwrap();
    assert_eq!(hits(&db, "synced"), 1);
    assert!(in_sync(&db));
}
