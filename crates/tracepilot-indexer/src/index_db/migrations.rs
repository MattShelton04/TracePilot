//! Schema migrations for the index database.

use anyhow::Result;
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
-- Cached raw events for fast session detail queries.
-- Avoids re-parsing events.jsonl on every detail/events/turns request.
CREATE TABLE IF NOT EXISTS session_events (
    session_id TEXT NOT NULL,
    event_index INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_id TEXT,
    timestamp TEXT,
    parent_id TEXT,
    data_json TEXT NOT NULL,
    PRIMARY KEY (session_id, event_index),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_events_type
    ON session_events(session_id, event_type);

-- Cached pre-reconstructed conversation turns as JSON blobs.
CREATE TABLE IF NOT EXISTS session_turns (
    session_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    turn_json TEXT NOT NULL,
    PRIMARY KEY (session_id, turn_index),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Byte-offset checkpoint for incremental JSONL parsing.
ALTER TABLE sessions ADD COLUMN events_byte_offset INTEGER DEFAULT 0;
-- Cached line count for fast total_count without COUNT(*).
ALTER TABLE sessions ADD COLUMN events_line_count INTEGER DEFAULT 0;
-- Serialized ShutdownData JSON for get_shutdown_metrics fast path.
ALTER TABLE sessions ADD COLUMN shutdown_data_json TEXT;
"#;

pub(super) const MIGRATION_7: &str = r#"
-- v2: Lean event metadata cache (replaces v1 heavy blob cache).
-- Drop the large data_json-containing table and the redundant turns table.
DROP TABLE IF EXISTS session_turns;
DROP TABLE IF EXISTS session_events;

-- Recreate session_events with metadata only + byte offsets for surgical reads.
CREATE TABLE IF NOT EXISTS session_events (
    session_id TEXT NOT NULL,
    event_index INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    event_id TEXT,
    timestamp TEXT,
    parent_id TEXT,
    byte_offset INTEGER NOT NULL,
    line_length INTEGER NOT NULL,
    tool_call_id TEXT,
    PRIMARY KEY (session_id, event_index),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_events_type
    ON session_events(session_id, event_type);
CREATE INDEX IF NOT EXISTS idx_session_events_tool_call
    ON session_events(session_id, tool_call_id)
    WHERE tool_call_id IS NOT NULL;

-- Cache presence flag (byte_offset=0 is ambiguous for empty files).
ALTER TABLE sessions ADD COLUMN events_cached INTEGER DEFAULT 0;

-- Reset all cache markers so reindex repopulates with the lean schema.
UPDATE sessions SET events_byte_offset = 0, events_line_count = 0, events_cached = 0;
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
        ("Migration 6: event cache + checkpointing", MIGRATION_6),
        ("Migration 7: lean event cache v2", MIGRATION_7),
    ];

    for (i, (name, sql)) in migrations.iter().enumerate() {
        let version = (i + 1) as i64;
        if version > current_version {
            tracing::info!(version, name, "Running migration");
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.execute("INSERT INTO schema_version (version) VALUES (?1)", [version])?;
            tx.commit()?;

            // Migration 7 drops ~1 GB of blob data; VACUUM to reclaim disk space.
            // VACUUM cannot run inside a transaction, so we run it post-commit.
            if version == 7 {
                tracing::info!("Running VACUUM after migration 7 to reclaim disk space");
                let _ = conn.execute_batch("VACUUM");
            }
        }
    }

    Ok(())
}
