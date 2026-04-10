//! SQL schema definitions for the task database.

/// Schema version for migrations.
pub const SCHEMA_VERSION: i32 = 2;

/// Initial schema DDL.
pub const SCHEMA_V1: &str = "
-- Task metadata (singleton configuration table)
CREATE TABLE IF NOT EXISTS task_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Jobs group related tasks into a single batch.
CREATE TABLE IF NOT EXISTS jobs (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    preset_id               TEXT,
    status                  TEXT NOT NULL DEFAULT 'pending',
    task_count              INTEGER NOT NULL DEFAULT 0,
    tasks_completed         INTEGER NOT NULL DEFAULT 0,
    tasks_failed            INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at            TEXT,
    orchestrator_session_id TEXT
);

-- Individual tasks.
CREATE TABLE IF NOT EXISTS tasks (
    id                      TEXT PRIMARY KEY,
    job_id                  TEXT REFERENCES jobs(id) ON DELETE SET NULL,
    task_type               TEXT NOT NULL,
    preset_id               TEXT NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'pending',
    priority                TEXT NOT NULL DEFAULT 'normal',
    input_params            TEXT NOT NULL DEFAULT '{}',
    context_hash            TEXT,
    attempt_count           INTEGER NOT NULL DEFAULT 0,
    max_retries             INTEGER NOT NULL DEFAULT 3,
    orchestrator_session_id TEXT,
    result_summary          TEXT,
    result_parsed           TEXT,
    schema_valid            INTEGER,
    error_message           TEXT,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at            TEXT
);

-- Deduplication: only one active (non-terminal) task per context_hash.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedup
    ON tasks (context_hash)
    WHERE status IN ('pending', 'claimed', 'in_progress');

-- Fast status filtering.
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);

-- Fast job membership lookup.
CREATE INDEX IF NOT EXISTS idx_tasks_job_id ON tasks (job_id);

-- Fast preset lookup.
CREATE INDEX IF NOT EXISTS idx_tasks_preset_id ON tasks (preset_id);

-- Task dependency edges (for future DAG support).
CREATE TABLE IF NOT EXISTS task_deps (
    task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, depends_on)
);

-- Updated-at trigger
CREATE TRIGGER IF NOT EXISTS trg_tasks_updated_at
    AFTER UPDATE ON tasks
    FOR EACH ROW
BEGIN
    UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;
";

/// Migration from schema v1 → v2: add claimed_at and started_at timestamps.
/// Uses IF NOT EXISTS pattern via subqueries to be idempotent (safe to re-run).
pub fn migrate_v1_to_v2(conn: &rusqlite::Connection) -> std::result::Result<(), rusqlite::Error> {
    // Check which columns already exist
    let has_column = |col: &str| -> bool {
        conn.prepare("SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name = ?1")
            .and_then(|mut stmt| stmt.query_row(rusqlite::params![col], |row| row.get::<_, i32>(0)))
            .unwrap_or(0)
            > 0
    };

    if !has_column("claimed_at") {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN claimed_at TEXT;")?;
    }
    if !has_column("started_at") {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN started_at TEXT;")?;
    }
    Ok(())
}
