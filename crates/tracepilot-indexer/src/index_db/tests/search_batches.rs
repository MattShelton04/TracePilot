//! Trigger-based batch commits retain per-session isolation and last-good FTS.

use std::cell::Cell;
use std::panic::{AssertUnwindSafe, catch_unwind};

use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::SessionSource;

use super::common::write_session;
use crate::index_db::{IndexDb, search_writer::SearchContentRow};

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

fn fixture() -> (tempfile::TempDir, IndexDb, Vec<SessionId>) {
    fixture_with_sessions(3)
}

fn fixture_with_sessions(count: usize) -> (tempfile::TempDir, IndexDb, Vec<SessionId>) {
    let temp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    let ids: Vec<_> = (0..count)
        .map(|index| {
            let id = format!("11111111-1111-4111-8111-{index:012}");
            let path = write_session(temp.path(), &id, "batch", "repo", "main", "user", "reply");
            db.upsert_session(&path).unwrap();
            let id = SessionId::from_validated(id);
            db.upsert_search_snapshot(
                SessionSource::Copilot,
                &id,
                &[row(&id, "original sentinel")],
                Some("old"),
                &|| false,
            )
            .unwrap();
            id
        })
        .collect();
    (temp, db, ids)
}

fn fingerprints(db: &IndexDb) -> Vec<String> {
    db.conn
        .prepare("SELECT search_source_fingerprint FROM sessions ORDER BY id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
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

fn replacement_rows(ids: &[SessionId]) -> Vec<(SessionId, Vec<SearchContentRow>)> {
    ids.iter()
        .map(|id| (id.clone(), vec![row(id, "replacement sentinel")]))
        .collect()
}

fn assert_original(db: &IndexDb) {
    assert!(db.conn.is_autocommit());
    assert_eq!(fingerprints(db), ["old", "old", "old"]);
    assert_eq!(hits(db, "original"), 3);
    assert_eq!(hits(db, "replacement"), 0);
    assert_eq!(db.search_content_row_count().unwrap(), 3);
}

#[test]
fn batch_commits_valid_sessions_while_failed_session_keeps_its_content_and_fingerprint() {
    let (_temp, db, ids) = fixture();
    let mut rows = replacement_rows(&ids);
    rows[1].1[0].content = "rejected sentinel".to_string();
    db.conn.execute_batch(
        "CREATE TRIGGER reject_test_row BEFORE INSERT ON search_content
         WHEN new.content = 'rejected sentinel' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
    ).unwrap();
    assert_eq!(
        db.upsert_search_snapshots(
            SessionSource::Copilot,
            &rows,
            &vec!["new".into(); 3],
            &|| false
        )
        .unwrap(),
        2
    );
    assert!(db.conn.is_autocommit());
    assert_eq!(fingerprints(&db), ["new", "old", "new"]);
    assert_eq!(hits(&db, "replacement"), 2);
    assert_eq!(hits(&db, "original"), 1);
    assert_eq!(hits(&db, "rejected"), 0);
}

#[test]
fn sqlite_automatic_rollback_does_not_allow_later_sessions_to_commit_alone() {
    let (_temp, db, ids) = fixture();
    let mut rows = replacement_rows(&ids);
    rows[1].1[0].content = "rejected sentinel".to_string();
    db.conn.execute_batch(
        "CREATE TRIGGER rollback_test_batch BEFORE INSERT ON search_content
         WHEN new.content = 'rejected sentinel' BEGIN SELECT RAISE(ROLLBACK, 'injected failure'); END;",
    ).unwrap();
    assert!(
        db.upsert_search_snapshots(
            SessionSource::Copilot,
            &rows,
            &vec!["new".into(); 3],
            &|| false
        )
        .is_err()
    );
    assert_original(&db);
}

#[test]
fn cancellation_after_a_released_session_savepoint_rolls_back_the_whole_batch() {
    let (_temp, db, ids) = fixture();
    let rows = replacement_rows(&ids);
    let saw_uncommitted_write = Cell::new(false);
    let result = db.upsert_search_snapshots(
        SessionSource::Copilot,
        &rows,
        &vec!["new".into(); 3],
        &|| {
            let cancel = fingerprints(&db)[0] == "new";
            saw_uncommitted_write.set(saw_uncommitted_write.get() || cancel);
            cancel
        },
    );
    assert!(result.is_err());
    assert!(saw_uncommitted_write.get());
    assert_original(&db);
}

#[test]
fn panic_after_a_released_session_savepoint_rolls_back_and_allows_retry() {
    let (_temp, db, ids) = fixture();
    let rows = replacement_rows(&ids);
    let result = catch_unwind(AssertUnwindSafe(|| {
        db.upsert_search_snapshots(
            SessionSource::Copilot,
            &rows,
            &vec!["new".into(); 3],
            &|| {
                assert_ne!(fingerprints(&db)[0], "new", "injected callback panic");
                false
            },
        )
    }));
    assert!(result.is_err());
    assert_original(&db);
    assert_eq!(
        db.upsert_search_snapshots(
            SessionSource::Copilot,
            &rows,
            &vec!["new".into(); 3],
            &|| false
        )
        .unwrap(),
        3
    );
    assert_eq!(hits(&db, "replacement"), 3);
    assert_eq!(hits(&db, "original"), 0);
}

#[test]
fn commit_failure_rolls_back_rows_fingerprints_and_fts() {
    let (_temp, db, ids) = fixture();
    let mut rows = replacement_rows(&ids);
    // The invalid FK survives each nested savepoint and fails only at COMMIT.
    db.conn
        .execute_batch("PRAGMA defer_foreign_keys=ON;")
        .unwrap();
    rows[2].1[0].session_id = "missing-session".to_string();
    assert!(
        db.upsert_search_snapshots(
            SessionSource::Copilot,
            &rows,
            &vec!["new".into(); 3],
            &|| false
        )
        .is_err()
    );
    assert_original(&db);
}

#[test]
fn standalone_cancellation_after_fingerprint_update_retains_last_good_snapshot() {
    let (_temp, db, ids) = fixture();
    let saw_uncommitted_write = Cell::new(false);
    let result = db.upsert_search_snapshot(
        SessionSource::Copilot,
        &ids[0],
        &[row(&ids[0], "replacement sentinel")],
        Some("new"),
        &|| {
            let cancel = fingerprints(&db)[0] == "new";
            saw_uncommitted_write.set(saw_uncommitted_write.get() || cancel);
            cancel
        },
    );
    assert!(result.is_err());
    assert!(saw_uncommitted_write.get());
    assert_original(&db);
}

#[test]
fn standalone_panic_after_replacement_rolls_back_and_allows_retry() {
    let (_temp, db, ids) = fixture();
    let rows = [row(&ids[0], "replacement sentinel")];
    let result = catch_unwind(AssertUnwindSafe(|| {
        db.upsert_search_snapshot(SessionSource::Copilot, &ids[0], &rows, Some("new"), &|| {
            assert_eq!(hits(&db, "replacement"), 0, "injected callback panic");
            false
        })
    }));
    assert!(result.is_err());
    assert_original(&db);
    assert_eq!(
        db.upsert_search_snapshot(SessionSource::Copilot, &ids[0], &rows, Some("new"), &|| {
            false
        })
        .unwrap(),
        1
    );
    assert!(db.conn.is_autocommit());
    assert_eq!(fingerprints(&db), ["new", "old", "old"]);
    assert_eq!(hits(&db, "original"), 2);
    assert_eq!(hits(&db, "replacement"), 1);
}

#[test]
fn standalone_commit_failure_rolls_back_rows_fingerprint_and_fts() {
    let (_temp, db, ids) = fixture();
    db.conn
        .execute_batch("PRAGMA defer_foreign_keys=ON;")
        .unwrap();
    let mut invalid_row = row(&ids[0], "replacement sentinel");
    invalid_row.session_id = "missing-session".to_string();
    assert!(
        db.upsert_search_snapshot(
            SessionSource::Copilot,
            &ids[0],
            &[invalid_row],
            Some("new"),
            &|| false
        )
        .is_err()
    );
    assert_original(&db);
}

#[test]
fn small_trigger_batches_commit_and_count_each_session_before_cancellation() {
    for count in [3, 9] {
        let (temp, db, _ids) = fixture_with_sessions(count);
        // Observe only committed writes through a separate connection from the
        // indexer. Cancel immediately after its first durable session update.
        let result = crate::reindex_search_content(
            temp.path(),
            &temp.path().join("index.db"),
            |_| {},
            || {
                fingerprints(&db)
                    .iter()
                    .any(|fingerprint| fingerprint != "old")
            },
        )
        .unwrap();
        assert_eq!(result, (1, 0));
        assert_eq!(hits(&db, "original"), count - 1);
        assert_eq!(hits(&db, "user"), 1);
        assert_eq!(
            fingerprints(&db)
                .iter()
                .filter(|fingerprint| *fingerprint == "old")
                .count(),
            count - 1
        );
        assert_eq!(
            crate::reindex_search_content(
                temp.path(),
                &temp.path().join("index.db"),
                |_| {},
                || false
            )
            .unwrap(),
            (count - 1, 1),
        );
    }
}

#[test]
fn ten_small_trigger_updates_remain_one_atomic_batch() {
    let (temp, db, ids) = fixture_with_sessions(10);
    // Enough existing rows to select trigger updates instead of full FTS rebuild.
    let old_rows: Vec<_> = (0..100)
        .map(|_| row(&ids[0], "original sentinel"))
        .collect();
    db.upsert_search_snapshot(
        SessionSource::Copilot,
        &ids[0],
        &old_rows,
        Some("old"),
        &|| false,
    )
    .unwrap();
    let result = crate::reindex_search_content(
        temp.path(),
        &temp.path().join("index.db"),
        |_| {},
        || {
            fingerprints(&db)
                .iter()
                .any(|fingerprint| fingerprint != "old")
        },
    )
    .unwrap();
    assert_eq!(result, (10, 0));
    assert_eq!(hits(&db, "original"), 0);
    assert_eq!(hits(&db, "user"), 10);
}
