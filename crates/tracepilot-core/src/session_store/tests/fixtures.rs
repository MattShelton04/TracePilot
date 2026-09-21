//! A synthetic session store, built from the observed schema shape.
//!
//! The DDL below mirrors the source's *shape* — column names, affinities and
//! nullability — not anyone's data. Tests that need an older CLI drop columns;
//! tests that need a newer one add them.

use std::path::PathBuf;

use rusqlite::Connection;
use tempfile::TempDir;

use crate::session_store::SourceBinding;

/// Column definitions for `assistant_usage_events` in the current shape.
/// Note the timing columns are declared `INTEGER` while the source stores
/// `REAL` in them, which is exactly the trap the value layer exists for.
pub const USAGE_DDL_COLUMNS: &[(&str, &str)] = &[
    ("id", "INTEGER PRIMARY KEY AUTOINCREMENT"),
    ("session_id", "TEXT NOT NULL"),
    ("turn_index", "INTEGER"),
    ("agent_id", "TEXT"),
    ("parent_tool_call_id", "TEXT"),
    ("model", "TEXT NOT NULL"),
    ("input_tokens", "INTEGER"),
    ("output_tokens", "INTEGER"),
    ("cache_read_tokens", "INTEGER"),
    ("cache_write_tokens", "INTEGER"),
    ("reasoning_tokens", "INTEGER"),
    ("total_nano_aiu", "INTEGER"),
    ("request_multiplier", "REAL"),
    ("duration_ms", "INTEGER"),
    ("time_to_first_token_ms", "INTEGER"),
    ("output_ttft_ms", "INTEGER"),
    ("inter_token_latency_ms", "INTEGER"),
    ("initiator", "TEXT"),
    ("api_endpoint", "TEXT"),
    ("reasoning_effort", "TEXT"),
    ("finish_reason", "TEXT"),
    ("content_filter_triggered", "INTEGER"),
    ("token_details_json", "TEXT"),
    ("created_at", "TEXT DEFAULT (datetime('now'))"),
    ("copilot_usage_model", "TEXT"),
];

/// One request row, expressed as SQL literals so a test can write a REAL into
/// an INTEGER column, a negative count, or a malformed JSON payload.
pub struct UsageRow {
    pub session_id: String,
    /// `(column, sql literal)` overrides applied on top of the defaults.
    pub values: Vec<(&'static str, String)>,
}

impl UsageRow {
    pub fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            values: Vec::new(),
        }
    }

    pub fn set(mut self, column: &'static str, literal: impl Into<String>) -> Self {
        self.values.push((column, literal.into()));
        self
    }

    fn literal_for(&self, column: &str) -> String {
        if column == "session_id" {
            return sql_text(&self.session_id);
        }
        self.values
            .iter()
            .find(|(name, _)| *name == column)
            .map(|(_, literal)| literal.clone())
            .unwrap_or_else(|| default_literal(column))
    }
}

fn default_literal(column: &str) -> String {
    match column {
        "model" => sql_text("gpt-5.6-luna"),
        "turn_index" => "0".to_string(),
        "input_tokens" => "1000".to_string(),
        "output_tokens" => "200".to_string(),
        "cache_read_tokens" => "800".to_string(),
        "cache_write_tokens" => "0".to_string(),
        "reasoning_tokens" => "50".to_string(),
        "total_nano_aiu" => "1000000".to_string(),
        "request_multiplier" => "1.0".to_string(),
        "duration_ms" => "4000".to_string(),
        "created_at" => sql_text("2026-09-20T10:00:00.000Z"),
        _ => "NULL".to_string(),
    }
}

pub fn sql_text(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// A temporary Copilot home containing a session store.
pub struct StoreFixture {
    pub dir: TempDir,
    pub db_path: PathBuf,
}

impl StoreFixture {
    /// Build a store whose `assistant_usage_events` has only `columns`.
    /// Passing every name in [`USAGE_DDL_COLUMNS`] gives the current shape.
    pub fn with_usage_columns(columns: &[&str]) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("session-store.db");
        let conn = Connection::open(&db_path).unwrap();
        let usage_ddl = USAGE_DDL_COLUMNS
            .iter()
            .filter(|(name, _)| columns.contains(name))
            .map(|(name, kind)| format!("\"{name}\" {kind}"))
            .collect::<Vec<_>>()
            .join(", ");
        conn.execute_batch(&format!(
            "CREATE TABLE sessions (
                 id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, host_type TEXT,
                 branch TEXT, summary TEXT, created_at TEXT, updated_at TEXT
             );
             CREATE TABLE assistant_usage_events ({usage_ddl});
             CREATE TABLE session_refs (
                 id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
                 ref_type TEXT NOT NULL, ref_value TEXT NOT NULL,
                 turn_index INTEGER, created_at TEXT
             );
             CREATE TABLE schema_version (version INTEGER);
             INSERT INTO schema_version (version) VALUES (8);"
        ))
        .unwrap();
        drop(conn);
        Self { dir, db_path }
    }

    /// The current schema shape.
    pub fn current() -> Self {
        let columns: Vec<&str> = USAGE_DDL_COLUMNS.iter().map(|(name, _)| *name).collect();
        Self::with_usage_columns(&columns)
    }

    pub fn binding(&self) -> SourceBinding {
        SourceBinding {
            db_path: self.db_path.clone(),
            copilot_home: self.dir.path().to_path_buf(),
            session_state_dir: self.dir.path().join("session-state"),
            source_id: "fixture".to_string(),
        }
    }

    fn open(&self) -> Connection {
        Connection::open(&self.db_path).unwrap()
    }

    pub fn insert_session(&self, session_id: &str, repository: Option<&str>) {
        let conn = self.open();
        conn.execute(
            "INSERT INTO sessions (id, repository) VALUES (?1, ?2)",
            rusqlite::params![session_id, repository],
        )
        .unwrap();
    }

    pub fn insert_usage(&self, row: &UsageRow) {
        let conn = self.open();
        let present = self.usage_columns(&conn);
        let columns: Vec<&str> = USAGE_DDL_COLUMNS
            .iter()
            .map(|(name, _)| *name)
            .filter(|name| *name != "id" && present.contains(&name.to_string()))
            .collect();
        let literals = columns
            .iter()
            .map(|column| row.literal_for(column))
            .collect::<Vec<_>>()
            .join(", ");
        let names = columns
            .iter()
            .map(|column| format!("\"{column}\""))
            .collect::<Vec<_>>()
            .join(", ");
        conn.execute_batch(&format!(
            "INSERT INTO assistant_usage_events ({names}) VALUES ({literals});"
        ))
        .unwrap();
    }

    pub fn insert_ref(&self, session_id: &str, ref_type: &str, ref_value: &str) {
        let conn = self.open();
        conn.execute(
            "INSERT INTO session_refs (session_id, ref_type, ref_value) VALUES (?1, ?2, ?3)",
            rusqlite::params![session_id, ref_type, ref_value],
        )
        .unwrap();
    }

    fn usage_columns(&self, conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("PRAGMA table_info('assistant_usage_events')")
            .unwrap();
        let rows = stmt.query_map([], |row| row.get::<_, String>(1)).unwrap();
        rows.map(|name| name.unwrap()).collect()
    }
}
