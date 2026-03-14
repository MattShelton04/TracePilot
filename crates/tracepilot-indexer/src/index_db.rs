//! Local SQLite index database with FTS5.

use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::Path;

use tracepilot_core::session::discovery::DiscoveredSession;

pub struct IndexDb {
    conn: Connection,
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

        conn.execute_batch(
            "
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
            ",
        )?;

        Ok(Self { conn })
    }

    /// Insert or update a session in the index.
    pub fn upsert_session(&self, session: &DiscoveredSession) -> Result<()> {
        // Read workspace.yaml if available
        let workspace_path = session.path.join("workspace.yaml");
        let (summary, repository, branch, cwd, created_at, updated_at) =
            if workspace_path.exists() {
                match tracepilot_core::parsing::workspace::parse_workspace_yaml(&workspace_path) {
                    Ok(meta) => (
                        meta.summary,
                        meta.repository,
                        meta.branch,
                        meta.cwd,
                        meta.created_at.map(|d| d.to_rfc3339()),
                        meta.updated_at.map(|d| d.to_rfc3339()),
                    ),
                    Err(_) => (None, None, None, None, None, None),
                }
            } else {
                (None, None, None, None, None, None)
            };

        self.conn.execute(
            "INSERT OR REPLACE INTO sessions (id, path, summary, repository, branch, cwd, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                session.id,
                session.path.to_string_lossy().to_string(),
                summary,
                repository,
                branch,
                cwd,
                created_at,
                updated_at,
            ],
        )?;

        Ok(())
    }

    /// Full-text search across sessions.
    pub fn search(&self, query: &str) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM sessions_fts WHERE sessions_fts MATCH ?1")?;
        let ids = stmt
            .query_map([query], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(ids)
    }
}
