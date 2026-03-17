//! Local SQLite index database with FTS5 and incremental analytics.

use anyhow::{Context, Result};
use rusqlite::{Connection, params, params_from_iter, types::ToSql};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use tracepilot_core::analytics::types::*;
use tracepilot_core::parsing::events::TypedEventData;

/// Lightweight per-session info returned after indexing a session.
/// Used to enrich progress events with live stats.
#[derive(Debug, Clone)]
pub struct SessionIndexInfo {
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub current_model: Option<String>,
    pub total_tokens: u64,
    pub event_count: usize,
    pub turn_count: usize,
}

/// Bump this when the analytics schema or extraction logic changes.
/// Sessions with a stored analytics_version below this will be re-indexed.
const CURRENT_ANALYTICS_VERSION: i64 = 2;

/// Named row for per-model metrics (replaces opaque 7-tuple).
struct ModelMetricsRow {
    model: String,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_write_tokens: i64,
    cost: f64,
    premium_requests: i64,
}

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

const MIGRATION_3: &str = r#"
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

const MIGRATION_4: &str = r#"
-- Add calls_with_duration for accurate duration averaging
ALTER TABLE session_tool_calls ADD COLUMN calls_with_duration INTEGER DEFAULT 0;
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

        // Performance and correctness pragmas
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA foreign_keys=ON;
             PRAGMA busy_timeout=5000;",
        )
        .with_context(|| "Failed to set database pragmas")?;

        run_migrations(&conn)?;
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

    /// Insert or update a session in the index, computing analytics from events.
    pub fn upsert_session(&self, session_path: &Path) -> Result<SessionIndexInfo> {
        let load_result = tracepilot_core::summary::load_session_summary_with_events(session_path)
            .with_context(|| {
                format!(
                    "Failed to load session summary: {}",
                    session_path.display()
                )
            })?;
        let summary = load_result.summary;
        let typed_events = load_result.typed_events;
        let diagnostics = load_result.diagnostics;
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

        // ── Compute analytics columns ────────────────────────────────
        let mut total_tokens: i64 = 0;
        let mut total_cost: f64 = 0.0;
        let mut lines_added: Option<i64> = None;
        let mut lines_removed: Option<i64> = None;
        let mut duration_ms: Option<i64> = None;

        // Model metrics for child table
        let mut model_rows: Vec<ModelMetricsRow> = Vec::new();

        if let Some(ref metrics) = summary.shutdown_metrics {
            // Duration from session_start_time → updated_at
            if let (Some(start_time), Some(updated)) =
                (metrics.session_start_time, summary.updated_at)
            {
                let end_ms = updated.timestamp_millis() as u64;
                if end_ms > start_time {
                    duration_ms = Some((end_ms - start_time) as i64);
                }
            }

            // Per-model metrics
            for (model_name, detail) in &metrics.model_metrics {
                let (input_t, output_t, cache_read, cache_write) =
                    if let Some(ref usage) = detail.usage {
                        (
                            usage.input_tokens.unwrap_or(0) as i64,
                            usage.output_tokens.unwrap_or(0) as i64,
                            usage.cache_read_tokens.unwrap_or(0) as i64,
                            usage.cache_write_tokens.unwrap_or(0) as i64,
                        )
                    } else {
                        (0, 0, 0, 0)
                    };
                let model_tokens = input_t + output_t + cache_read + cache_write;
                total_tokens += model_tokens;

                let cost = detail
                    .requests
                    .as_ref()
                    .and_then(|r| r.cost)
                    .unwrap_or(0.0);
                total_cost += cost;

                let req_count = detail
                    .requests
                    .as_ref()
                    .and_then(|r| r.count)
                    .unwrap_or(0) as i64;

                model_rows.push(ModelMetricsRow {
                    model: model_name.clone(),
                    input_tokens: input_t,
                    output_tokens: output_t,
                    cache_read_tokens: cache_read,
                    cache_write_tokens: cache_write,
                    cost,
                    premium_requests: req_count,
                });
            }

            // Code changes
            if let Some(ref cc) = metrics.code_changes {
                lines_added = cc.lines_added.map(|v| v as i64);
                lines_removed = cc.lines_removed.map(|v| v as i64);
            }
        }

        // Health score
        let health = tracepilot_core::health::compute_health(
            summary.event_count,
            summary.shutdown_metrics.as_ref(),
            diagnostics.as_ref(),
        );
        let health_score = health.score;

        let events_meta = get_events_mtime_and_size(session_path);
        let events_mtime = events_meta.as_ref().map(|(m, _)| m.clone());
        let events_size = events_meta.map(|(_, s)| s as i64);

        // ── Extract event-level analytics (single pass) ────────────
        let mut tool_call_rows: Vec<(String, i64, i64, i64, i64, i64)> = Vec::new();
        let mut activity_rows: Vec<(i64, i64, i64)> = Vec::new();
        let mut modified_file_rows: Vec<(String, Option<String>)> = Vec::new();
        // Stream FTS content directly into a single String to avoid Vec<String> + join
        let mut fts_content = String::with_capacity(
            typed_events.as_ref().map_or(0, |e| e.len().min(2000) * 50),
        );
        let fts_limit: usize = 100_000;
        let mut actual_tool_call_count: i64 = 0;

        if let Some(ref events) = typed_events {
            let mut tool_starts: HashMap<String, (String, Option<chrono::DateTime<chrono::Utc>>)> =
                HashMap::new();
            let mut tool_accum: HashMap<String, (i64, i64, i64, i64, i64)> = HashMap::new();
            let mut heatmap_accum: HashMap<(i64, i64), i64> = HashMap::new();

            for event in events {
                match &event.typed_data {
                    TypedEventData::UserMessage(d) => {
                        if fts_content.len() < fts_limit {
                            if let Some(content) = &d.content {
                                if !fts_content.is_empty() {
                                    fts_content.push('\n');
                                }
                                fts_content.push_str(content);
                            }
                        }
                    }
                    TypedEventData::AssistantMessage(d) => {
                        if fts_content.len() < fts_limit {
                            if let Some(content) = &d.content {
                                if !fts_content.is_empty() {
                                    fts_content.push('\n');
                                }
                                fts_content.push_str(content);
                            }
                        }
                    }
                    TypedEventData::ToolExecutionStart(d) => {
                        if let Some(ref tool_call_id) = d.tool_call_id {
                            let name = d.tool_name.clone().unwrap_or_else(|| "unknown".into());
                            tool_starts.insert(
                                tool_call_id.clone(),
                                (name, event.raw.timestamp),
                            );
                        }
                    }
                    TypedEventData::ToolExecutionComplete(d) => {
                        actual_tool_call_count += 1;
                        if let Some(ref tool_call_id) = d.tool_call_id {
                            if let Some((tool_name, start_ts)) =
                                tool_starts.remove(tool_call_id)
                            {
                                let acc = tool_accum
                                    .entry(tool_name.clone())
                                    .or_insert((0, 0, 0, 0, 0));
                                acc.0 += 1;

                                match d.success {
                                    Some(true) => acc.1 += 1,
                                    Some(false) => acc.2 += 1,
                                    None => {}
                                }

                                if let (Some(start), Some(end)) =
                                    (start_ts, event.raw.timestamp)
                                {
                                    let dur = (end - start).num_milliseconds().max(0);
                                    acc.3 += dur;
                                    acc.4 += 1;
                                }

                                if let Some(ts) = start_ts {
                                    use chrono::{Datelike, Timelike};
                                    let day =
                                        ts.weekday().num_days_from_monday() as i64;
                                    let hour = ts.hour() as i64;
                                    *heatmap_accum.entry((day, hour)).or_insert(0) += 1;
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }

            for (name, (calls, success, failure, dur, dur_count)) in &tool_accum {
                tool_call_rows.push((name.clone(), *calls, *success, *failure, *dur, *dur_count));
            }
            for ((day, hour), count) in &heatmap_accum {
                activity_rows.push((*day, *hour, *count));
            }
        }

        // Use actual tool call count from events (0 if none found)
        let final_tool_call_count = if actual_tool_call_count > 0 {
            Some(actual_tool_call_count)
        } else {
            None
        };

        // Modified files from shutdown metrics
        if let Some(ref metrics) = summary.shutdown_metrics {
            if let Some(ref cc) = metrics.code_changes {
                if let Some(ref files) = cc.files_modified {
                    for file in files {
                        let ext = std::path::Path::new(file)
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(|s| s.to_string());
                        modified_file_rows.push((file.clone(), ext));
                    }
                }
            }
        }

        // Build the lightweight info to return to callers.
        let index_info = SessionIndexInfo {
            repository: summary.repository.clone(),
            branch: summary.branch.clone(),
            current_model: summary
                .shutdown_metrics
                .as_ref()
                .and_then(|m| m.current_model.clone()),
            total_tokens: total_tokens.max(0) as u64,
            event_count: summary.event_count.unwrap_or(0),
            turn_count: summary.turn_count.unwrap_or(0),
        };

        // ── Write everything in a SAVEPOINT transaction ──────────────
        self.conn.execute_batch("SAVEPOINT upsert_session")?;

        let result = (|| -> Result<()> {
            // Delete child table rows first
            self.conn.execute(
                "DELETE FROM session_model_metrics WHERE session_id = ?1",
                [&session_id],
            )?;
            self.conn.execute(
                "DELETE FROM session_tool_calls WHERE session_id = ?1",
                [&session_id],
            )?;
            self.conn.execute(
                "DELETE FROM session_modified_files WHERE session_id = ?1",
                [&session_id],
            )?;
            self.conn.execute(
                "DELETE FROM session_activity WHERE session_id = ?1",
                [&session_id],
            )?;
            self.conn.execute(
                "DELETE FROM conversation_fts WHERE session_id = ?1",
                [&session_id],
            )?;

            // UPSERT the session row
            self.conn.execute(
                "INSERT INTO sessions (
                    id, path, summary, repository, branch, cwd, host_type,
                    created_at, updated_at, event_count, turn_count,
                    has_plan, has_checkpoints, checkpoint_count,
                    shutdown_type, current_model, total_premium_requests, total_api_duration_ms,
                    workspace_mtime,
                    total_tokens, total_cost, tool_call_count, lines_added, lines_removed,
                    duration_ms, health_score, events_mtime, events_size, analytics_version,
                    indexed_at
                ) VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                    ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29,
                    datetime('now')
                )
                ON CONFLICT(id) DO UPDATE SET
                    path=excluded.path, summary=excluded.summary, repository=excluded.repository,
                    branch=excluded.branch, cwd=excluded.cwd, host_type=excluded.host_type,
                    created_at=excluded.created_at, updated_at=excluded.updated_at,
                    event_count=excluded.event_count, turn_count=excluded.turn_count,
                    has_plan=excluded.has_plan, has_checkpoints=excluded.has_checkpoints,
                    checkpoint_count=excluded.checkpoint_count, shutdown_type=excluded.shutdown_type,
                    current_model=excluded.current_model,
                    total_premium_requests=excluded.total_premium_requests,
                    total_api_duration_ms=excluded.total_api_duration_ms,
                    workspace_mtime=excluded.workspace_mtime,
                    total_tokens=excluded.total_tokens, total_cost=excluded.total_cost,
                    tool_call_count=excluded.tool_call_count,
                    lines_added=excluded.lines_added, lines_removed=excluded.lines_removed,
                    duration_ms=excluded.duration_ms, health_score=excluded.health_score,
                    events_mtime=excluded.events_mtime, events_size=excluded.events_size,
                    analytics_version=excluded.analytics_version,
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
                    total_tokens,
                    total_cost,
                    final_tool_call_count,
                    lines_added,
                    lines_removed,
                    duration_ms,
                    health_score,
                    events_mtime,
                    events_size,
                    CURRENT_ANALYTICS_VERSION,
                ],
            )?;

            // INSERT child rows: model metrics
            for row in &model_rows {
                self.conn.execute(
                    "INSERT INTO session_model_metrics
                        (session_id, model_name, input_tokens, output_tokens,
                         cache_read_tokens, cache_write_tokens, cost, request_count)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![session_id, row.model, row.input_tokens, row.output_tokens,
                            row.cache_read_tokens, row.cache_write_tokens, row.cost, row.premium_requests],
                )?;
            }

            // INSERT child rows: tool calls
            for (name, calls, success, failure, dur, dur_count) in &tool_call_rows {
                self.conn.execute(
                    "INSERT INTO session_tool_calls
                        (session_id, tool_name, call_count, success_count, failure_count, total_duration_ms, calls_with_duration)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![session_id, name, calls, success, failure, dur, dur_count],
                )?;
            }

            // INSERT child rows: modified files
            for (path, ext) in &modified_file_rows {
                self.conn.execute(
                    "INSERT OR IGNORE INTO session_modified_files (session_id, file_path, extension)
                     VALUES (?1, ?2, ?3)",
                    params![session_id, path, ext],
                )?;
            }

            // INSERT child rows: activity heatmap
            for (day, hour, count) in &activity_rows {
                self.conn.execute(
                    "INSERT INTO session_activity (session_id, day_of_week, hour, tool_call_count)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![session_id, day, hour, count],
                )?;
            }

            // INSERT conversation FTS content
            if !fts_content.is_empty() {
                let truncated = truncate_utf8(&fts_content, fts_limit);
                self.conn.execute(
                    "INSERT INTO conversation_fts (session_id, content) VALUES (?1, ?2)",
                    params![session_id, truncated],
                )?;
            }

            Ok(())
        })();

        match result {
            Ok(()) => {
                self.conn.execute_batch("RELEASE upsert_session")?;
                Ok(index_info)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK TO upsert_session");
                let _ = self.conn.execute_batch("RELEASE upsert_session");
                Err(e)
            }
        }
    }

    /// Determine whether the session should be re-indexed.
    ///
    /// Checks workspace.yaml mtime, events.jsonl mtime+size, and analytics_version.
    pub fn needs_reindex(&self, session_id: &str, session_path: &Path) -> bool {
        let current_ws_mtime = get_workspace_mtime(session_path);
        let current_events = get_events_mtime_and_size(session_path);

        let stored: Option<(Option<String>, Option<String>, Option<i64>, Option<i64>)> = self
            .conn
            .query_row(
                "SELECT workspace_mtime, events_mtime, events_size, analytics_version
                 FROM sessions WHERE id = ?1",
                [session_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                    ))
                },
            )
            .ok();

        let Some((stored_ws_mtime, stored_ev_mtime, stored_ev_size, stored_av)) = stored else {
            return true; // Not indexed yet
        };

        // Check analytics version
        if stored_av.unwrap_or(0) < CURRENT_ANALYTICS_VERSION {
            return true;
        }

        // Check workspace mtime
        if stored_ws_mtime.as_deref() != current_ws_mtime.as_deref() {
            return true;
        }

        // Check events mtime + size
        match (&current_events, &stored_ev_mtime) {
            (Some((cur_mtime, cur_size)), Some(st_mtime)) => {
                if cur_mtime != st_mtime || Some(*cur_size as i64) != stored_ev_size {
                    return true;
                }
            }
            (Some(_), None) => return true, // Events appeared
            (None, Some(_)) => return true,  // Events disappeared
            (None, None) => {}
        }

        false
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
        hide_empty: bool,
    ) -> Result<Vec<IndexedSession>> {
        let mut sql = String::from(
            "SELECT id, path, summary, repository, branch, cwd, host_type, created_at, updated_at, event_count, turn_count, current_model FROM sessions WHERE 1=1",
        );
        let mut query_params: Vec<Box<dyn ToSql>> = Vec::new();

        if hide_empty {
            sql.push_str(" AND turn_count IS NOT NULL AND turn_count > 0");
        }

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
    ///
    /// Uses a batch DELETE with IN clause. Child tables cascade via foreign keys.
    pub fn prune_deleted(&self, live_ids: &HashSet<String>) -> Result<usize> {
        let indexed_ids = self.all_indexed_ids()?;
        let stale: Vec<&String> = indexed_ids.iter().filter(|id| !live_ids.contains(*id)).collect();
        let count = stale.len();
        if count == 0 {
            return Ok(0);
        }

        // Use temp table to avoid exceeding SQLITE_MAX_VARIABLE_NUMBER with large IN clauses.
        // Both DELETEs are wrapped in a transaction for atomicity.
        self.conn.execute_batch("BEGIN")?;
        let result = (|| -> Result<()> {
            self.conn.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS _live_ids (id TEXT PRIMARY KEY)"
            )?;
            self.conn.execute_batch("DELETE FROM _live_ids")?;

            let mut stmt = self.conn.prepare(
                "INSERT OR IGNORE INTO _live_ids (id) VALUES (?1)"
            )?;
            for id in live_ids {
                stmt.execute([id])?;
            }

            self.conn.execute_batch(
                "DELETE FROM sessions WHERE id NOT IN (SELECT id FROM _live_ids)"
            )?;
            self.conn.execute_batch(
                "DELETE FROM conversation_fts WHERE session_id NOT IN (SELECT id FROM _live_ids)"
            )?;
            self.conn.execute_batch("DROP TABLE IF EXISTS _live_ids")?;
            Ok(())
        })();

        match result {
            Ok(()) => {
                self.conn.execute_batch("COMMIT")?;
                Ok(count)
            }
            Err(e) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    /// Get a session's filesystem path from the index.
    pub fn get_session_path(&self, session_id: &str) -> Result<Option<PathBuf>> {
        let path: Option<String> = self
            .conn
            .query_row(
                "SELECT path FROM sessions WHERE id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .ok();
        Ok(path.map(PathBuf::from))
    }

    /// Query aggregate analytics from pre-computed per-session data.
    pub fn query_analytics(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        hide_empty: bool,
    ) -> Result<AnalyticsData> {
        let (where_clause, bind_values) = build_date_repo_filter(from_date, to_date, repo, hide_empty);

        // Aggregate session-level stats
        let agg_sql = format!(
            "SELECT COUNT(*), COALESCE(SUM(total_tokens), 0), COALESCE(SUM(total_cost), 0.0),
                    COALESCE(AVG(health_score), 0.0),
                    COALESCE(SUM(turn_count), 0), COALESCE(SUM(tool_call_count), 0),
                    COUNT(CASE WHEN turn_count > 0 THEN 1 END),
                    COALESCE(SUM(total_premium_requests), 0.0)
             FROM sessions s{}",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let (total_sessions, total_tokens, total_cost, avg_health, total_turns, total_tool_calls, sessions_with_turns, total_premium_requests): (
            u32, i64, f64, f64, i64, i64, u32, f64,
        ) = self.conn.query_row(&agg_sql, params_from_iter(refs.iter().copied()), |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
            ))
        })?;

        // Tokens by day
        let day_sql = format!(
            "SELECT date(COALESCE(s.updated_at, s.created_at)) as d, COALESCE(SUM(s.total_tokens), 0)
             FROM sessions s{} AND d IS NOT NULL GROUP BY d ORDER BY d",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let token_usage_by_day = query_day_tokens(&self.conn, &day_sql, &refs)?;

        // Sessions by day
        let sbd_sql = format!(
            "SELECT date(COALESCE(s.updated_at, s.created_at)) as d, COUNT(*)
             FROM sessions s{} AND d IS NOT NULL GROUP BY d ORDER BY d",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let sessions_per_day = query_day_sessions(&self.conn, &sbd_sql, &refs)?;

        // Cost by day
        let cbd_sql = format!(
            "SELECT date(COALESCE(s.updated_at, s.created_at)) as d, COALESCE(SUM(s.total_cost), 0.0)
             FROM sessions s{} AND d IS NOT NULL GROUP BY d ORDER BY d",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let cost_by_day = query_day_cost(&self.conn, &cbd_sql, &refs)?;

        // Model distribution from session_model_metrics
        let mdist_sql = format!(
            "SELECT m.model_name,
                    SUM(m.input_tokens + m.output_tokens + m.cache_read_tokens + m.cache_write_tokens),
                    SUM(m.input_tokens),
                    SUM(m.output_tokens),
                    SUM(m.cache_read_tokens)
             FROM session_model_metrics m
             JOIN sessions s ON s.id = m.session_id{}
             GROUP BY m.model_name ORDER BY 2 DESC",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let model_distribution = query_model_distribution(&self.conn, &mdist_sql, &refs)?;

        // Duration statistics — fetch all duration_ms and compute in Rust
        let dur_sql = format!(
            "SELECT s.duration_ms FROM sessions s{} AND s.duration_ms IS NOT NULL",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let durations = query_durations(&self.conn, &dur_sql, &refs)?;
        let session_duration_stats = compute_duration_stats(&durations);

        // Productivity metrics
        let avg_turns_per_session = if sessions_with_turns > 0 {
            total_turns as f64 / sessions_with_turns as f64
        } else {
            0.0
        };
        let avg_tool_calls_per_turn = if total_turns > 0 {
            total_tool_calls as f64 / total_turns as f64
        } else {
            0.0
        };
        let avg_tokens_per_turn = if total_turns > 0 {
            total_tokens as f64 / total_turns as f64
        } else {
            0.0
        };

        Ok(AnalyticsData {
            total_sessions,
            total_tokens: total_tokens as u64,
            total_cost,
            total_premium_requests,
            average_health_score: avg_health,
            token_usage_by_day,
            sessions_per_day,
            model_distribution,
            cost_by_day,
            session_duration_stats,
            productivity_metrics: ProductivityMetrics {
                avg_turns_per_session,
                avg_tool_calls_per_turn,
                avg_tokens_per_turn,
            },
        })
    }

    /// Query tool analysis from session_tool_calls table.
    pub fn query_tool_analysis(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        hide_empty: bool,
    ) -> Result<ToolAnalysisData> {
        let (where_clause, bind_values) = build_date_repo_filter(from_date, to_date, repo, hide_empty);

        // Per-tool aggregation (include calls_with_duration for accurate averaging)
        let sql = format!(
            "SELECT t.tool_name,
                    SUM(t.call_count), SUM(t.success_count), SUM(t.failure_count),
                    SUM(t.total_duration_ms), SUM(t.calls_with_duration)
             FROM session_tool_calls t
             JOIN sessions s ON s.id = t.session_id{}
             GROUP BY t.tool_name ORDER BY SUM(t.call_count) DESC",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?;

        let mut tools: Vec<ToolUsageEntry> = Vec::new();
        let mut total_calls: u32 = 0;
        let mut total_success: u32 = 0;
        let mut total_failure: u32 = 0;
        let mut total_duration: f64 = 0.0;
        let mut total_with_duration: u32 = 0;

        for row in rows {
            let (name, calls, success, failure, dur, dur_count) = row?;
            total_calls += calls as u32;
            total_success += success as u32;
            total_failure += failure as u32;
            total_duration += dur as f64;
            total_with_duration += dur_count as u32;

            let determined = success + failure;
            let success_rate = if determined > 0 {
                success as f64 / determined as f64
            } else {
                0.0
            };
            let avg_dur = if dur_count > 0 {
                dur as f64 / dur_count as f64
            } else {
                0.0
            };

            tools.push(ToolUsageEntry {
                name,
                call_count: calls as u32,
                success_rate,
                avg_duration_ms: avg_dur,
                total_duration_ms: dur as f64,
            });
        }

        let most_used_tool = tools
            .first()
            .map(|t| t.name.clone())
            .unwrap_or_else(|| "N/A".to_string());

        let overall_determined = total_success + total_failure;
        let success_rate = if overall_determined > 0 {
            total_success as f64 / overall_determined as f64
        } else {
            0.0
        };
        let avg_duration_ms = if total_with_duration > 0 {
            total_duration / total_with_duration as f64
        } else {
            0.0
        };

        // Activity heatmap — full 7×24 grid
        let hm_sql = format!(
            "SELECT a.day_of_week, a.hour, SUM(a.tool_call_count)
             FROM session_activity a
             JOIN sessions s ON s.id = a.session_id{}
             GROUP BY a.day_of_week, a.hour",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let mut hm_stmt = self.conn.prepare(&hm_sql)?;
        let hm_rows = hm_stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, u32>(1)?,
                row.get::<_, u32>(2)?,
            ))
        })?;
        let mut heatmap_data: HashMap<(u32, u32), u32> = HashMap::new();
        for row in hm_rows {
            let (day, hour, count) = row?;
            heatmap_data.insert((day, hour), count);
        }

        let mut activity_heatmap: Vec<HeatmapEntry> = Vec::with_capacity(168);
        for day in 0..7u32 {
            for hour in 0..24u32 {
                let count = heatmap_data.get(&(day, hour)).copied().unwrap_or(0);
                activity_heatmap.push(HeatmapEntry { day, hour, count });
            }
        }

        Ok(ToolAnalysisData {
            total_calls,
            success_rate,
            avg_duration_ms,
            most_used_tool,
            tools,
            activity_heatmap,
        })
    }

    /// Query code impact from per-session columns.
    pub fn query_code_impact(
        &self,
        from_date: Option<&str>,
        to_date: Option<&str>,
        repo: Option<&str>,
        hide_empty: bool,
    ) -> Result<CodeImpactData> {
        let (where_clause, bind_values) = build_date_repo_filter(from_date, to_date, repo, hide_empty);

        // Aggregate lines
        let agg_sql = format!(
            "SELECT COALESCE(SUM(s.lines_added), 0), COALESCE(SUM(s.lines_removed), 0)
             FROM sessions s{}",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let (total_added, total_removed): (i64, i64) =
            self.conn
                .query_row(&agg_sql, params_from_iter(refs.iter().copied()), |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })?;

        // File type breakdown from session_modified_files
        let ext_sql = format!(
            "SELECT COALESCE(f.extension, '(no ext)'), COUNT(*)
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id{}
             GROUP BY f.extension ORDER BY COUNT(*) DESC",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let mut ext_stmt = self.conn.prepare(&ext_sql)?;
        let ext_rows = ext_stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
        })?;
        let mut file_type_entries: Vec<(String, u32)> = Vec::new();
        let mut total_ext_count: u32 = 0;
        for row in ext_rows {
            let (ext, count) = row?;
            total_ext_count += count;
            file_type_entries.push((ext, count));
        }
        let file_type_breakdown: Vec<FileTypeEntry> = file_type_entries
            .into_iter()
            .map(|(extension, count)| {
                let percentage = if total_ext_count > 0 {
                    (count as f64 / total_ext_count as f64) * 100.0
                } else {
                    0.0
                };
                FileTypeEntry {
                    extension,
                    count,
                    percentage,
                }
            })
            .collect();

        // Most modified files (by number of sessions)
        let mf_sql = format!(
            "SELECT f.file_path, COUNT(DISTINCT f.session_id)
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id{}
             GROUP BY f.file_path ORDER BY COUNT(DISTINCT f.session_id) DESC LIMIT 20",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let mut mf_stmt = self.conn.prepare(&mf_sql)?;
        let mf_rows = mf_stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
        })?;
        let mut most_modified_files: Vec<ModifiedFileEntry> = Vec::new();
        for row in mf_rows {
            let (path, count) = row?;
            most_modified_files.push(ModifiedFileEntry {
                path,
                additions: count,
                deletions: 0,
            });
        }

        // Total distinct files
        let fc_sql = format!(
            "SELECT COUNT(DISTINCT f.file_path)
             FROM session_modified_files f
             JOIN sessions s ON s.id = f.session_id{}",
            where_clause
        );
        let refs = to_refs(&bind_values);
        let files_modified: u32 =
            self.conn
                .query_row(&fc_sql, params_from_iter(refs.iter().copied()), |row| row.get(0))?;

        // Changes by day
        let cbd_sql = format!(
            "SELECT date(COALESCE(s.updated_at, s.created_at)) as d,
                    COALESCE(SUM(s.lines_added), 0), COALESCE(SUM(s.lines_removed), 0)
             FROM sessions s
             WHERE 1=1{} AND d IS NOT NULL
             GROUP BY d ORDER BY d",
            &where_clause[" WHERE 1=1".len()..]
        );
        let refs = to_refs(&bind_values);
        let mut cbd_stmt = self.conn.prepare(&cbd_sql)?;
        let cbd_rows = cbd_stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, u64>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })?;
        let mut changes_by_day: Vec<DayChanges> = Vec::new();
        for row in cbd_rows {
            let (date, additions, deletions) = row?;
            changes_by_day.push(DayChanges {
                date,
                additions,
                deletions,
            });
        }

        let net_change = total_added - total_removed;

        Ok(CodeImpactData {
            files_modified,
            lines_added: total_added as u64,
            lines_removed: total_removed as u64,
            net_change,
            file_type_breakdown,
            most_modified_files,
            changes_by_day,
        })
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
        ("Migration 3: analytics schema", MIGRATION_3),
        ("Migration 4: tool duration tracking", MIGRATION_4),
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

fn get_events_mtime_and_size(session_path: &Path) -> Option<(String, u64)> {
    let ev_path = session_path.join("events.jsonl");
    let meta = std::fs::metadata(&ev_path).ok()?;
    let mtime = meta.modified().ok()?;
    let dt: chrono::DateTime<chrono::Utc> = mtime.into();
    Some((dt.to_rfc3339(), meta.len()))
}

// ── SQL query helpers ─────────────────────────────────────────────────

/// Build a WHERE clause for date range + repo filtering on the sessions table.
///
/// Returns (where_clause, bind_values) where where_clause starts with " WHERE 1=1"
/// and may include additional AND conditions.
fn build_date_repo_filter(
    from_date: Option<&str>,
    to_date: Option<&str>,
    repo: Option<&str>,
    hide_empty: bool,
) -> (String, Vec<String>) {
    let mut clause = String::from(" WHERE 1=1");
    let mut values: Vec<String> = Vec::new();

    if hide_empty {
        clause.push_str(" AND s.turn_count IS NOT NULL AND s.turn_count > 0");
    }

    if let Some(from) = from_date {
        values.push(from.to_string());
        clause.push_str(&format!(
            " AND (date(COALESCE(s.updated_at, s.created_at)) >= ?{} OR (s.updated_at IS NULL AND s.created_at IS NULL))",
            values.len()
        ));
    }
    if let Some(to) = to_date {
        values.push(to.to_string());
        clause.push_str(&format!(
            " AND (date(COALESCE(s.updated_at, s.created_at)) <= ?{} OR (s.updated_at IS NULL AND s.created_at IS NULL))",
            values.len()
        ));
    }
    if let Some(repo) = repo {
        values.push(repo.to_string());
        clause.push_str(&format!(" AND s.repository = ?{}", values.len()));
    }

    (clause, values)
}

fn to_refs(values: &[String]) -> Vec<&dyn ToSql> {
    values.iter().map(|v| v as &dyn ToSql).collect()
}

fn query_day_tokens(conn: &Connection, sql: &str, refs: &[&dyn ToSql]) -> Result<Vec<DayTokens>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok(DayTokens {
            date: row.get(0)?,
            tokens: row.get::<_, i64>(1)? as u64,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn query_day_sessions(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<DaySessions>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok(DaySessions {
            date: row.get(0)?,
            count: row.get(1)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn query_day_cost(conn: &Connection, sql: &str, refs: &[&dyn ToSql]) -> Result<Vec<DayCost>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok(DayCost {
            date: row.get(0)?,
            cost: row.get(1)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn query_model_distribution(
    conn: &Connection,
    sql: &str,
    refs: &[&dyn ToSql],
) -> Result<Vec<ModelDistEntry>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, i64>(4)?,
        ))
    })?;
    let mut entries: Vec<(String, i64, i64, i64, i64)> = Vec::new();
    let mut grand_total: i64 = 0;
    for row in rows {
        let (model, tokens, input_t, output_t, cache_read) = row?;
        grand_total += tokens;
        entries.push((model, tokens, input_t, output_t, cache_read));
    }
    Ok(entries
        .into_iter()
        .map(|(model, tokens, input_t, output_t, cache_read)| {
            let percentage = if grand_total > 0 {
                (tokens as f64 / grand_total as f64) * 100.0
            } else {
                0.0
            };
            ModelDistEntry {
                model,
                tokens: tokens as u64,
                percentage,
                input_tokens: input_t as u64,
                output_tokens: output_t as u64,
                cache_read_tokens: cache_read as u64,
            }
        })
        .collect())
}

fn query_durations(conn: &Connection, sql: &str, refs: &[&dyn ToSql]) -> Result<Vec<u64>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        row.get::<_, i64>(0)
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row? as u64);
    }
    Ok(result)
}

fn compute_duration_stats(durations: &[u64]) -> SessionDurationStats {
    if durations.is_empty() {
        return SessionDurationStats {
            avg_ms: 0.0,
            median_ms: 0.0,
            p95_ms: 0.0,
            min_ms: 0,
            max_ms: 0,
            total_sessions_with_duration: 0,
        };
    }

    let mut sorted = durations.to_vec();
    sorted.sort_unstable();
    let n = sorted.len();
    let sum: u64 = sorted.iter().sum();

    let avg_ms = sum as f64 / n as f64;
    let median_ms = if n % 2 == 0 {
        (sorted[n / 2 - 1] + sorted[n / 2]) as f64 / 2.0
    } else {
        sorted[n / 2] as f64
    };
    let p95_idx = ((n as f64 * 0.95).ceil() as usize).min(n) - 1;
    let p95_ms = sorted[p95_idx] as f64;

    SessionDurationStats {
        avg_ms,
        median_ms,
        p95_ms,
        min_ms: sorted[0],
        max_ms: sorted[n - 1],
        total_sessions_with_duration: n as u32,
    }
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
        assert_eq!(v1, 4);
        assert_eq!(count1, 4);
        drop(db1);

        let db2 = IndexDb::open_or_create(&db_path).unwrap();
        let count2: i64 = db2
            .conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count2, 4);
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
}
