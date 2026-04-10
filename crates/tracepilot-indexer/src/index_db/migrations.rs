//! Schema migrations for the index database.

use crate::Result;
use rusqlite::Connection;

pub(super) const MIGRATION_1: &str = r#"
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

pub(super) const MIGRATION_2: &str = r#"
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

pub(super) const MIGRATION_3: &str = r#"
-- Per-session analytics columns
ALTER TABLE sessions ADD COLUMN total_tokens INTEGER;
ALTER TABLE sessions ADD COLUMN total_cost REAL;
ALTER TABLE sessions ADD COLUMN tool_call_count INTEGER;
ALTER TABLE sessions ADD COLUMN lines_added INTEGER;
ALTER TABLE sessions ADD COLUMN lines_removed INTEGER;
ALTER TABLE sessions ADD COLUMN duration_ms INTEGER;
ALTER TABLE sessions ADD COLUMN health_score REAL;
ALTER TABLE sessions ADD COLUMN events_mtime TEXT;
ALTER TABLE sessions ADD COLUMN events_size INTEGER;
ALTER TABLE sessions ADD COLUMN analytics_version INTEGER DEFAULT 1;

-- Per-session model metrics (normalized, not JSON blob)
CREATE TABLE IF NOT EXISTS session_model_metrics (
    session_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cache_read_tokens INTEGER DEFAULT 0,
    cache_write_tokens INTEGER DEFAULT 0,
    cost REAL DEFAULT 0,
    request_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, model_name),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Per-session tool call stats
CREATE TABLE IF NOT EXISTS session_tool_calls (
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    call_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, tool_name),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Per-session modified files for code impact
CREATE TABLE IF NOT EXISTS session_modified_files (
    session_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    extension TEXT,
    PRIMARY KEY (session_id, file_path),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Per-session activity heatmap data
CREATE TABLE IF NOT EXISTS session_activity (
    session_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,
    hour INTEGER NOT NULL,
    tool_call_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, day_of_week, hour),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_repository ON sessions(repository);
CREATE INDEX IF NOT EXISTS idx_sessions_repo_updated ON sessions(repository, updated_at);
"#;

pub(super) const MIGRATION_4: &str = r#"
-- Add calls_with_duration for accurate duration averaging
ALTER TABLE session_tool_calls ADD COLUMN calls_with_duration INTEGER DEFAULT 0;
"#;

pub(super) const MIGRATION_5: &str = r#"
-- Session-level incident counters for fast list/analytics queries
ALTER TABLE sessions ADD COLUMN error_count INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN rate_limit_count INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN warning_count INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN compaction_count INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN truncation_count INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_error_type TEXT;
ALTER TABLE sessions ADD COLUMN last_error_message TEXT;
ALTER TABLE sessions ADD COLUMN total_compaction_input_tokens INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN total_compaction_output_tokens INTEGER DEFAULT 0;

-- Detailed per-incident log for drill-down
CREATE TABLE IF NOT EXISTS session_incidents (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    source_event_type TEXT NOT NULL,
    timestamp TEXT,
    severity TEXT,
    summary TEXT,
    detail_json TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_incidents_session ON session_incidents(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_session_incidents_type ON session_incidents(event_type);
"#;

pub(super) const MIGRATION_6: &str = r#"
-- ═══ Drop old FTS tables and triggers ═══
DROP TRIGGER IF EXISTS sessions_ai;
DROP TRIGGER IF EXISTS sessions_au;
DROP TRIGGER IF EXISTS sessions_ad;
DROP TABLE IF EXISTS sessions_fts;
DROP TABLE IF EXISTS conversation_fts;

-- ═══ Deep search content table: one row per searchable chunk ═══
CREATE TABLE IF NOT EXISTS search_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK(content_type IN (
        'user_message', 'assistant_message', 'reasoning',
        'tool_call', 'tool_error', 'error',
        'compaction_summary', 'system_message', 'subagent', 'checkpoint'
    )),
    turn_number INTEGER,
    event_index INTEGER,
    timestamp_unix INTEGER,
    tool_name TEXT,
    content TEXT NOT NULL,
    metadata_json TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_content_session ON search_content(session_id);
CREATE INDEX IF NOT EXISTS idx_search_content_timestamp ON search_content(timestamp_unix);

-- ═══ FTS5 virtual table (content-sync with search_content) ═══
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
    content,
    content='search_content',
    content_rowid='id',
    tokenize='unicode61'
);

-- Sync triggers: keep search_fts in lockstep with search_content
CREATE TRIGGER IF NOT EXISTS search_content_ai AFTER INSERT ON search_content BEGIN
    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS search_content_au AFTER UPDATE ON search_content BEGIN
    INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER IF NOT EXISTS search_content_ad AFTER DELETE ON search_content BEGIN
    INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

-- ═══ Lightweight session-level FTS (for toolbar quick search) ═══
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
    id, summary, repository, branch,
    content='sessions',
    content_rowid='rowid',
    tokenize='unicode61'
);

-- Back-populate sessions_fts from existing sessions
INSERT INTO sessions_fts(rowid, id, summary, repository, branch)
    SELECT rowid, id, summary, repository, branch FROM sessions;

-- Sync triggers for sessions_fts
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

pub(super) const MIGRATION_7: &str = r#"
-- ═══ Browse mode indexes for filter-only queries ═══
CREATE INDEX IF NOT EXISTS idx_search_content_tool ON search_content(tool_name);
CREATE INDEX IF NOT EXISTS idx_search_content_type_ts ON search_content(content_type, timestamp_unix);
"#;

pub(super) const MIGRATION_8: &str = r#"
-- Store session segments for granular temporal metric attribution
CREATE TABLE IF NOT EXISTS session_segments (
    session_id TEXT NOT NULL,
    start_timestamp TEXT NOT NULL,
    end_timestamp TEXT NOT NULL,
    total_tokens INTEGER DEFAULT 0,
    total_requests INTEGER DEFAULT 0,
    total_premium_requests REAL DEFAULT 0.0,
    total_api_duration_ms INTEGER DEFAULT 0,
    current_model TEXT,
    model_metrics_json TEXT,
    PRIMARY KEY (session_id, end_timestamp),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
"#;

pub(super) const MIGRATION_9: &str = r#"
-- ═══ Recreate search_content with tool_result and quality guard ═══
DROP TRIGGER IF EXISTS search_content_ai;
DROP TRIGGER IF EXISTS search_content_au;
DROP TRIGGER IF EXISTS search_content_ad;
DROP TABLE IF EXISTS search_fts;
DROP TABLE IF EXISTS search_content;

CREATE TABLE search_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    content_type TEXT NOT NULL CHECK(content_type IN (
        'user_message', 'assistant_message', 'reasoning',
        'tool_call', 'tool_result', 'tool_error', 'error',
        'compaction_summary', 'system_message', 'subagent', 'checkpoint'
    )),
    turn_number INTEGER,
    event_index INTEGER,
    timestamp_unix INTEGER,
    tool_name TEXT,
    content TEXT NOT NULL CHECK(length(trim(content)) > 0),
    metadata_json TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Indexes (timestamp, tool, type+ts, composite session+ts+type, session+event for context)
CREATE INDEX idx_search_content_timestamp ON search_content(timestamp_unix);
CREATE INDEX idx_search_content_tool ON search_content(tool_name);
CREATE INDEX idx_search_content_type_ts ON search_content(content_type, timestamp_unix);
CREATE INDEX idx_search_content_session_ts_type ON search_content(session_id, timestamp_unix, content_type);
CREATE INDEX idx_search_content_session_event ON search_content(session_id, event_index);

-- FTS5 virtual table (content-sync with search_content)
CREATE VIRTUAL TABLE search_fts USING fts5(
    content,
    content='search_content',
    content_rowid='id',
    tokenize='unicode61'
);

-- Sync triggers
CREATE TRIGGER search_content_ai AFTER INSERT ON search_content BEGIN
    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER search_content_au AFTER UPDATE ON search_content BEGIN
    INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO search_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER search_content_ad AFTER DELETE ON search_content BEGIN
    INSERT INTO search_fts(search_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;

-- Drop redundant index (prefix of composite)
DROP INDEX IF EXISTS idx_search_content_session;

-- Enable FTS5 automerge
INSERT INTO search_fts(search_fts, rank) VALUES('automerge', 8);

-- Reset search indexing to force re-extraction with new schema
UPDATE sessions SET search_indexed_at = NULL, search_extractor_version = 0;
"#;

pub(super) const MIGRATION_10: &str = r#"
-- Maintenance state: stores timestamps for throttled maintenance operations.
CREATE TABLE IF NOT EXISTS maintenance_state (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"#;

/// Run all pending schema migrations in order.
pub(super) fn run_migrations(conn: &Connection) -> Result<()> {
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
        ("Migration 3: analytics schema", MIGRATION_3),
        ("Migration 4: tool duration tracking", MIGRATION_4),
        ("Migration 5: incident tracking", MIGRATION_5),
        ("Migration 6: deep FTS search", MIGRATION_6),
        ("Migration 7: browse indexes", MIGRATION_7),
        ("Migration 8: daily metric tracking", MIGRATION_8),
        (
            "Migration 9: tool_result, content_fts, quality guard",
            MIGRATION_9,
        ),
        ("Migration 10: maintenance state", MIGRATION_10),
    ];

    for (i, (name, sql)) in migrations.iter().enumerate() {
        let version = (i + 1) as i64;
        if version > current_version {
            // Ensure search columns exist before migrations that reference them
            if version >= 9 {
                add_column_if_missing(conn, "sessions", "search_indexed_at", "TEXT")?;
                add_column_if_missing(
                    conn,
                    "sessions",
                    "search_extractor_version",
                    "INTEGER DEFAULT 0",
                )?;
            }
            tracing::info!(version, name, "Running migration");
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO schema_version (version) VALUES (?1)",
                [version],
            )?;
            tx.commit()?;
        }
    }

    // Idempotent ALTER TABLE additions for Migration 6 columns.
    // Always run (not gated on current_version) so that partial failures
    // where version 6 committed but columns weren't added are recovered.
    // add_column_if_missing is safe to call repeatedly — it checks PRAGMA table_info.
    add_column_if_missing(conn, "sessions", "search_indexed_at", "TEXT")?;
    add_column_if_missing(
        conn,
        "sessions",
        "search_extractor_version",
        "INTEGER DEFAULT 0",
    )?;

    Ok(())
}

/// Add a column to a table only if it doesn't already exist.
fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    col_type: &str,
) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let has_column = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .any(|r| r.as_deref() == Ok(column));
    if !has_column {
        conn.execute_batch(&format!(
            "ALTER TABLE {} ADD COLUMN {} {}",
            table, column, col_type
        ))?;
    }
    Ok(())
}
