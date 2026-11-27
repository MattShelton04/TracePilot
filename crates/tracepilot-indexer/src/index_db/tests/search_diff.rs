//! A re-indexed session keeps the stored rows its new snapshot starts with
//! and replaces only the rest, ending with the rows a full replace writes.

use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::SessionSource;

use super::common::write_session;
use crate::index_db::{IndexDb, search_writer::SearchContentRow};

fn fixture() -> (tempfile::TempDir, IndexDb, SessionId) {
    let temp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    let id = "22222222-2222-4222-8222-000000000001";
    let dir = write_session(temp.path(), id, "diff", "repo", "main", "user", "reply");
    db.upsert_session(&dir).unwrap();
    (temp, db, SessionId::from_validated(id))
}

fn rows(id: &SessionId, contents: &[&str]) -> Vec<SearchContentRow> {
    contents
        .iter()
        .enumerate()
        .map(|(index, content)| SearchContentRow {
            session_id: id.to_string(),
            content_type: "assistant_message",
            turn_number: Some(index as i64 / 2),
            event_index: index as i64,
            timestamp_unix: Some(1_700_000_000 + index as i64),
            tool_name: None,
            content: content.to_string(),
            metadata_json: None,
        })
        .collect()
}

fn write(db: &IndexDb, id: &SessionId, rows: &[SearchContentRow]) -> usize {
    db.upsert_search_snapshot(SessionSource::Copilot, id, rows, Some("fp"), &|| false)
        .unwrap()
}

/// (id, content) of the session's rows in id order.
fn stored(db: &IndexDb) -> Vec<(i64, String)> {
    db.conn
        .prepare("SELECT id, content FROM search_content ORDER BY id")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn hits(db: &IndexDb, term: &str) -> i64 {
    db.conn
        .query_row(
            "SELECT count(*) FROM search_fts WHERE search_fts MATCH ?1",
            [term],
            |row| row.get(0),
        )
        .unwrap()
}

fn assert_fts_in_sync(db: &IndexDb) {
    db.conn
        .execute_batch("INSERT INTO search_fts(search_fts, rank) VALUES('integrity-check', 1)")
        .unwrap();
}

#[test]
fn a_growing_session_keeps_its_stored_rows_and_adds_the_new_ones() {
    let (_temp, db, id) = fixture();
    assert_eq!(write(&db, &id, &rows(&id, &["alpha one", "beta two"])), 2);
    let before = stored(&db);

    let grown = rows(&id, &["alpha one", "beta two", "gamma three"]);
    assert_eq!(write(&db, &id, &grown), 3);
    let after = stored(&db);
    assert_eq!(after[..2], before[..], "unchanged rows were rewritten");
    assert_eq!(after[2].1, "gamma three");
    assert_eq!((hits(&db, "alpha"), hits(&db, "gamma")), (1, 1));
    assert_fts_in_sync(&db);
}

#[test]
fn a_changed_row_replaces_it_and_every_row_after_it() {
    let (_temp, db, id) = fixture();
    write(
        &db,
        &id,
        &rows(&id, &["alpha one", "beta two", "gamma three"]),
    );
    let before = stored(&db);

    write(
        &db,
        &id,
        &rows(&id, &["alpha one", "beta changed", "gamma three"]),
    );
    let after = stored(&db);
    assert_eq!(after[0], before[0]);
    let contents: Vec<_> = after.iter().map(|(_, content)| content.as_str()).collect();
    assert_eq!(contents, ["alpha one", "beta changed", "gamma three"]);
    assert!(after[1].0 > before[2].0, "the changed tail was re-inserted");
    assert_eq!((hits(&db, "two"), hits(&db, "changed")), (0, 1));
    assert_fts_in_sync(&db);
}

#[test]
fn a_shorter_or_empty_snapshot_drops_the_rows_it_no_longer_has() {
    let (_temp, db, id) = fixture();
    write(
        &db,
        &id,
        &rows(&id, &["alpha one", "beta two", "gamma three"]),
    );
    write(&db, &id, &rows(&id, &["alpha one"]));
    assert_eq!(stored(&db).len(), 1);
    assert_eq!(hits(&db, "gamma"), 0);
    write(&db, &id, &[]);
    assert!(stored(&db).is_empty());
    assert_eq!(hits(&db, "alpha"), 0);
    assert_fts_in_sync(&db);
}

#[test]
fn a_difference_in_any_column_counts_as_a_change() {
    let (_temp, db, id) = fixture();
    write(&db, &id, &rows(&id, &["alpha one"]));
    let mut moved = rows(&id, &["alpha one"]);
    moved[0].tool_name = Some("view".into());
    write(&db, &id, &moved);
    let tool: Option<String> = db
        .conn
        .query_row("SELECT tool_name FROM search_content", [], |row| row.get(0))
        .unwrap();
    assert_eq!(tool.as_deref(), Some("view"));
}
