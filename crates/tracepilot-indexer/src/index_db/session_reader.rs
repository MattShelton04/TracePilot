//! Read-only session query methods.

use crate::Result;
use rusqlite::{params_from_iter, types::ToSql};
use std::collections::HashSet;
use std::path::PathBuf;

use super::row_helpers::*;
use super::types::*;
use super::IndexDb;

const SESSION_COLUMNS: &str = "id, path, summary, repository, branch, cwd, host_type, created_at, updated_at, event_count, turn_count, current_model, error_count, rate_limit_count, compaction_count, truncation_count";

impl IndexDb {
    /// List indexed sessions with optional filters.
    pub fn list_sessions(
        &self,
        limit: Option<usize>,
        filter_repo: Option<&str>,
        filter_branch: Option<&str>,
        hide_empty: bool,
    ) -> Result<Vec<IndexedSession>> {
        self.list_sessions_filtered(limit, filter_repo, filter_branch, hide_empty, None)
    }

    /// List sessions with optional CWD prefix exclusion (used to hide orchestrator sessions).
    pub fn list_sessions_filtered(
        &self,
        limit: Option<usize>,
        filter_repo: Option<&str>,
        filter_branch: Option<&str>,
        hide_empty: bool,
        exclude_cwd_prefix: Option<&str>,
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

        if let Some(prefix) = exclude_cwd_prefix {
            // Normalize both sides to forward slashes for Windows compatibility.
            // The copilot CLI may record CWD with backslashes or forward slashes,
            // and cfg.jobs_dir() may differ.  `REPLACE(cwd, '\', '/')` ensures
            // the LIKE comparison works regardless of separator style.
            let normalized = prefix.replace('\\', "/");
            sql.push_str(
                " AND (cwd IS NULL OR REPLACE(cwd, '\\', '/') NOT LIKE ?)",
            );
            query_params.push(Box::new(format!("{normalized}%")));
        }

        sql.push_str(" ORDER BY updated_at DESC");
        if let Some(limit) = limit {
            let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
            sql.push_str(" LIMIT ?");
            query_params.push(Box::new(limit_i64));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let refs: Vec<&dyn ToSql> = query_params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_from_iter(refs), indexed_session_from_row)?;

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
                s.error_count, s.rate_limit_count, s.compaction_count, s.truncation_count
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

    /// Query incidents for a specific session.
    pub fn get_session_incidents(&self, session_id: &str) -> Result<Vec<IndexedIncident>> {
        let mut stmt = self.conn.prepare(
            "SELECT event_type, source_event_type, timestamp, severity, summary, detail_json
             FROM session_incidents WHERE session_id = ?1 ORDER BY timestamp",
        )?;
        let rows = stmt.query_map([session_id], indexed_incident_from_row)?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row?);
        }
        Ok(result)
    }
}
