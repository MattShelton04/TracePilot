//! Bulk search-content write tests.

use super::common::write_session;
use crate::index_db::IndexDb;
use crate::index_db::search_writer::SearchContentRow;
use tracepilot_core::ids::SessionId;

fn row(session_id: &str, event_index: i64, content: &str) -> SearchContentRow {
    SearchContentRow {
        session_id: session_id.to_string(),
        content_type: "tool_result",
        turn_number: Some(0),
        event_index,
        timestamp_unix: Some(1700000000 + event_index),
        tool_name: None,
        content: content.to_string(),
        metadata_json: None,
    }
}

/// SQLite's `trim` strips only spaces and its `length` stops at a NUL, so a
/// row of spaces, or one with a NUL after a space, once failed the table's
/// CHECK and with it the whole session, which then stayed stale.
#[test]
fn whitespace_only_rows_are_skipped_instead_of_failing_the_session() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let ids = [
        "cccc1111-1111-1111-1111-111111111111",
        "cccc2222-2222-2222-2222-222222222222",
    ];
    for id in ids {
        let dir = write_session(tmp.path(), id, "Blank rows", "org/repo", "main", "u", "a");
        db.upsert_session(&dir).unwrap();
    }
    let rows = |id: &str| {
        vec![
            row(id, 0, " "),
            row(id, 1, "   "),
            row(id, 2, "\n\t "),
            // UTF-16 output read as UTF-8: SQLite's `length` stops at the NUL.
            row(id, 3, " \0N\0A\0M\0E"),
            row(id, 4, "kept searchable text"),
        ]
    };

    let per_session = db
        .upsert_search_content(&SessionId::from_validated(ids[0]), &rows(ids[0]))
        .unwrap();
    assert_eq!(per_session, 1);
    let bulk = db
        .bulk_write_search_content(&[(SessionId::from_validated(ids[1]), rows(ids[1]))])
        .unwrap();
    assert_eq!(bulk, 1);

    for id in ids {
        let (stored, indexed): (i64, bool) = db
            .conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM search_content WHERE session_id = ?1),
                        (SELECT search_indexed_at IS NOT NULL FROM sessions WHERE id = ?1)",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((stored, indexed), (1, true), "session {id}");
    }
}

#[test]
fn test_bulk_write_search_content_produces_searchable_fts() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session_id = "bbbb1111-1111-1111-1111-111111111111";

    // Create a session first (FK constraint)
    let session_dir = write_session(
        tmp.path(),
        session_id,
        "Bulk write test",
        "org/repo",
        "main",
        "user msg",
        "assistant msg",
    );
    db.upsert_session(&session_dir).unwrap();

    let rows = vec![
        SearchContentRow {
            session_id: session_id.to_string(),
            content_type: "user_message",
            turn_number: Some(0),
            event_index: 0,
            timestamp_unix: Some(1700000000),
            tool_name: None,
            content: "searching for quantum entanglement algorithms".to_string(),
            metadata_json: None,
        },
        SearchContentRow {
            session_id: session_id.to_string(),
            content_type: "assistant_message",
            turn_number: Some(0),
            event_index: 1,
            timestamp_unix: Some(1700000001),
            tool_name: None,
            content: "here are the optimized sorting implementations".to_string(),
            metadata_json: None,
        },
    ];

    let session_rows = vec![(SessionId::from_validated(session_id), rows)];
    let inserted = db.bulk_write_search_content(&session_rows).unwrap();
    assert_eq!(inserted, 2);

    // Verify FTS search works after bulk write + rebuild
    let hits: Vec<String> = db
        .conn
        .prepare(
            "SELECT sc.session_id FROM search_content sc \
             JOIN search_fts ON sc.id = search_fts.rowid \
             WHERE search_fts MATCH ?1",
        )
        .unwrap()
        .query_map(["quantum"], |row| row.get(0))
        .unwrap()
        .collect::<std::result::Result<_, _>>()
        .unwrap();
    assert!(
        hits.contains(&session_id.to_string()),
        "FTS should find 'quantum'"
    );

    // Verify triggers restored — incremental upsert should work after bulk
    let extra_row = vec![SearchContentRow {
        session_id: session_id.to_string(),
        content_type: "user_message",
        turn_number: Some(1),
        event_index: 2,
        timestamp_unix: Some(1700000002),
        tool_name: None,
        content: "incremental upsert after bulk write".to_string(),
        metadata_json: None,
    }];
    let upserted = db
        .upsert_search_content(&SessionId::from_validated(session_id), &extra_row)
        .unwrap();
    assert_eq!(upserted, 1);

    // Verify the new row is searchable via trigger-based FTS
    let incremental_hits: Vec<String> = db
        .conn
        .prepare(
            "SELECT sc.session_id FROM search_content sc \
             JOIN search_fts ON sc.id = search_fts.rowid \
             WHERE search_fts MATCH ?1",
        )
        .unwrap()
        .query_map(["incremental"], |row| row.get(0))
        .unwrap()
        .collect::<std::result::Result<_, _>>()
        .unwrap();
    assert!(
        incremental_hits.contains(&session_id.to_string()),
        "FTS should find 'incremental' after trigger-based upsert post-bulk"
    );
}
