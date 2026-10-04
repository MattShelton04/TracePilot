//! Read-only access to per-request usage in Copilot CLI's `session-store.db`.
//!
//! Copilot CLI writes one `assistant_usage_events` row per model request:
//! model, reasoning effort, tokens, duration and the recorded charge. The
//! matching `assistant.usage` session event is ephemeral, so for finished
//! sessions this table is the only local per-request record. See
//! `docs/research/copilot-session-store-db.md`.
//!
//! The store belongs to the CLI, which writes it live in WAL mode:
//!
//! - Connections are read-only and `query_only`, with a short busy timeout.
//!   A failed read means "no request data", never an error for the caller.
//! - Columns are probed, not inferred from `schema_version`; only
//!   `session_id` and `model` are required.
//! - A session reads the store of the Copilot home it lives in
//!   (`<home>/session-state/<id>` → `<home>/session-store.db`), so a session
//!   stored anywhere else never picks up another machine's telemetry.

use std::cell::RefCell;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use chrono::{DateTime, NaiveDateTime, Utc};
use rusqlite::{Connection, OpenFlags};

const STORE_FILE: &str = "session-store.db";
const SESSION_STATE_DIR: &str = "session-state";
const USAGE_TABLE: &str = "assistant_usage_events";
const BUSY_TIMEOUT: Duration = Duration::from_millis(250);
/// How long an idle per-thread connection is reused before reopening.
const CONNECTION_MAX_AGE: Duration = Duration::from_secs(30);

/// One model request recorded by Copilot CLI.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RequestUsage {
    pub created_at: Option<DateTime<Utc>>,
    pub model: String,
    pub reasoning_effort: Option<String>,
    /// `user`, `agent`, `sub-agent` or `compaction`; absent on 1.0.69–1.0.75.
    pub initiator: Option<String>,
    /// Launching tool call when a subagent made the request.
    pub parent_tool_call_id: Option<String>,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
    pub duration_ms: u64,
    pub nano_aiu: u64,
}

impl RequestUsage {
    pub fn is_subagent(&self) -> bool {
        self.parent_tool_call_id.is_some() || self.initiator.as_deref() == Some("sub-agent")
    }

    pub fn is_compaction(&self) -> bool {
        self.initiator.as_deref() == Some("compaction")
    }
}

/// The store that records `session_dir`'s requests, if it exists.
pub fn store_for_session_dir(session_dir: &Path) -> Option<PathBuf> {
    let state_dir = session_dir.parent()?;
    let is_state_dir = state_dir
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case(SESSION_STATE_DIR));
    if !is_state_dir {
        return None;
    }
    let store = state_dir.parent()?.join(STORE_FILE);
    store.is_file().then_some(store)
}

/// Requests Copilot CLI recorded for the session in `session_dir`, oldest
/// first. `None` when there is no store, it has no usage table, or it could
/// not be read; `Some(vec![])` when it was read and has no rows.
pub fn read_request_usage(session_dir: &Path) -> Option<Vec<RequestUsage>> {
    let store = store_for_session_dir(session_dir)?;
    let session_id = session_dir.file_name()?.to_str()?;
    match with_store(&store, |reader| reader.requests(session_id)) {
        Ok(rows) => rows,
        Err(error) => {
            tracing::debug!(store = %store.display(), %error, "Copilot session store not read");
            None
        }
    }
}

struct StoreReader {
    path: PathBuf,
    opened: Instant,
    conn: Connection,
    /// Columns of the usage table, or `None` when it has no usable one.
    columns: Option<HashSet<String>>,
}

impl StoreReader {
    fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(BUSY_TIMEOUT)?;
        conn.pragma_update(None, "query_only", true)?;
        let columns = probe_columns(&conn)?;
        Ok(Self {
            path: path.to_path_buf(),
            opened: Instant::now(),
            conn,
            columns,
        })
    }

    fn requests(&self, session_id: &str) -> rusqlite::Result<Option<Vec<RequestUsage>>> {
        let Some(columns) = &self.columns else {
            return Ok(None);
        };
        let column = |name: &str| {
            if columns.contains(name) {
                format!("\"{name}\"")
            } else {
                "NULL".to_string()
            }
        };
        let order = if columns.contains("id") {
            "\"id\""
        } else {
            "rowid"
        };
        let sql = format!(
            "SELECT {}, \"model\", {}, {}, {}, {}, {}, {}, {}, {} FROM {USAGE_TABLE} \
             WHERE \"session_id\" = ?1 ORDER BY {order}",
            column("created_at"),
            column("reasoning_effort"),
            column("initiator"),
            column("parent_tool_call_id"),
            column("input_tokens"),
            column("output_tokens"),
            column("reasoning_tokens"),
            column("duration_ms"),
            column("total_nano_aiu"),
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([session_id], |row| {
            let count = |index: usize| -> rusqlite::Result<u64> {
                // Values are integers, but tolerate REAL in case a sum lands there.
                Ok(match row.get_ref(index)? {
                    rusqlite::types::ValueRef::Integer(n) => n.max(0) as u64,
                    rusqlite::types::ValueRef::Real(n) if n.is_finite() && n > 0.0 => {
                        n.round() as u64
                    }
                    _ => 0,
                })
            };
            Ok(RequestUsage {
                created_at: row
                    .get::<_, Option<String>>(0)?
                    .as_deref()
                    .and_then(parse_timestamp),
                model: row.get(1)?,
                reasoning_effort: row
                    .get::<_, Option<String>>(2)?
                    .filter(|value| !value.is_empty()),
                initiator: row.get(3)?,
                parent_tool_call_id: row
                    .get::<_, Option<String>>(4)?
                    .filter(|value| !value.is_empty()),
                input_tokens: count(5)?,
                output_tokens: count(6)?,
                reasoning_tokens: count(7)?,
                duration_ms: count(8)?,
                nano_aiu: count(9)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map(Some)
    }
}

fn probe_columns(conn: &Connection) -> rusqlite::Result<Option<HashSet<String>>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({USAGE_TABLE})"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;
    let usable = columns.contains("session_id") && columns.contains("model");
    Ok(usable.then_some(columns))
}

thread_local! {
    // Indexing reads one session per call on a pool of threads; reusing a
    // connection per thread avoids reopening the store for every session.
    static READER: RefCell<Option<StoreReader>> = const { RefCell::new(None) };
}

fn with_store<T>(
    path: &Path,
    read: impl FnOnce(&StoreReader) -> rusqlite::Result<T>,
) -> rusqlite::Result<T> {
    READER.with(|cell| {
        let mut slot = cell.borrow_mut();
        let reader = match slot.take() {
            Some(reader)
                if reader.path == path && reader.opened.elapsed() <= CONNECTION_MAX_AGE =>
            {
                reader
            }
            _ => StoreReader::open(path)?,
        };
        let result = read(&reader);
        // Keep the connection for the next read only if this one worked.
        if result.is_ok() {
            *slot = Some(reader);
        }
        result
    })
}

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|t| t.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            // SQLite's `datetime('now')` default.
            NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
                .ok()
                .map(|t| t.and_utc())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_with(schema: &str, inserts: &[&str]) -> (tempfile::TempDir, PathBuf) {
        let home = tempfile::tempdir().unwrap();
        let session_dir = home.path().join("session-state").join("s-1");
        std::fs::create_dir_all(&session_dir).unwrap();
        let conn = Connection::open(home.path().join(STORE_FILE)).unwrap();
        conn.execute_batch(schema).unwrap();
        for insert in inserts {
            conn.execute_batch(insert).unwrap();
        }
        (home, session_dir)
    }

    #[test]
    fn reads_rows_for_the_session_in_order() {
        let (_home, dir) = store_with(
            "CREATE TABLE assistant_usage_events (id INTEGER PRIMARY KEY, session_id TEXT, \
             model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, \
             reasoning_tokens INTEGER, total_nano_aiu INTEGER, duration_ms INTEGER, \
             initiator TEXT, parent_tool_call_id TEXT, reasoning_effort TEXT, created_at TEXT)",
            &[
                "INSERT INTO assistant_usage_events VALUES (1, 's-1', 'gpt-5.6-luna', 100, 40, 10, \
                 2500000, 900, 'user', NULL, 'high', '2026-10-04T08:10:12.000Z')",
                "INSERT INTO assistant_usage_events VALUES (2, 'other', 'gpt-5.6-luna', 1, 1, 1, 1, 1, \
                 'user', NULL, 'low', NULL)",
                "INSERT INTO assistant_usage_events VALUES (3, 's-1', 'gpt-5.6-luna', 50, 20, 0, \
                 1000000, 400, 'sub-agent', 'call-1', 'low', '2026-10-04 08:10:15')",
            ],
        );
        let rows = read_request_usage(&dir).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].reasoning_effort.as_deref(), Some("high"));
        assert_eq!(rows[0].nano_aiu, 2_500_000);
        assert!(!rows[0].is_subagent());
        assert!(rows[1].is_subagent());
        assert!(
            rows[1].created_at.is_some(),
            "SQLite default timestamps parse"
        );
    }

    #[test]
    fn missing_optional_columns_read_as_empty() {
        let (_home, dir) = store_with(
            "CREATE TABLE assistant_usage_events (session_id TEXT, model TEXT NOT NULL)",
            &["INSERT INTO assistant_usage_events VALUES ('s-1', 'gpt-5.6-luna')"],
        );
        let rows = read_request_usage(&dir).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].reasoning_effort, None);
        assert_eq!(rows[0].output_tokens, 0);
    }

    #[test]
    fn sessions_outside_a_copilot_home_or_without_a_store_read_nothing() {
        let (_home, dir) = store_with("CREATE TABLE unrelated (x INTEGER)", &[]);
        assert_eq!(read_request_usage(&dir), None, "no usage table");

        let elsewhere = tempfile::tempdir().unwrap();
        let imported = elsewhere.path().join("imports").join("s-1");
        std::fs::create_dir_all(&imported).unwrap();
        std::fs::write(elsewhere.path().join(STORE_FILE), b"").unwrap();
        assert_eq!(store_for_session_dir(&imported), None);
    }
}
