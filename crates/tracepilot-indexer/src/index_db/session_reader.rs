//! Read-only session query methods.

use crate::Result;
use rusqlite::{params_from_iter, types::ToSql};
use std::collections::HashSet;
use std::path::PathBuf;
use tracepilot_core::ids::SessionId;

use super::IndexDb;
use super::row_helpers::*;
use super::types::*;

const SESSION_COLUMNS: &str = "id, path, summary, repository, branch, cwd, host_type, created_at, updated_at, event_count, turn_count, current_model, copilot_version, error_count, rate_limit_count, compaction_count, truncation_count";

impl IndexDb {
    /// List indexed sessions with optional filters.
    pub fn list_sessions(
        &self,
        limit: Option<usize>,
        filter_repo: Option<&str>,
        filter_branch: Option<&str>,
        hide_empty: bool,
    ) -> Result<Vec<IndexedSession>> {
        self.list_sessions_filtered(limit, filter_repo, filter_branch, hide_empty)
    }

    /// List sessions with optional metadata filters.
    pub fn list_sessions_filtered(
        &self,
        limit: Option<usize>,
        filter_repo: Option<&str>,
        filter_branch: Option<&str>,
        hide_empty: bool,
    ) -> Result<Vec<IndexedSession>> {
        use super::helpers::build_eq_filter;

        let mut sql = format!("SELECT {SESSION_COLUMNS} FROM sessions WHERE 1=1");
        let mut query_params: Vec<Box<dyn ToSql>> = Vec::new();

        if hide_empty {
            sql.push_str(" AND turn_count IS NOT NULL AND turn_count > 0");
        }

        if let Some(repo) = filter_repo {
            sql.push_str(&build_eq_filter(
                "repository",
                repo.to_string(),
                &mut query_params,
            ));
        }
        if let Some(branch) = filter_branch {
            sql.push_str(&build_eq_filter(
                "branch",
                branch.to_string(),
                &mut query_params,
            ));
        }

        sql.push_str(" ORDER BY updated_at DESC");
        if let Some(limit) = limit {
            let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
            sql.push_str(" LIMIT ?");
            query_params.push(Box::new(limit_i64));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(
            params_from_iter(query_params.iter().map(|p| p.as_ref())),
            indexed_session_from_row,
        )?;

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

    /// Get a session's filesystem path from the index.
    ///
    /// Accepts a validated [`SessionId`]; internal queries bind the inner
    /// string as a SQL parameter so prefix lookups are not supported here.
    pub fn get_session_path(&self, session_id: &SessionId) -> Result<Option<PathBuf>> {
        let path: Option<String> = self
            .conn
            .query_row(
                "SELECT path FROM sessions WHERE id = ?1",
                [session_id.as_str()],
                |row| row.get(0),
            )
            .ok();
        Ok(path.map(PathBuf::from))
    }

    /// Full-text search across session metadata (toolbar quick search).
    /// Uses sessions_fts for lightweight session-level matching.
    pub fn search(&self, query: &str) -> Result<Vec<String>> {
        let mut results = HashSet::new();

        let mut stmt = self
            .conn
            .prepare("SELECT id FROM sessions_fts WHERE sessions_fts MATCH ?1")?;
        let ids = stmt.query_map([query], |row| row.get::<_, String>(0))?;
        for id in ids.flatten() {
            results.insert(id);
        }

        Ok(results.into_iter().collect())
    }

    /// Full-text search across session metadata returning full indexed rows.
    pub fn search_sessions(&self, query: &str) -> Result<Vec<IndexedSession>> {
        let mut stmt = self.conn.prepare(
            "SELECT
                s.id, s.path, s.summary, s.repository, s.branch, s.cwd, s.host_type,
                s.created_at, s.updated_at, s.event_count, s.turn_count, s.current_model,
                s.copilot_version, s.error_count, s.rate_limit_count, s.compaction_count, s.truncation_count
             FROM sessions_fts f
             INNER JOIN sessions s ON s.rowid = f.rowid
             WHERE sessions_fts MATCH ?1
             ORDER BY s.updated_at DESC, s.id ASC",
        )?;
        let rows = stmt.query_map([query], indexed_session_from_row)?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(sessions)
    }

    /// Get distinct CWD paths from all indexed sessions (for repo discovery).
    pub fn distinct_session_cwds(&self) -> Result<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT cwd FROM sessions WHERE cwd IS NOT NULL AND cwd != ''")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut cwds = Vec::new();
        for row in rows {
            cwds.push(row?);
        }
        Ok(cwds)
    }

    /// Return recent skill tool invocation candidates from indexed search rows.
    ///
    /// `search_content` stores one `tool_call` row per invocation, so callers can
    /// cheaply identify candidate skill names before opening event logs for the
    /// source path/details that are not persisted in the aggregate tables.
    pub fn recent_skill_call_candidates(
        &self,
        limit: usize,
    ) -> Result<Vec<IndexedSkillCallCandidate>> {
        let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
        let mut stmt = self.conn.prepare(
            "WITH recent_skill_calls AS (
                 SELECT
                     LOWER(TRIM(c.content)) AS normalized_name,
                     TRIM(c.content) AS display_name,
                     s.path AS session_path,
                     COALESCE(c.timestamp_unix, unixepoch(s.updated_at), 0) AS sort_ts,
                     c.id AS search_row_id
                 FROM search_content c
                 JOIN sessions s ON s.id = c.session_id
                 WHERE c.tool_name = 'skill'
                   AND c.content_type = 'tool_call'
                   AND LENGTH(TRIM(c.content)) > 0
                   AND s.turn_count IS NOT NULL
                   AND s.turn_count > 0
                 ORDER BY sort_ts DESC, search_row_id DESC
                 LIMIT ?1
             ),
             ranked AS (
                 SELECT
                     normalized_name,
                     display_name,
                     session_path,
                     sort_ts,
                     search_row_id,
                     COUNT(*) OVER (PARTITION BY normalized_name) AS invocation_count,
                     ROW_NUMBER() OVER (
                         PARTITION BY normalized_name
                         ORDER BY sort_ts DESC, search_row_id DESC
                     ) AS rn
                 FROM recent_skill_calls
             )
             SELECT normalized_name, display_name, session_path, invocation_count
             FROM ranked
             WHERE rn <= 3
             ORDER BY sort_ts DESC, search_row_id DESC",
        )?;
        let rows = stmt.query_map([limit_i64], |row| {
            let invocation_count = row.get::<_, i64>(3)?.max(0);
            Ok(IndexedSkillCallCandidate {
                normalized_name: row.get::<_, String>(0)?,
                display_name: row.get::<_, String>(1)?,
                session_path: PathBuf::from(row.get::<_, String>(2)?),
                invocation_count: usize::try_from(invocation_count).unwrap_or(usize::MAX),
            })
        })?;
        let mut candidates = Vec::new();
        for row in rows {
            candidates.push(row?);
        }
        Ok(candidates)
    }

    /// Return recent indexed sessions that used the Copilot `skill` tool.
    ///
    /// Retained as a coarse fallback for callers that only need session paths.
    pub fn recent_skill_tool_sessions(&self, limit: usize) -> Result<Vec<(String, PathBuf)>> {
        let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
        let mut stmt = self.conn.prepare(
            "SELECT s.id, s.path
             FROM session_tool_calls t
             JOIN sessions s ON s.id = t.session_id
             WHERE t.tool_name = 'skill'
               AND t.call_count > 0
               AND s.turn_count IS NOT NULL
               AND s.turn_count > 0
             ORDER BY s.updated_at DESC, s.id ASC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map([limit_i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                PathBuf::from(row.get::<_, String>(1)?),
            ))
        })?;
        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(sessions)
    }

    /// Query incidents for a specific session.
    pub fn get_session_incidents(&self, session_id: &SessionId) -> Result<Vec<IndexedIncident>> {
        let mut stmt = self.conn.prepare(
            "SELECT event_type, source_event_type, timestamp, severity, summary, detail_json
             FROM session_incidents WHERE session_id = ?1 ORDER BY timestamp",
        )?;
        let rows = stmt.query_map([session_id.as_str()], indexed_incident_from_row)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }
}
