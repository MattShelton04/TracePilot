//! Local SQLite index database with FTS5.

use anyhow::{Context, Result};
use rusqlite::{Connection, params, params_from_iter, types::ToSql};
use std::collections::HashSet;
use std::path::Path;

const MIGRATION_1: &str = r#"
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    summary TEXT,
    repository TEXT,
    branch TEXT,
    cwd TEXT,
    created_at TEXT,
    updated_at TEXT,
    event_count INTEGER,
    indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
    id, summary, repository, branch,
    content='sessions',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
    INSERT INTO sessions_fts(rowid, id, summary, repository, branch)
    VALUES (new.rowid, new.id, new.summary, new.repository, new.branch);
END;

CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
    INSERT INTO sessions_fts(sessions_fts, rowid, id, summary, repository, branch)
    VALUES ('delete', old.rowid, old.id, old.summary, old.repository, old.branch);
    INSERT INTO sessions_fts(rowid, id, summary, repository, branch)
    VALUES (new.rowid, new.id, new.summary, new.repository, new.branch);
END;

CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
    INSERT INTO sessions_fts(sessions_fts, rowid, id, summary, repository, branch)
    VALUES ('delete', old.rowid, old.id, old.summary, old.repository, old.branch);
END;
"#;

const MIGRATION_2: &str = r#"
ALTER TABLE sessions ADD COLUMN host_type TEXT;
ALTER TABLE sessions ADD COLUMN turn_count INTEGER;
ALTER TABLE sessions ADD COLUMN has_plan INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN has_checkpoints INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN checkpoint_count INTEGER;
ALTER TABLE sessions ADD COLUMN shutdown_type TEXT;
ALTER TABLE sessions ADD COLUMN current_model TEXT;
ALTER TABLE sessions ADD COLUMN total_premium_requests REAL;
ALTER TABLE sessions ADD COLUMN total_api_duration_ms INTEGER;
ALTER TABLE sessions ADD COLUMN workspace_mtime TEXT;

CREATE VIRTUAL TABLE IF NOT EXISTS conversation_fts USING fts5(
    session_id,
    content
);
"#;

pub struct IndexDb {
    conn: Connection,
}

#[derive(Debug, Clone)]
pub struct IndexedSession {
    pub id: String,
    pub path: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub cwd: Option<String>,
    pub host_type: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub event_count: Option<i64>,
    pub turn_count: Option<i64>,
    pub current_model: Option<String>,
}

impl IndexDb {
    /// Open or create the index database, running migrations as needed.
    pub fn open_or_create(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create dir: {}", parent.display()))?;
        }

        let conn = Connection::open(path)
            .with_context(|| format!("Failed to open index db: {}", path.display()))?;
        run_migrations(&conn)?;
        Ok(Self { conn })
    }

    /// Insert or update a session in the index.
    pub fn upsert_session(&self, session_path: &Path) -> Result<()> {
        let summary = tracepilot_core::summary::load_session_summary(session_path)
            .with_context(|| format!("Failed to load session summary: {}", session_path.display()))?;
        let session_id = summary.id.clone();
        let shutdown_type = summary
            .shutdown_metrics
            .as_ref()
            .and_then(|m| m.shutdown_type.clone());
        let current_model = summary
            .shutdown_metrics
            .as_ref()
            .and_then(|m| m.current_model.clone());
        let total_premium_requests = summary
            .shutdown_metrics
            .as_ref()
            .and_then(|m| m.total_premium_requests);
        let total_api_duration_ms = summary
            .shutdown_metrics
            .as_ref()
            .and_then(|m| m.total_api_duration_ms.map(|v| v as i64));
        let workspace_mtime = get_workspace_mtime(session_path);

        self.conn.execute(
            "INSERT INTO sessions (
                id, path, summary, repository, branch, cwd, host_type,
                created_at, updated_at, event_count, turn_count,
                has_plan, has_checkpoints, checkpoint_count,
                shutdown_type, current_model, total_premium_requests, total_api_duration_ms,
                workspace_mtime, indexed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
                path=excluded.path, summary=excluded.summary, repository=excluded.repository,
                branch=excluded.branch, cwd=excluded.cwd, host_type=excluded.host_type,
                created_at=excluded.created_at, updated_at=excluded.updated_at,
                event_count=excluded.event_count, turn_count=excluded.turn_count,
                has_plan=excluded.has_plan, has_checkpoints=excluded.has_checkpoints,
                checkpoint_count=excluded.checkpoint_count, shutdown_type=excluded.shutdown_type,
                current_model=excluded.current_model, total_premium_requests=excluded.total_premium_requests,
                total_api_duration_ms=excluded.total_api_duration_ms, workspace_mtime=excluded.workspace_mtime,
                indexed_at=excluded.indexed_at",
            params![
                summary.id,
                session_path.to_string_lossy().to_string(),
                summary.summary,
                summary.repository,
                summary.branch,
                summary.cwd,
                summary.host_type,
                summary.created_at.map(|d| d.to_rfc3339()),
                summary.updated_at.map(|d| d.to_rfc3339()),
                summary.event_count.map(|c| c as i64),
                summary.turn_count.map(|c| c as i64),
                summary.has_plan as i32,
                summary.has_checkpoints as i32,
                summary.checkpoint_count.map(|c| c as i64),
                shutdown_type,
                current_model,
                total_premium_requests,
                total_api_duration_ms,
                workspace_mtime,
            ],
        )?;

        self.index_conversation_content(session_path, &session_id)?;
        Ok(())
    }

    /// Determine whether the session should be re-indexed based on workspace.yaml mtime.
    pub fn needs_reindex(&self, session_id: &str, session_path: &Path) -> bool {
        let current_mtime = get_workspace_mtime(session_path);
        let stored_mtime: Option<String> = self
            .conn
            .query_row(
                "SELECT workspace_mtime FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .ok()
            .flatten();

        stored_mtime.as_deref() != current_mtime.as_deref()
    }

    /// Full-text search across session metadata and conversation content.
    pub fn search(&self, query: &str) -> Result<Vec<String>> {
        let mut results = HashSet::new();

        let mut stmt = self
            .conn
            .prepare("SELECT id FROM sessions_fts WHERE sessions_fts MATCH ?1")?;
        let ids = stmt.query_map([query], |row| row.get::<_, String>(0))?;
        for id in ids.flatten() {
            results.insert(id);
        }

        let mut stmt = self
            .conn
            .prepare("SELECT session_id FROM conversation_fts WHERE conversation_fts MATCH ?1")?;
        let ids = stmt.query_map([query], |row| row.get::<_, String>(0))?;
        for id in ids.flatten() {
            results.insert(id);
        }

        Ok(results.into_iter().collect())
    }

    /// List indexed sessions with optional filters.
    pub fn list_sessions(
        &self,
        limit: Option<usize>,
        filter_repo: Option<&str>,
        filter_branch: Option<&str>,
    ) -> Result<Vec<IndexedSession>> {
        let mut sql = String::from(
            "SELECT id, path, summary, repository, branch, cwd, host_type, created_at, updated_at, event_count, turn_count, current_model FROM sessions WHERE 1=1",
        );
        let mut query_params: Vec<Box<dyn ToSql>> = Vec::new();

        if let Some(repo) = filter_repo {
            sql.push_str(" AND repository = ?");
            query_params.push(Box::new(repo.to_string()));
        }
        if let Some(branch) = filter_branch {
            sql.push_str(" AND branch = ?");
            query_params.push(Box::new(branch.to_string()));
        }

        sql.push_str(" ORDER BY updated_at DESC");
        if let Some(limit) = limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let refs: Vec<&dyn ToSql> = query_params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_from_iter(refs), |row| {
            Ok(IndexedSession {
                id: row.get(0)?,
                path: row.get(1)?,
                summary: row.get(2)?,
                repository: row.get(3)?,
                branch: row.get(4)?,
                cwd: row.get(5)?,
                host_type: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                event_count: row.get(9)?,
                turn_count: row.get(10)?,
                current_model: row.get(11)?,
            })
        })?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(sessions)
    }

    /// Return the total number of indexed sessions (fast `SELECT COUNT(*)`).
    pub fn session_count(&self) -> Result<usize> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))?;
        Ok(count as usize)
    }

    /// Return the set of all session IDs currently in the index.
    pub fn all_indexed_ids(&self) -> Result<HashSet<String>> {
        let mut stmt = self.conn.prepare("SELECT id FROM sessions")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut ids = HashSet::new();
        for row in rows {
            ids.insert(row?);
        }
        Ok(ids)
    }

    /// Remove sessions from the index whose IDs are not in the given set of live IDs.
    pub fn prune_deleted(&self, live_ids: &HashSet<String>) -> Result<usize> {
        let indexed_ids = self.all_indexed_ids()?;
        let stale: Vec<&String> = indexed_ids.iter().filter(|id| !live_ids.contains(*id)).collect();
        let count = stale.len();
        for id in &stale {
            self.conn.execute("DELETE FROM sessions WHERE id = ?1", [id.as_str()])?;
            self.conn.execute("DELETE FROM conversation_fts WHERE session_id = ?1", [id.as_str()])?;
        }
        Ok(count)
    }

    fn index_conversation_content(&self, session_path: &Path, session_id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM conversation_fts WHERE session_id = ?1", [session_id])?;

        let events_path = session_path.join("events.jsonl");
        if !events_path.exists() {
            return Ok(());
        }

        let typed_events = tracepilot_core::parsing::events::parse_typed_events(&events_path)
            .with_context(|| format!("Failed to parse typed events: {}", events_path.display()))?;

        let mut content_parts: Vec<String> = Vec::new();
        for event in &typed_events {
            match &event.typed_data {
                tracepilot_core::parsing::events::TypedEventData::UserMessage(d) => {
                    if let Some(content) = &d.content {
                        content_parts.push(content.clone());
                    }
                }
                tracepilot_core::parsing::events::TypedEventData::AssistantMessage(d) => {
                    if let Some(content) = &d.content {
                        content_parts.push(content.clone());
                    }
                }
                _ => {}
            }
        }

        if !content_parts.is_empty() {
            let combined = content_parts.join("\n");
            let truncated = truncate_utf8(&combined, 100_000);
            self.conn.execute(
                "INSERT INTO conversation_fts (session_id, content) VALUES (?1, ?2)",
                params![session_id, truncated],
            )?;
        }

        Ok(())
    }
}

fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
        [],
    )?;

    let current_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let migrations: &[(&str, &str)] = &[
        ("Migration 1: base schema", MIGRATION_1),
        ("Migration 2: enriched schema", MIGRATION_2),
    ];

    for (i, (name, sql)) in migrations.iter().enumerate() {
        let version = (i + 1) as i64;
        if version > current_version {
            tracing::info!(version, name, "Running migration");
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.execute("INSERT INTO schema_version (version) VALUES (?1)", [version])?;
            tx.commit()?;
        }
    }

    Ok(())
}

fn get_workspace_mtime(session_path: &Path) -> Option<String> {
    let ws_path = session_path.join("workspace.yaml");
    std::fs::metadata(&ws_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let dt: chrono::DateTime<chrono::Utc> = t.into();
            dt.to_rfc3339()
        })
}

fn truncate_utf8(input: &str, max_bytes: usize) -> &str {
    if input.len() <= max_bytes {
        return input;
    }
    let mut end = max_bytes;
    while !input.is_char_boundary(end) {
        end -= 1;
    }
    &input[..end]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, thread, time::Duration};

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
        assert_eq!(v1, 2);
        assert_eq!(count1, 2);
        drop(db1);

        let db2 = IndexDb::open_or_create(&db_path).unwrap();
        let count2: i64 = db2
            .conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count2, 2);
    }

    #[test]
    fn test_upsert_and_search_metadata_and_conversation() {
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

        let metadata_hits = db.search("login").unwrap();
        assert!(metadata_hits.contains(&"11111111-1111-1111-1111-111111111111".to_string()));

        let conversation_hits = db.search("tracing").unwrap();
        assert!(conversation_hits.contains(&"11111111-1111-1111-1111-111111111111".to_string()));
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

        let repo_filtered = db.list_sessions(None, Some("org/repo-a"), None).unwrap();
        assert_eq!(repo_filtered.len(), 1);
        assert_eq!(repo_filtered[0].id, "33333333-3333-3333-3333-333333333333");

        let branch_filtered = db.list_sessions(None, None, Some("dev")).unwrap();
        assert_eq!(branch_filtered.len(), 1);
        assert_eq!(branch_filtered[0].id, "44444444-4444-4444-4444-444444444444");

        let limited = db.list_sessions(Some(1), None, None).unwrap();
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

        let remaining = db.list_sessions(None, None, None).unwrap();
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
}
