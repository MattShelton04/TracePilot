//! Session CRUD tests: migrations, upsert, search metadata, reindex detection,
//! listing, pruning, path lookup, and cascade deletes.

use super::common::{write_session, write_session_with_tools};
use crate::index_db::IndexDb;
use std::collections::HashSet;
use std::{fs, thread, time::Duration};

#[test]
fn test_migrations_run_once() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("index.db");

    let db1 = IndexDb::open_or_create(&db_path).unwrap();
    let v1: i64 = db1
        .conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let count1: i64 = db1
        .conn
        .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(v1, 11);
    assert_eq!(count1, 11);
    drop(db1);

    let db2 = IndexDb::open_or_create(&db_path).unwrap();
    let count2: i64 = db2
        .conn
        .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count2, 11);
}

#[test]
fn test_upsert_and_search_metadata() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session_dir = write_session(
        tmp.path(),
        "11111111-1111-1111-1111-111111111111",
        "Implement login flow",
        "org/repo",
        "main",
        "please add tracing spans",
        "added tracing spans and tests",
    );

    db.upsert_session(&session_dir).unwrap();

    // sessions_fts searches metadata (summary, repo, branch)
    let metadata_hits = db.search("login").unwrap();
    assert!(metadata_hits.contains(&"11111111-1111-1111-1111-111111111111".to_string()));

    // Conversation content is now in search_content (Phase 2), not sessions_fts
    let no_hit = db.search("tracing").unwrap();
    assert!(
        !no_hit.contains(&"11111111-1111-1111-1111-111111111111".to_string()),
        "sessions_fts should not contain conversation content"
    );
}

#[test]
fn test_search_sessions_returns_ordered_full_rows() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let s1 = write_session_with_tools(
        tmp.path(),
        "a1111111-1111-1111-1111-111111111111",
        "org/repo-a",
        "2026-03-11T09:00:00Z",
    );
    let s2 = write_session_with_tools(
        tmp.path(),
        "b2222222-2222-2222-2222-222222222222",
        "org/repo-b",
        "2026-03-11T09:00:00Z",
    );
    let s3 = write_session_with_tools(
        tmp.path(),
        "c3333333-3333-3333-3333-333333333333",
        "org/repo-c",
        "2026-03-10T09:00:00Z",
    );
    db.upsert_session(&s1).unwrap();
    db.upsert_session(&s2).unwrap();
    db.upsert_session(&s3).unwrap();

    let rows = db.search_sessions("Session").unwrap();
    let ids: Vec<&str> = rows.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "a1111111-1111-1111-1111-111111111111",
            "b2222222-2222-2222-2222-222222222222",
            "c3333333-3333-3333-3333-333333333333",
        ]
    );

    let first = &rows[0];
    assert!(first.path.ends_with("a1111111-1111-1111-1111-111111111111"));
    assert_eq!(first.repository.as_deref(), Some("org/repo-a"));
    assert_eq!(first.summary.as_deref(), Some("Session with tools"));
    assert_eq!(first.current_model.as_deref(), Some("claude-opus-4.6"));
    assert_eq!(first.event_count, Some(7));
    assert_eq!(first.turn_count, Some(1));
}

#[test]
fn test_search_sessions_no_matches_returns_empty() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let s1 = write_session_with_tools(
        tmp.path(),
        "d4444444-4444-4444-4444-444444444444",
        "org/repo",
        "2026-03-10T07:15:00Z",
    );
    db.upsert_session(&s1).unwrap();

    let rows = db.search_sessions("zzzznomatchneedle").unwrap();
    assert!(rows.is_empty());
}

#[test]
fn test_needs_reindex_uses_workspace_mtime() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session_id = "22222222-2222-2222-2222-222222222222";
    let session_dir = write_session(
        tmp.path(),
        session_id,
        "Session for mtime check",
        "org/repo",
        "main",
        "first",
        "second",
    );

    db.upsert_session(&session_dir).unwrap();
    assert!(!db.needs_reindex(session_id, &session_dir));

    thread::sleep(Duration::from_millis(1100));
    fs::write(
        session_dir.join("workspace.yaml"),
        format!(
            r#"id: {session_id}
summary: "Session for mtime check"
repository: "org/repo"
branch: "main"
updated_at: "2026-03-11T07:15:00Z"
"#
        ),
    )
    .unwrap();

    assert!(db.needs_reindex(session_id, &session_dir));
}

#[test]
fn test_list_sessions_with_filters() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let s1 = write_session(
        tmp.path(),
        "33333333-3333-3333-3333-333333333333",
        "Repo A main",
        "org/repo-a",
        "main",
        "user one",
        "assistant one",
    );
    let s2 = write_session(
        tmp.path(),
        "44444444-4444-4444-4444-444444444444",
        "Repo B dev",
        "org/repo-b",
        "dev",
        "user two",
        "assistant two",
    );
    db.upsert_session(&s1).unwrap();
    db.upsert_session(&s2).unwrap();

    let repo_filtered = db
        .list_sessions(None, Some("org/repo-a"), None, false)
        .unwrap();
    assert_eq!(repo_filtered.len(), 1);
    assert_eq!(repo_filtered[0].id, "33333333-3333-3333-3333-333333333333");

    let branch_filtered = db.list_sessions(None, None, Some("dev"), false).unwrap();
    assert_eq!(branch_filtered.len(), 1);
    assert_eq!(
        branch_filtered[0].id,
        "44444444-4444-4444-4444-444444444444"
    );

    let limited = db.list_sessions(Some(1), None, None, false).unwrap();
    assert_eq!(limited.len(), 1);
}

#[test]
fn test_prune_deleted_removes_stale_sessions() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let s1 = write_session(
        tmp.path(),
        "55555555-5555-5555-5555-555555555555",
        "Session to keep",
        "org/repo",
        "main",
        "keep user msg",
        "keep assistant msg",
    );
    let s2 = write_session(
        tmp.path(),
        "66666666-6666-6666-6666-666666666666",
        "Session to delete",
        "org/repo",
        "main",
        "delete user msg",
        "delete assistant msg",
    );
    db.upsert_session(&s1).unwrap();
    db.upsert_session(&s2).unwrap();

    assert_eq!(db.session_count().unwrap(), 2);

    // Only s1 is "live" — s2 should be pruned
    let mut live_ids = HashSet::new();
    live_ids.insert("55555555-5555-5555-5555-555555555555");

    let pruned = db.prune_deleted(&live_ids).unwrap();
    assert_eq!(pruned, 1);
    assert_eq!(db.session_count().unwrap(), 1);

    let remaining = db.list_sessions(None, None, None, false).unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, "55555555-5555-5555-5555-555555555555");

    // FTS should also be cleaned — searching for deleted content returns nothing
    let hits = db.search("delete").unwrap();
    assert!(!hits.contains(&"66666666-6666-6666-6666-666666666666".to_string()));
}

#[test]
fn test_prune_deleted_with_all_live() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let s1 = write_session(
        tmp.path(),
        "77777777-7777-7777-7777-777777777777",
        "Session one",
        "org/repo",
        "main",
        "msg one",
        "reply one",
    );
    db.upsert_session(&s1).unwrap();

    let mut live_ids = HashSet::new();
    live_ids.insert("77777777-7777-7777-7777-777777777777");

    let pruned = db.prune_deleted(&live_ids).unwrap();
    assert_eq!(pruned, 0);
    assert_eq!(db.session_count().unwrap(), 1);
}

#[test]
fn test_needs_reindex_events_mtime_change() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session_id = "f6666666-6666-6666-6666-666666666666";
    let session_dir =
        write_session_with_tools(tmp.path(), session_id, "org/repo", "2026-03-10T07:15:00Z");

    db.upsert_session(&session_dir).unwrap();
    assert!(!db.needs_reindex(session_id, &session_dir));

    // Simulate a resumed session: append to events.jsonl
    thread::sleep(Duration::from_millis(1100));
    let events_path = session_dir.join("events.jsonl");
    let mut events = fs::read_to_string(&events_path).unwrap();
    events.push_str(
        r#"{"type":"user.message","data":{"content":"resumed msg","interactionId":"int-2"},"id":"evt-99","timestamp":"2026-03-11T10:00:00.000Z","parentId":null}"#,
    );
    events.push('\n');
    fs::write(&events_path, events).unwrap();

    assert!(
        db.needs_reindex(session_id, &session_dir),
        "should detect events.jsonl change"
    );
}

#[test]
fn test_needs_reindex_analytics_version_bump() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session_id = "aabbccdd-0000-0000-0000-000000000000";
    let session_dir = write_session(
        tmp.path(),
        session_id,
        "version test",
        "org/repo",
        "main",
        "hello",
        "world",
    );
    db.upsert_session(&session_dir).unwrap();
    assert!(!db.needs_reindex(session_id, &session_dir));

    // Manually set analytics_version to 0 → should trigger reindex
    db.conn
        .execute(
            "UPDATE sessions SET analytics_version = 0 WHERE id = ?1",
            [session_id],
        )
        .unwrap();
    assert!(
        db.needs_reindex(session_id, &session_dir),
        "should detect stale analytics_version"
    );
}

#[test]
fn test_get_session_path() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
    let session_id = "aabbccdd-1111-1111-1111-111111111111";
    let session_dir = write_session(
        tmp.path(),
        session_id,
        "path test",
        "org/repo",
        "main",
        "msg",
        "reply",
    );
    db.upsert_session(&session_dir).unwrap();

    let path = db.get_session_path(session_id).unwrap();
    assert!(path.is_some());
    assert_eq!(path.unwrap(), session_dir);

    let missing = db.get_session_path("nonexistent").unwrap();
    assert!(missing.is_none());
}

#[test]
fn test_cascade_deletes_child_tables() {
    let tmp = tempfile::tempdir().unwrap();
    let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

    let session_id = "cascade-1111-1111-1111-111111111111";
    let session_dir =
        write_session_with_tools(tmp.path(), session_id, "org/repo", "2026-03-10T07:15:00Z");
    db.upsert_session(&session_dir).unwrap();

    // Verify child rows exist
    let tool_count: i64 = db
        .conn
        .query_row(
            "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(tool_count > 0, "should have tool call rows after upsert");

    // Prune the session
    let live_ids = HashSet::new(); // empty = everything is stale
    db.prune_deleted(&live_ids).unwrap();

    // Verify cascade deleted child rows
    let tool_count_after: i64 = db
        .conn
        .query_row(
            "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tool_count_after, 0, "child rows should cascade delete");
}
