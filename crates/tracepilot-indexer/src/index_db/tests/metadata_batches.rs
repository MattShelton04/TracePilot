//! A failed session write inside a metadata batch. An ordinary failure keeps
//! the batch's other sessions; one that ends SQLite's transaction stops the
//! batch with the original error and commits none of it.

use std::path::{Path, PathBuf};

use super::common::write_session;
use crate::index_db::IndexDb;
use crate::{IndexingProgress, reindex_all, reindex_all_with_rich_progress};

const IDS: [&str; 3] = [
    "22222222-2222-4222-8222-000000000000",
    "22222222-2222-4222-8222-000000000001",
    "22222222-2222-4222-8222-000000000002",
];

struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    db_path: PathBuf,
}

/// Three sessions, and a trigger that fails the second one's insert with
/// `RAISE(<raise>, 'synthetic')`.
fn fixture(raise: &str) -> Fixture {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("session-state");
    for id in IDS {
        write_session(&root, id, "batch", "repo", "main", "user", "reply");
    }
    let db_path = temp.path().join("index.db");
    IndexDb::open_or_create(&db_path)
        .unwrap()
        .conn
        .execute_batch(&format!(
            "CREATE TRIGGER reject_second_session BEFORE INSERT ON sessions
             WHEN new.id = '{}' BEGIN SELECT RAISE({raise}, 'synthetic'); END;",
            IDS[1]
        ))
        .unwrap();
    Fixture {
        _temp: temp,
        root,
        db_path,
    }
}

fn indexed_ids(db_path: &Path) -> Vec<String> {
    IndexDb::open_readonly(db_path)
        .unwrap()
        .conn
        .prepare("SELECT id FROM sessions ORDER BY id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

fn indexed_events(db_path: &Path) -> u64 {
    IndexDb::open_readonly(db_path)
        .unwrap()
        .conn
        .query_row(
            "SELECT COALESCE(SUM(event_count), 0) FROM sessions",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
fn a_session_that_rolls_back_the_transaction_stops_its_batch_with_the_original_error() {
    let fixture = fixture("ROLLBACK");

    let error = reindex_all(&fixture.root, &fixture.db_path).unwrap_err();
    let committed = indexed_ids(&fixture.db_path);

    assert!(
        error.to_string().contains("synthetic"),
        "error: {error}; committed: {committed:?}"
    );
    assert!(
        committed.is_empty(),
        "no session of the rolled-back batch may be committed: {committed:?}"
    );

    // Nothing is left half-written: once the failure is gone, a retry
    // indexes the whole batch.
    IndexDb::open_or_create(&fixture.db_path)
        .unwrap()
        .conn
        .execute_batch("DROP TRIGGER reject_second_session")
        .unwrap();
    assert_eq!(reindex_all(&fixture.root, &fixture.db_path).unwrap(), 3);
    assert_eq!(indexed_ids(&fixture.db_path), IDS);
}

#[test]
fn an_aborted_session_write_keeps_the_rest_of_its_batch() {
    let fixture = fixture("ABORT");
    let mut last: Option<IndexingProgress> = None;

    let indexed = reindex_all_with_rich_progress(&fixture.root, &fixture.db_path, |progress| {
        last = Some(progress.clone());
    })
    .unwrap();

    assert_eq!(indexed, 2);
    assert_eq!(indexed_ids(&fixture.db_path), [IDS[0], IDS[2]]);
    let last = last.unwrap();
    assert_eq!((last.current, last.total), (3, 3));
    assert_eq!(last.running_events, indexed_events(&fixture.db_path));
}
