use std::cell::Cell;
use std::io::Write;

use tracepilot_core::ids::SessionId;

use super::common::write_session_with_tools;
use crate::index_db::{IndexDb, search_writer, session_writer};

const ID: &str = "11111111-1111-4111-8111-111111111111";

fn append(path: &std::path::Path) {
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(path.join("events.jsonl"))
        .unwrap();
    writeln!(
        file,
        "{{\"type\":\"user.message\",\"data\":{{\"content\":\"appended sentinel\"}}}}"
    )
    .unwrap();
}

#[test]
fn append_between_analytics_prepare_and_write_keeps_last_good_data() {
    let temp = tempfile::tempdir().unwrap();
    let path = write_session_with_tools(temp.path(), ID, "org/repo", "2026-03-10T07:15:00Z");
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();
    let prepared = session_writer::prepare_session_data(&path).unwrap();
    append(&path);
    assert!(db.write_prepared_session(&prepared).is_err());
    assert!(db.needs_reindex(&SessionId::from_validated(ID), &path));
    let events: i64 = db
        .conn
        .query_row("SELECT event_count FROM sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(events, 7);
    db.upsert_session(&path).unwrap();
    assert!(!db.needs_reindex(&SessionId::from_validated(ID), &path));
}

#[test]
fn failed_source_reads_keep_analytics_and_child_rows() {
    let temp = tempfile::tempdir().unwrap();
    let path = write_session_with_tools(temp.path(), ID, "org/repo", "2026-03-10T07:15:00Z");
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();
    let before = db.query_analytics(None, None, None, false).unwrap();
    for bad_bytes in [vec![0xff, 0xfe], b"{broken".to_vec()] {
        std::fs::write(path.join("events.jsonl"), bad_bytes).unwrap();
        assert!(db.upsert_session(&path).is_err());
        assert!(db.needs_reindex(&SessionId::from_validated(ID), &path));
        let after = db.query_analytics(None, None, None, false).unwrap();
        assert_eq!(before.total_tokens, after.total_tokens);
        assert_eq!(before.total_sessions, after.total_sessions);
        assert_eq!(
            db.query_tool_analysis(None, None, None, false)
                .unwrap()
                .total_calls,
            2
        );
    }
    write_session_with_tools(temp.path(), ID, "org/repo", "2026-03-10T07:15:00Z");
    std::fs::write(path.join("workspace.yaml"), "id: [broken").unwrap();
    assert!(db.upsert_session(&path).is_err());
    let repository: String = db
        .conn
        .query_row("SELECT repository FROM sessions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(repository, "org/repo");
}

#[test]
fn newer_analytics_cannot_certify_old_search_content() {
    let temp = tempfile::tempdir().unwrap();
    let path = write_session_with_tools(temp.path(), ID, "org/repo", "2026-03-10T07:15:00Z");
    let id = SessionId::from_validated(ID);
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();
    let old =
        tracepilot_core::parsing::events::load_event_snapshot(&path.join("events.jsonl"), &|| {
            false
        })
        .unwrap();
    let rows = search_writer::extract_search_content(&id, &old.parsed.unwrap().events);
    let fingerprint = serde_json::to_string(&old.fingerprint).unwrap();
    append(&path);
    db.upsert_session(&path).unwrap();
    db.upsert_search_snapshot(&id, &rows, Some(&fingerprint), &|| false)
        .unwrap();
    assert!(!db.needs_reindex(&id, &path));
    assert!(db.needs_search_reindex(&id, &path));
    let new =
        tracepilot_core::parsing::events::load_event_snapshot(&path.join("events.jsonl"), &|| {
            false
        })
        .unwrap();
    let rows = search_writer::extract_search_content(&id, &new.parsed.unwrap().events);
    let fingerprint = serde_json::to_string(&new.fingerprint).unwrap();
    db.upsert_search_snapshot(&id, &rows, Some(&fingerprint), &|| false)
        .unwrap();
    assert!(!db.needs_search_reindex(&id, &path));
}

#[test]
fn cancellation_rolls_back_content_and_freshness_together() {
    let temp = tempfile::tempdir().unwrap();
    let path = write_session_with_tools(temp.path(), ID, "org/repo", "2026-03-10T07:15:00Z");
    let id = SessionId::from_validated(ID);
    let db = IndexDb::open_or_create(&temp.path().join("index.db")).unwrap();
    db.upsert_session(&path).unwrap();
    let old =
        tracepilot_core::parsing::events::load_event_snapshot(&path.join("events.jsonl"), &|| {
            false
        })
        .unwrap();
    let rows = search_writer::extract_search_content(&id, &old.parsed.unwrap().events);
    let fingerprint = serde_json::to_string(&old.fingerprint).unwrap();
    db.upsert_search_snapshot(&id, &rows, Some(&fingerprint), &|| false)
        .unwrap();
    let before = db.search_content_row_count().unwrap();
    let checks = Cell::new(0);
    assert!(
        db.upsert_search_snapshot(&id, &rows, Some("wrong"), &|| {
            checks.set(checks.get() + 1);
            checks.get() > 1
        })
        .is_err()
    );
    assert_eq!(before, db.search_content_row_count().unwrap());
    assert!(!db.needs_search_reindex(&id, &path));
    checks.set(0);
    assert!(
        db.bulk_write_search_snapshots(&[(id.clone(), rows)], &["wrong".to_string()], &|| {
            checks.set(checks.get() + 1);
            checks.get() > 2
        })
        .is_err()
    );
    assert_eq!(before, db.search_content_row_count().unwrap());
    assert!(!db.needs_search_reindex(&id, &path));
    // A normal write after rollback proves FTS triggers were restored.
    db.upsert_search_content(&id, &[]).unwrap();
    assert_eq!(db.search_content_row_count().unwrap(), 0);
}

#[test]
fn rebuild_preserves_last_good_search_when_the_source_fails() {
    let temp = tempfile::tempdir().unwrap();
    let path = write_session_with_tools(temp.path(), ID, "org/repo", "2026-03-10T07:15:00Z");
    let db_path = temp.path().join("index.db");
    let db = IndexDb::open_or_create(&db_path).unwrap();
    db.upsert_session(&path).unwrap();
    assert_eq!(
        crate::rebuild_search_content(temp.path(), &db_path, |_| {}, || false)
            .unwrap()
            .0,
        1
    );
    let count = db.search_content_row_count().unwrap();
    assert!(count > 0);
    std::fs::write(path.join("events.jsonl"), [0xff]).unwrap();
    assert_eq!(
        crate::rebuild_search_content(temp.path(), &db_path, |_| {}, || false)
            .unwrap()
            .0,
        0
    );
    assert_eq!(db.search_content_row_count().unwrap(), count);
    assert!(db.needs_search_reindex(&SessionId::from_validated(ID), &path));
}
