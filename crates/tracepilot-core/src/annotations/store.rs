//! SQLite storage for [`SessionAnnotation`]s (`annotations.db`).

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

use super::{SessionAnnotation, SessionAnnotationPatch};
use crate::error::{Result, TracePilotError};
use crate::utils::migrator::{Migration, MigrationPlan, MigratorOptions, run_migrations};

static MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "session annotations",
    sql: "CREATE TABLE session_annotations (
              session_id TEXT PRIMARY KEY NOT NULL,
              starred INTEGER NOT NULL DEFAULT 0,
              archived INTEGER NOT NULL DEFAULT 0,
              note TEXT,
              updated_at TEXT NOT NULL
          );
          CREATE TABLE session_tags (
              session_id TEXT NOT NULL
                  REFERENCES session_annotations(session_id) ON DELETE CASCADE,
              tag TEXT NOT NULL,
              PRIMARY KEY (session_id, tag)
          ) WITHOUT ROWID;
          CREATE INDEX idx_session_tags_tag ON session_tags(tag);",
    pre_hook: None,
}];

static PLAN: MigrationPlan = MigrationPlan {
    migrations: MIGRATIONS,
};

/// A read-write handle on `annotations.db`.
pub struct AnnotationStore {
    conn: Connection,
}

impl AnnotationStore {
    /// Open the store, creating the file and schema on first use.
    pub fn open_or_create(path: &Path) -> Result<Self> {
        crate::utils::fs::ensure_parent_dir(path)?;
        // Snapshot before migrating an existing store; a new one has nothing to lose.
        let existed = path.exists();
        let mut conn = Connection::open(path)?;
        crate::utils::sqlite::configure_connection(&conn)?;
        let opts = MigratorOptions {
            backup: existed,
            ..MigratorOptions::default()
        };
        run_migrations(&mut conn, Some(path), &PLAN, &opts).map_err(|e| {
            TracePilotError::ParseError {
                context: format!("Failed to migrate annotations database: {}", path.display()),
                source: Some(Box::new(e)),
            }
        })?;
        Ok(Self { conn })
    }

    /// An in-memory store, for tests.
    pub fn open_in_memory() -> Result<Self> {
        let mut conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        run_migrations(&mut conn, None, &PLAN, &MigratorOptions::default()).map_err(|e| {
            TracePilotError::ParseError {
                context: "Failed to migrate in-memory annotations database".to_string(),
                source: Some(Box::new(e)),
            }
        })?;
        Ok(Self { conn })
    }

    /// Every annotated session, in no particular order.
    pub fn list(&self) -> Result<Vec<SessionAnnotation>> {
        read_all(&self.conn)
    }

    /// One session's annotation, or an empty one if it has none.
    pub fn get(&self, session_id: &str) -> Result<SessionAnnotation> {
        read_one(&self.conn, session_id)
    }

    /// Apply a normalized patch and return the session's new annotation.
    /// An annotation that ends up recording nothing is removed.
    pub fn update(
        &mut self,
        session_id: &str,
        patch: &SessionAnnotationPatch,
    ) -> Result<SessionAnnotation> {
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let current = read_one(&tx, session_id)?;
        let mut next = patch.apply(&current);
        if next == current {
            return Ok(current);
        }

        if next.is_empty() {
            tx.execute(
                "DELETE FROM session_annotations WHERE session_id = ?1",
                [session_id],
            )?;
            next.updated_at = None;
        } else {
            let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            tx.execute(
                "INSERT INTO session_annotations (session_id, starred, archived, note, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(session_id) DO UPDATE SET
                     starred = excluded.starred,
                     archived = excluded.archived,
                     note = excluded.note,
                     updated_at = excluded.updated_at",
                params![session_id, next.starred, next.archived, next.note, now],
            )?;
            if patch.tags.is_some() {
                tx.execute(
                    "DELETE FROM session_tags WHERE session_id = ?1",
                    [session_id],
                )?;
                let mut insert =
                    tx.prepare("INSERT INTO session_tags (session_id, tag) VALUES (?1, ?2)")?;
                for tag in &next.tags {
                    insert.execute(params![session_id, tag])?;
                }
            }
            next.updated_at = Some(now);
        }
        tx.commit()?;
        Ok(next)
    }
}

/// Every annotation in the store at `path`; empty when the store was never
/// created. Opens read-only so listing never creates the file.
pub fn list_annotations_if_exists(path: &Path) -> Result<Vec<SessionAnnotation>> {
    match crate::utils::sqlite::open_readonly_if_exists(path)? {
        Some(conn) => {
            conn.execute_batch("PRAGMA busy_timeout=5000;")?;
            // A store whose first migration never finished has no tables yet.
            if !crate::utils::sqlite::table_exists(&conn, "session_annotations") {
                return Ok(Vec::new());
            }
            read_all(&conn)
        }
        None => Ok(Vec::new()),
    }
}

fn read_all(conn: &Connection) -> Result<Vec<SessionAnnotation>> {
    let mut tags: HashMap<String, Vec<String>> = HashMap::new();
    let mut stmt = conn.prepare("SELECT session_id, tag FROM session_tags")?;
    let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get(1)?)))?;
    for row in rows {
        let (id, tag) = row?;
        tags.entry(id).or_default().push(tag);
    }

    let mut stmt = conn.prepare(
        "SELECT session_id, starred, archived, note, updated_at FROM session_annotations",
    )?;
    let rows = stmt.query_map([], row_to_annotation)?;
    let mut out = Vec::new();
    for row in rows {
        let mut annotation = row?;
        annotation.tags = sorted(tags.remove(&annotation.session_id).unwrap_or_default());
        out.push(annotation);
    }
    Ok(out)
}

fn read_one(conn: &Connection, session_id: &str) -> Result<SessionAnnotation> {
    let found = conn
        .query_row(
            "SELECT session_id, starred, archived, note, updated_at
             FROM session_annotations WHERE session_id = ?1",
            [session_id],
            row_to_annotation,
        )
        .optional()?;
    let Some(mut annotation) = found else {
        return Ok(SessionAnnotation::empty(session_id));
    };
    let mut stmt = conn.prepare("SELECT tag FROM session_tags WHERE session_id = ?1")?;
    let tags = stmt
        .query_map([session_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    annotation.tags = sorted(tags);
    Ok(annotation)
}

fn row_to_annotation(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionAnnotation> {
    Ok(SessionAnnotation {
        session_id: row.get(0)?,
        starred: row.get(1)?,
        archived: row.get(2)?,
        tags: Vec::new(),
        note: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn sorted(mut tags: Vec<String>) -> Vec<String> {
    tags.sort_by_key(|t| t.to_lowercase());
    tags
}
