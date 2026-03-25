//! Local SQLite index database with FTS5 and incremental analytics.
//!
//! Decomposed into focused sub-modules:
//! - `types` — All public/private structs and constants
//! - `migrations` — Schema migrations (MIGRATION_1–5) and runner
//! - `helpers` — SQL filter builders, day-query functions, duration stats
//! - `session_writer` — Upsert, reindex detection, pruning, and pure analytics extraction
//! - `session_reader` — Read-only session queries (list, search, count, etc.)
//! - `analytics_queries` — Aggregate analytics, tool analysis, code impact queries

mod analytics_queries;
mod helpers;
mod migrations;
pub mod search_reader;
pub mod search_writer;
mod session_reader;
mod session_writer;
mod types;

use crate::{error::IndexerError, Result};
use rusqlite::{Connection, OpenFlags};
use std::path::Path;

// Re-export public types used by callers (lib.rs, tauri-bindings)
pub use types::{IndexedIncident, IndexedSession, SessionIndexInfo};
pub use search_reader::{SearchFacets, SearchFilters, SearchResult, SearchStats};
pub use search_writer::CURRENT_EXTRACTOR_VERSION;

use migrations::run_migrations;

pub struct IndexDb {
    pub(crate) conn: Connection,
}

impl IndexDb {
    /// Open or create the index database, running migrations as needed.
    pub fn open_or_create(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)
            .map_err(|e| IndexerError::database_open(path.display(), e))?;

        // Performance and correctness pragmas
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;
             PRAGMA busy_timeout=5000;",
        )
        .map_err(|e| IndexerError::database_config("Failed to set database pragmas", e))?;

        run_migrations(&conn)?;
        Ok(Self { conn })
    }

    /// Open the index database in read-only mode (no WAL/SHM side-effects).
    ///
    /// Use for all read operations (search, facets, analytics, listing).
    /// Skips migrations and won't create the DB if it doesn't exist.
    pub fn open_readonly(path: &Path) -> Result<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|e| IndexerError::database_open(format!("{} (readonly)", path.display()), e))?;

        conn.execute_batch("PRAGMA busy_timeout=5000;")
            .map_err(|e| IndexerError::database_config("Failed to set readonly pragmas", e))?;

        Ok(Self { conn })
    }

    /// Begin a deferred transaction for batch operations.
    pub fn begin_transaction(&self) -> Result<()> {
        self.conn.execute_batch("BEGIN DEFERRED")?;
        Ok(())
    }

    /// Commit the current transaction.
    pub fn commit_transaction(&self) -> Result<()> {
        self.conn.execute_batch("COMMIT")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::path::Path;
    use std::{fs, thread, time::Duration};

    use super::helpers::compute_duration_stats;

    fn write_session(
        root: &Path,
        session_id: &str,
        summary: &str,
        repo: &str,
        branch: &str,
        user_message: &str,
        assistant_message: &str,
    ) -> std::path::PathBuf {
        let session_dir = root.join(session_id);
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(
            session_dir.join("workspace.yaml"),
            format!(
                r#"id: {session_id}
summary: "{summary}"
repository: "{repo}"
branch: "{branch}"
cwd: 'C:\test\{session_id}'
host_type: cli
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#
            ),
        )
        .unwrap();
        fs::write(
            session_dir.join("events.jsonl"),
            format!(
                "{{\"type\":\"user.message\",\"data\":{{\"content\":\"{}\",\"interactionId\":\"int-1\"}},\"id\":\"evt-1\",\"timestamp\":\"2026-03-10T07:14:51.000Z\",\"parentId\":null}}\n\
                 {{\"type\":\"assistant.message\",\"data\":{{\"messageId\":\"msg-1\",\"content\":\"{}\",\"interactionId\":\"int-1\"}},\"id\":\"evt-2\",\"timestamp\":\"2026-03-10T07:14:52.000Z\",\"parentId\":\"evt-1\"}}\n",
                user_message, assistant_message
            ),
        )
        .unwrap();
        session_dir
    }

    #[test]
    fn test_migrations_run_once() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("index.db");

        let db1 = IndexDb::open_or_create(&db_path).unwrap();
        let v1: i64 = db1
            .conn
            .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |r| {
                r.get(0)
            })
            .unwrap();
        let count1: i64 = db1
            .conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v1, 7);
        assert_eq!(count1, 7);
        drop(db1);

        let db2 = IndexDb::open_or_create(&db_path).unwrap();
        let count2: i64 = db2
            .conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count2, 7);
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

        let repo_filtered = db.list_sessions(None, Some("org/repo-a"), None, false).unwrap();
        assert_eq!(repo_filtered.len(), 1);
        assert_eq!(repo_filtered[0].id, "33333333-3333-3333-3333-333333333333");

        let branch_filtered = db.list_sessions(None, None, Some("dev"), false).unwrap();
        assert_eq!(branch_filtered.len(), 1);
        assert_eq!(branch_filtered[0].id, "44444444-4444-4444-4444-444444444444");

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
        live_ids.insert("55555555-5555-5555-5555-555555555555".to_string());

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
        live_ids.insert("77777777-7777-7777-7777-777777777777".to_string());

        let pruned = db.prune_deleted(&live_ids).unwrap();
        assert_eq!(pruned, 0);
        assert_eq!(db.session_count().unwrap(), 1);
    }

    /// Write a session with tool execution events for analytics testing.
    fn write_session_with_tools(
        root: &Path,
        session_id: &str,
        repo: &str,
        updated_at: &str,
    ) -> std::path::PathBuf {
        let session_dir = root.join(session_id);
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(
            session_dir.join("workspace.yaml"),
            format!(
                r#"id: {session_id}
summary: "Session with tools"
repository: "{repo}"
branch: "main"
cwd: 'C:\test\{session_id}'
host_type: cli
created_at: "2026-03-10T07:14:50Z"
updated_at: "{updated_at}"
"#
            ),
        )
        .unwrap();
        // Events with tool.execution_start → tool.execution_complete pairs
        fs::write(
            session_dir.join("events.jsonl"),
            concat!(
                r#"{"type":"user.message","data":{"content":"please read the file","interactionId":"int-1"},"id":"evt-1","timestamp":"2026-03-10T07:14:51.000Z","parentId":null}"#, "\n",
                r#"{"type":"assistant.message","data":{"messageId":"msg-1","content":"I'll read it","interactionId":"int-1"},"id":"evt-2","timestamp":"2026-03-10T07:14:52.000Z","parentId":"evt-1"}"#, "\n",
                r#"{"type":"tool.execution_start","data":{"toolCallId":"tc-1","toolName":"read_file","arguments":{"path":"/test/foo.rs"}},"id":"evt-3","timestamp":"2026-03-10T07:14:53.000Z","parentId":"evt-2"}"#, "\n",
                r#"{"type":"tool.execution_complete","data":{"toolCallId":"tc-1","success":true,"output":"file contents"},"id":"evt-4","timestamp":"2026-03-10T07:14:54.000Z","parentId":"evt-3"}"#, "\n",
                r#"{"type":"tool.execution_start","data":{"toolCallId":"tc-2","toolName":"edit_file","arguments":{"path":"/test/bar.rs"}},"id":"evt-5","timestamp":"2026-03-10T07:14:55.000Z","parentId":"evt-2"}"#, "\n",
                r#"{"type":"tool.execution_complete","data":{"toolCallId":"tc-2","success":false,"output":"permission denied"},"id":"evt-6","timestamp":"2026-03-10T07:14:56.000Z","parentId":"evt-5"}"#, "\n",
            ),
        )
        .unwrap();
        session_dir
    }

    #[test]
    fn test_query_analytics_basic() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

        let s1 = write_session_with_tools(
            tmp.path(),
            "a1111111-1111-1111-1111-111111111111",
            "org/repo-a",
            "2026-03-10T07:15:00Z",
        );
        let s2 = write_session_with_tools(
            tmp.path(),
            "b2222222-2222-2222-2222-222222222222",
            "org/repo-b",
            "2026-03-11T09:00:00Z",
        );
        db.upsert_session(&s1).unwrap();
        db.upsert_session(&s2).unwrap();

        let result = db.query_analytics(None, None, None, false).unwrap();
        assert_eq!(result.total_sessions, 2);
        assert!(result.sessions_per_day.len() >= 1);
    }

    #[test]
    fn test_query_analytics_repo_filter() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

        let s1 = write_session_with_tools(
            tmp.path(),
            "c3333333-3333-3333-3333-333333333333",
            "org/repo-a",
            "2026-03-10T07:15:00Z",
        );
        let s2 = write_session_with_tools(
            tmp.path(),
            "d4444444-4444-4444-4444-444444444444",
            "org/repo-b",
            "2026-03-11T09:00:00Z",
        );
        db.upsert_session(&s1).unwrap();
        db.upsert_session(&s2).unwrap();

        let filtered = db.query_analytics(None, None, Some("org/repo-a"), false).unwrap();
        assert_eq!(filtered.total_sessions, 1);

        let all = db.query_analytics(None, None, None, false).unwrap();
        assert_eq!(all.total_sessions, 2);
    }

    #[test]
    fn test_query_tool_analysis_aggregates_tool_calls() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

        let s = write_session_with_tools(
            tmp.path(),
            "e5555555-5555-5555-5555-555555555555",
            "org/repo",
            "2026-03-10T07:15:00Z",
        );
        db.upsert_session(&s).unwrap();

        let result = db.query_tool_analysis(None, None, None, false).unwrap();
        assert_eq!(result.total_calls, 2, "should count 2 tool calls");
        assert!(result.tools.len() >= 2, "should have read_file and edit_file entries");

        let read = result.tools.iter().find(|t| t.name == "read_file");
        assert!(read.is_some(), "should have read_file entry");
        assert_eq!(read.unwrap().call_count, 1);
        assert_eq!(read.unwrap().success_rate, 1.0);

        let edit = result.tools.iter().find(|t| t.name == "edit_file");
        assert!(edit.is_some(), "should have edit_file entry");
        assert_eq!(edit.unwrap().call_count, 1);
        assert_eq!(edit.unwrap().success_rate, 0.0); // failed
    }

    #[test]
    fn test_query_code_impact_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

        // No sessions → zero impact
        let result = db.query_code_impact(None, None, None, false).unwrap();
        assert_eq!(result.files_modified, 0);
        assert_eq!(result.lines_added, 0);
        assert_eq!(result.lines_removed, 0);
    }

    #[test]
    fn test_needs_reindex_events_mtime_change() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
        let session_id = "f6666666-6666-6666-6666-666666666666";
        let session_dir = write_session_with_tools(
            tmp.path(),
            session_id,
            "org/repo",
            "2026-03-10T07:15:00Z",
        );

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

        assert!(db.needs_reindex(session_id, &session_dir), "should detect events.jsonl change");
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
    fn test_query_analytics_date_filtering() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

        let s1 = write_session_with_tools(
            tmp.path(),
            "date-aaa-1111-1111-1111-111111111111",
            "org/repo",
            "2026-03-10T07:15:00Z",
        );
        let s2 = write_session_with_tools(
            tmp.path(),
            "date-bbb-2222-2222-2222-222222222222",
            "org/repo",
            "2026-03-20T09:00:00Z",
        );
        db.upsert_session(&s1).unwrap();
        db.upsert_session(&s2).unwrap();

        // Only sessions from/after March 15
        let after = db.query_analytics(Some("2026-03-15"), None, None, false).unwrap();
        assert_eq!(after.total_sessions, 1);

        // Only sessions before March 15
        let before = db.query_analytics(None, Some("2026-03-15"), None, false).unwrap();
        assert_eq!(before.total_sessions, 1);

        // All sessions in range
        let all = db.query_analytics(Some("2026-03-01"), Some("2026-03-31"), None, false).unwrap();
        assert_eq!(all.total_sessions, 2);
    }

    #[test]
    fn test_compute_duration_stats() {
        // Empty
        let empty = compute_duration_stats(&[]);
        assert_eq!(empty.total_sessions_with_duration, 0);
        assert_eq!(empty.avg_ms, 0.0);

        // Single value
        let single = compute_duration_stats(&[5000]);
        assert_eq!(single.total_sessions_with_duration, 1);
        assert_eq!(single.avg_ms, 5000.0);
        assert_eq!(single.median_ms, 5000.0);
        assert_eq!(single.min_ms, 5000);
        assert_eq!(single.max_ms, 5000);

        // Multiple values — sorted: [1000, 2000, 3000, 4000, 10000]
        let multi = compute_duration_stats(&[3000, 1000, 10000, 2000, 4000]);
        assert_eq!(multi.total_sessions_with_duration, 5);
        assert_eq!(multi.avg_ms, 4000.0);
        assert_eq!(multi.median_ms, 3000.0);
        assert_eq!(multi.min_ms, 1000);
        assert_eq!(multi.max_ms, 10000);
    }

    #[test]
    fn test_cascade_deletes_child_tables() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();

        let session_id = "cascade-1111-1111-1111-111111111111";
        let session_dir = write_session_with_tools(
            tmp.path(),
            session_id,
            "org/repo",
            "2026-03-10T07:15:00Z",
        );
        db.upsert_session(&session_dir).unwrap();

        // Verify child rows exist
        let tool_count: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        ).unwrap();
        assert!(tool_count > 0, "should have tool call rows after upsert");

        // Prune the session
        let live_ids = HashSet::new(); // empty = everything is stale
        db.prune_deleted(&live_ids).unwrap();

        // Verify cascade deleted child rows
        let tool_count_after: i64 = db.conn.query_row(
            "SELECT COUNT(*) FROM session_tool_calls WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(tool_count_after, 0, "child rows should cascade delete");
    }

    /// Write a session with incident-generating events (errors, compaction, truncation).
    fn write_session_with_incidents(root: &Path, session_id: &str) -> std::path::PathBuf {
        let session_dir = root.join(session_id);
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(
            session_dir.join("workspace.yaml"),
            format!(
                r#"id: {session_id}
summary: "Session with incidents"
repository: "org/repo"
branch: "main"
cwd: 'C:\test\{session_id}'
host_type: cli
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#
            ),
        )
        .unwrap();
        fs::write(
            session_dir.join("events.jsonl"),
            concat!(
                r#"{"type":"user.message","data":{"content":"hello","interactionId":"int-1"},"id":"evt-1","timestamp":"2026-03-10T07:14:51.000Z","parentId":null}"#, "\n",
                r#"{"type":"session.error","data":{"errorType":"rate_limit","message":"Rate limit exceeded","statusCode":429},"id":"evt-2","timestamp":"2026-03-10T07:14:52.000Z","parentId":null}"#, "\n",
                r#"{"type":"session.error","data":{"errorType":"api_error","message":"Internal server error","statusCode":500},"id":"evt-3","timestamp":"2026-03-10T07:14:53.000Z","parentId":null}"#, "\n",
                r#"{"type":"session.compaction_complete","data":{"preCompactionTokens":50000,"success":true,"checkpointNumber":1,"compactionTokensUsed":{"input":2000,"output":1000}},"id":"evt-4","timestamp":"2026-03-10T07:14:54.000Z","parentId":null}"#, "\n",
                r#"{"type":"session.truncation","data":{"tokensRemovedDuringTruncation":5000,"messagesRemovedDuringTruncation":3,"performedBy":"BasicTruncator","tokenLimit":100000},"id":"evt-5","timestamp":"2026-03-10T07:14:55.000Z","parentId":null}"#, "\n",
                r#"{"type":"assistant.message","data":{"messageId":"msg-1","content":"hi","interactionId":"int-1"},"id":"evt-6","timestamp":"2026-03-10T07:14:56.000Z","parentId":"evt-1"}"#, "\n",
            ),
        )
        .unwrap();
        session_dir
    }

    #[test]
    fn test_incident_indexing_and_retrieval() {
        let tmp = tempfile::tempdir().unwrap();
        let db = IndexDb::open_or_create(&tmp.path().join("index.db")).unwrap();
        let session_dir = write_session_with_incidents(
            tmp.path(),
            "aaaa1111-1111-1111-1111-111111111111",
        );

        db.upsert_session(&session_dir).unwrap();

        // Verify aggregate counts on the session row
        let sessions = db.list_sessions(None, None, None, false).unwrap();
        assert_eq!(sessions.len(), 1);
        let s = &sessions[0];
        assert_eq!(s.error_count, Some(2), "should count 2 errors");
        assert_eq!(s.rate_limit_count, Some(1), "should count 1 rate limit");
        assert_eq!(s.compaction_count, Some(1), "should count 1 compaction");
        assert_eq!(s.truncation_count, Some(1), "should count 1 truncation");

        // Verify individual incident rows
        let incidents = db
            .get_session_incidents("aaaa1111-1111-1111-1111-111111111111")
            .unwrap();
        assert_eq!(incidents.len(), 4, "should have 4 incident rows");

        // First incident: rate limit error
        assert_eq!(incidents[0].event_type, "error");
        assert_eq!(incidents[0].source_event_type, "session.error");
        assert_eq!(incidents[0].severity, "error"); // rate limits are errors
        assert_eq!(incidents[0].summary, "Rate limit hit");

        // Second incident: API error
        assert_eq!(incidents[1].event_type, "error");
        assert_eq!(incidents[1].severity, "error");

        // Third incident: compaction
        assert_eq!(incidents[2].event_type, "compaction");
        assert_eq!(incidents[2].source_event_type, "session.compaction_complete");
        assert_eq!(incidents[2].severity, "info"); // successful compaction
        assert!(incidents[2].summary.contains("succeeded"));

        // Fourth incident: truncation
        assert_eq!(incidents[3].event_type, "truncation");
        assert_eq!(incidents[3].severity, "warning");
        assert!(incidents[3].summary.contains("5000 tokens"));

        // Verify analytics aggregation includes incident data
        let analytics = db.query_analytics(None, None, None, false).unwrap();
        assert_eq!(analytics.sessions_with_errors, 1);
        assert_eq!(analytics.total_rate_limits, 1);
        assert_eq!(analytics.total_compactions, 1);
        assert_eq!(analytics.total_truncations, 1);
    }
}
