//! `IndexDb` stats, maintenance, and context-lookup methods for the search index.

use rusqlite::{params_from_iter, types::ToSql};

use tracepilot_core::provider::SessionSource;

use super::{ContextSnippet, FtsHealthInfo, NATIVE_TOOL_NAME_SQL, SearchStats, SearchToolName};
use crate::Result;
use crate::index_db::IndexDb;
use crate::index_db::row_helpers::context_snippet_from_row;

impl IndexDb {
    /// Number of rows in the search content table.
    pub fn search_content_row_count(&self) -> Result<usize> {
        let rows: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM search_content", [], |row| row.get(0))?;
        Ok(usize::try_from(rows).unwrap_or(0))
    }

    /// Get statistics about the search index.
    pub fn search_stats(&self) -> Result<SearchStats> {
        let total_rows: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM search_content", [], |row| row.get(0))?;

        let indexed_sessions: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE search_indexed_at IS NOT NULL",
            [],
            |row| row.get(0),
        )?;

        let total_sessions: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))?;

        let mut stmt = self.conn.prepare(
            "SELECT content_type, COUNT(*) FROM search_content GROUP BY content_type ORDER BY COUNT(*) DESC",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut content_type_counts = Vec::new();
        for row in rows {
            content_type_counts.push(row?);
        }

        Ok(SearchStats {
            total_rows,
            indexed_sessions,
            total_sessions,
            content_type_counts,
        })
    }

    /// Get distinct repositories from indexed sessions.
    pub fn search_repositories(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT repository FROM sessions WHERE repository IS NOT NULL AND repository != '' ORDER BY repository",
        )?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        let mut repositories = Vec::new();
        for row in rows {
            repositories.push(row?);
        }
        Ok(repositories)
    }

    /// Distinct canonical tool names in search content, each with the native
    /// names its rows record and the sources that used it, for the tool
    /// filter. The filter value stays the canonical name.
    ///
    /// Runs on every Search page load, so it never reads every row: the names
    /// come from the `tool_name` index, native names only from rows of
    /// non-Copilot sessions (Copilot records none, and its rows are most of a
    /// large index), and Copilot's use of a tool from comparing its indexed
    /// row count with the rows other sources wrote.
    pub fn search_tool_names(&self) -> Result<Vec<SearchToolName>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT tool_name FROM search_content \
             WHERE tool_name IS NOT NULL ORDER BY tool_name",
        )?;
        let mut names = stmt
            .query_map([], |row| {
                Ok(SearchToolName {
                    name: row.get(0)?,
                    native_names: Vec::new(),
                    sources: Vec::new(),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut other_rows = vec![0_i64; names.len()];

        // CROSS JOIN keeps the session-first plan: each non-Copilot session's
        // rows through the session index, never a walk of every tool row.
        let sql = format!(
            "SELECT sc.tool_name, s.source, {NATIVE_TOOL_NAME_SQL} AS native_tool_name, \
                    COUNT(*) \
             FROM sessions s CROSS JOIN search_content sc ON sc.session_id = s.id \
             WHERE s.source != ?1 AND sc.tool_name IS NOT NULL \
             GROUP BY sc.tool_name, s.source, native_tool_name"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([SessionSource::Copilot.as_str()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?;
        for row in rows {
            let (name, source, native, count) = row?;
            let Ok(index) = names.binary_search_by(|tool| tool.name.as_str().cmp(&name)) else {
                continue;
            };
            let entry = &mut names[index];
            other_rows[index] += count;
            if let Some(source) = SessionSource::from_stored(&source)
                && !entry.sources.contains(&source)
            {
                entry.sources.push(source);
            }
            if let Some(native) = native
                && !entry.native_names.contains(&native)
            {
                entry.native_names.push(native);
            }
        }

        // Rows other sources did not write are Copilot's; counting one tool's
        // rows reads only its index entries.
        let mut count_stmt = self
            .conn
            .prepare("SELECT COUNT(*) FROM search_content WHERE tool_name = ?1")?;
        for (entry, other) in names.iter_mut().zip(other_rows) {
            if entry.sources.is_empty()
                || count_stmt.query_row([&entry.name], |row| row.get::<_, i64>(0))? > other
            {
                entry.sources.push(SessionSource::Copilot);
            }
            entry.sources.sort();
            entry.native_names.sort();
        }
        Ok(names)
    }

    /// Get aggregate search statistics.
    pub fn query_search_stats(&self) -> Result<SearchStats> {
        self.search_stats()
    }

    /// Run FTS5 optimize and WAL checkpoint for maintenance.
    pub fn fts_optimize(&self) -> Result<String> {
        self.conn.execute_batch(
            "INSERT INTO search_fts(search_fts) VALUES('optimize');
             PRAGMA wal_checkpoint(TRUNCATE);",
        )?;
        Ok("FTS index optimized and WAL checkpointed".to_string())
    }

    /// Run FTS5 integrity check.
    pub fn fts_integrity_check(&self) -> Result<String> {
        match self
            .conn
            .execute_batch("INSERT INTO search_fts(search_fts) VALUES('integrity-check')")
        {
            Ok(()) => Ok("ok".to_string()),
            Err(e) => Ok(format!("Integrity check failed: {}", e)),
        }
    }

    /// Get detailed FTS health information.
    pub fn fts_health(&self) -> Result<FtsHealthInfo> {
        let total_content_rows: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM search_content", [], |r| r.get(0))?;
        let fts_index_rows: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM search_fts", [], |r| r.get(0))?;
        let indexed_sessions: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM sessions WHERE search_indexed_at IS NOT NULL",
            [],
            |r| r.get(0),
        )?;
        let total_sessions: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))?;
        let pending_sessions = total_sessions - indexed_sessions;
        let in_sync = total_content_rows == fts_index_rows && pending_sessions == 0;
        let content_types: Vec<(String, i64)> = {
            let mut stmt = self.conn.prepare(
                "SELECT content_type, COUNT(*) FROM search_content GROUP BY content_type ORDER BY COUNT(*) DESC"
            )?;
            let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
            let mut content_types = Vec::new();
            for row in rows {
                content_types.push(row?);
            }
            content_types
        };
        let db_size: i64 = self.conn.query_row(
            "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
            [],
            |r| r.get(0),
        )?;
        Ok(FtsHealthInfo {
            total_content_rows,
            fts_index_rows,
            indexed_sessions,
            total_sessions,
            pending_sessions,
            in_sync,
            content_types,
            db_size_bytes: db_size,
        })
    }

    /// Get surrounding context for a search result (adjacent rows in the same session).
    pub fn get_result_context(
        &self,
        result_id: i64,
        radius: usize,
    ) -> Result<(Vec<ContextSnippet>, Vec<ContextSnippet>)> {
        let radius = radius.min(10); // clamp to prevent excessive queries

        // Get the session_id and event_index for this result
        let (session_id, event_index): (String, Option<i64>) = self.conn.query_row(
            "SELECT session_id, event_index FROM search_content WHERE id = ?1",
            [result_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        let event_idx = event_index.unwrap_or(0);

        // Get rows before
        let mut before_stmt = self.conn.prepare(&format!(
            "SELECT id, content_type, turn_number, event_index, tool_name, \
                    {NATIVE_TOOL_NAME_SQL} AS native_tool_name, substr(content, 1, 300) AS preview \
             FROM search_content \
             WHERE session_id = ?1 AND event_index < ?2 AND event_index IS NOT NULL \
             ORDER BY event_index DESC LIMIT ?3"
        ))?;
        let before = before_stmt.query_map(
            params_from_iter([
                Box::new(session_id.clone()) as Box<dyn ToSql>,
                Box::new(event_idx),
                Box::new(radius as i64),
            ]),
            context_snippet_from_row,
        )?;
        let mut before_results: Vec<ContextSnippet> = Vec::new();
        for row in before {
            before_results.push(row?);
        }
        before_results.reverse();

        // Get rows after
        let mut after_stmt = self.conn.prepare(&format!(
            "SELECT id, content_type, turn_number, event_index, tool_name, \
                    {NATIVE_TOOL_NAME_SQL} AS native_tool_name, substr(content, 1, 300) AS preview \
             FROM search_content \
             WHERE session_id = ?1 AND event_index > ?2 AND event_index IS NOT NULL \
             ORDER BY event_index ASC LIMIT ?3"
        ))?;
        let after = after_stmt.query_map(
            params_from_iter([
                Box::new(session_id) as Box<dyn ToSql>,
                Box::new(event_idx),
                Box::new(radius as i64),
            ]),
            context_snippet_from_row,
        )?;
        let mut after_results = Vec::new();
        for row in after {
            after_results.push(row?);
        }

        Ok((before_results, after_results))
    }

    /// Alias for clear_search_content — clears all and resets indexing state.
    pub fn rebuild_search_content(&self) -> Result<()> {
        self.clear_search_content()
    }
}
