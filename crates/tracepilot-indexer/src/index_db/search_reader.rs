//! Deep FTS query builder and result reader.
//!
//! Provides parameterized search across `search_content` + `search_fts`,
//! with filtering by content type, session, tool name, date range, and
//! repository. Results include highlighted snippets and pagination.
//!
//! Supports two search modes:
//! - **FTS**: Full-text search via `search_fts` table (default)
//! - **Browse**: Filter-only queries without FTS MATCH (empty query)

use anyhow::Result;
use rusqlite::{params_from_iter, types::ToSql};

use super::IndexDb;

/// A single search result with context for display and deep-linking.
#[derive(Debug, Clone)]
pub struct SearchResult {
    pub id: i64,
    pub session_id: String,
    pub content_type: String,
    pub turn_number: Option<i64>,
    pub event_index: Option<i64>,
    pub timestamp_unix: Option<i64>,
    pub tool_name: Option<String>,
    pub snippet: String,
    pub metadata_json: Option<String>,
    // Joined from sessions table
    pub session_summary: Option<String>,
    pub session_repository: Option<String>,
    pub session_branch: Option<String>,
    pub session_updated_at: Option<String>,
}

/// Filters for search queries.
#[derive(Debug, Default, Clone)]
pub struct SearchFilters {
    pub content_types: Vec<String>,
    pub repositories: Vec<String>,
    pub tool_names: Vec<String>,
    pub session_id: Option<String>,
    pub date_from_unix: Option<i64>,
    pub date_to_unix: Option<i64>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    /// Sort order: "relevance" (default), "newest", "oldest"
    pub sort_by: Option<String>,
}

/// Facet counts for the search results sidebar.
#[derive(Debug, Clone)]
pub struct SearchFacets {
    pub by_content_type: Vec<(String, i64)>,
    pub by_repository: Vec<(String, i64)>,
    pub by_tool_name: Vec<(String, i64)>,
    pub total_matches: i64,
    pub session_count: i64,
}

/// Stats about the search index.
#[derive(Debug, Clone)]
pub struct SearchStats {
    pub total_rows: i64,
    pub indexed_sessions: i64,
    pub total_sessions: i64,
    pub content_type_counts: Vec<(String, i64)>,
}

impl IndexDb {
    /// Deep full-text search across all session content.
    ///
    /// The query is sanitized for FTS5 safety, then used in a MATCH expression.
    /// Results are ranked by BM25 relevance and joined with session metadata.
    pub fn search_content(
        &self,
        query: &str,
        filters: &SearchFilters,
    ) -> Result<Vec<SearchResult>> {
        let sanitized = sanitize_fts_query(query);
        if sanitized.is_empty() {
            return Ok(Vec::new());
        }

        let mut sql = String::from(
            "SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index,
                    sc.timestamp_unix, sc.tool_name,
                    snippet(search_fts, 0, '\x01MARK_OPEN\x01', '\x01MARK_CLOSE\x01', '…', 48),
                    sc.metadata_json,
                    s.summary, s.repository, s.branch, s.updated_at
             FROM search_fts
             JOIN search_content sc ON sc.id = search_fts.rowid
             JOIN sessions s ON s.id = sc.session_id
             WHERE search_fts MATCH ?",
        );

        let mut query_params: Vec<Box<dyn ToSql>> = vec![Box::new(sanitized.clone())];

        // Apply filters
        if !filters.content_types.is_empty() {
            let placeholders = filters
                .content_types
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(", ");
            sql.push_str(&format!(" AND sc.content_type IN ({})", placeholders));
            for ct in &filters.content_types {
                query_params.push(Box::new(ct.clone()));
            }
        }

        if !filters.repositories.is_empty() {
            let placeholders = filters
                .repositories
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(", ");
            sql.push_str(&format!(" AND s.repository IN ({})", placeholders));
            for repo in &filters.repositories {
                query_params.push(Box::new(repo.clone()));
            }
        }

        if !filters.tool_names.is_empty() {
            let placeholders = filters
                .tool_names
                .iter()
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(", ");
            sql.push_str(&format!(" AND sc.tool_name IN ({})", placeholders));
            for tn in &filters.tool_names {
                query_params.push(Box::new(tn.clone()));
            }
        }

        if let Some(ref sid) = filters.session_id {
            sql.push_str(" AND sc.session_id = ?");
            query_params.push(Box::new(sid.clone()));
        }

        if let Some(from) = filters.date_from_unix {
            sql.push_str(" AND sc.timestamp_unix >= ?");
            query_params.push(Box::new(from));
        }

        if let Some(to) = filters.date_to_unix {
            sql.push_str(" AND sc.timestamp_unix <= ?");
            query_params.push(Box::new(to));
        }

        // Sort order
        match filters.sort_by.as_deref() {
            Some("newest") => sql.push_str(" ORDER BY sc.timestamp_unix DESC NULLS LAST"),
            Some("oldest") => sql.push_str(" ORDER BY sc.timestamp_unix ASC NULLS LAST"),
            _ => sql.push_str(" ORDER BY rank"),
        }

        let limit = filters.limit.unwrap_or(50).min(200) as i64;
        let offset = filters.offset.unwrap_or(0) as i64;
        sql.push_str(" LIMIT ? OFFSET ?");
        query_params.push(Box::new(limit));
        query_params.push(Box::new(offset));

        let mut stmt = self.conn.prepare(&sql)?;
        let refs: Vec<&dyn ToSql> = query_params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(params_from_iter(refs), |row| {
            let raw_snippet: String = row.get(7)?;
            Ok(SearchResult {
                id: row.get(0)?,
                session_id: row.get(1)?,
                content_type: row.get(2)?,
                turn_number: row.get(3)?,
                event_index: row.get(4)?,
                timestamp_unix: row.get(5)?,
                tool_name: row.get(6)?,
                snippet: sanitize_snippet(&raw_snippet),
                metadata_json: row.get(8)?,
                session_summary: row.get(9)?,
                session_repository: row.get(10)?,
                session_branch: row.get(11)?,
                session_updated_at: row.get(12)?,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Count total matches for a search query (for pagination).
    pub fn search_content_count(
        &self,
        query: &str,
        filters: &SearchFilters,
    ) -> Result<i64> {
        let sanitized = sanitize_fts_query(query);
        if sanitized.is_empty() {
            return Ok(0);
        }

        let mut sql = String::from(
            "SELECT COUNT(*) FROM search_fts
             JOIN search_content sc ON sc.id = search_fts.rowid
             JOIN sessions s ON s.id = sc.session_id
             WHERE search_fts MATCH ?",
        );

        let mut query_params: Vec<Box<dyn ToSql>> = vec![Box::new(sanitized)];

        if !filters.content_types.is_empty() {
            let placeholders = filters.content_types.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            sql.push_str(&format!(" AND sc.content_type IN ({})", placeholders));
            for ct in &filters.content_types {
                query_params.push(Box::new(ct.clone()));
            }
        }

        if !filters.repositories.is_empty() {
            let placeholders = filters.repositories.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            sql.push_str(&format!(" AND s.repository IN ({})", placeholders));
            for repo in &filters.repositories {
                query_params.push(Box::new(repo.clone()));
            }
        }

        if !filters.tool_names.is_empty() {
            let placeholders = filters.tool_names.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            sql.push_str(&format!(" AND sc.tool_name IN ({})", placeholders));
            for tn in &filters.tool_names {
                query_params.push(Box::new(tn.clone()));
            }
        }

        if let Some(ref sid) = filters.session_id {
            sql.push_str(" AND sc.session_id = ?");
            query_params.push(Box::new(sid.clone()));
        }

        if let Some(from) = filters.date_from_unix {
            sql.push_str(" AND sc.timestamp_unix >= ?");
            query_params.push(Box::new(from));
        }

        if let Some(to) = filters.date_to_unix {
            sql.push_str(" AND sc.timestamp_unix <= ?");
            query_params.push(Box::new(to));
        }

        let refs: Vec<&dyn ToSql> = query_params.iter().map(|p| p.as_ref()).collect();
        let count: i64 = self.conn.query_row(&sql, params_from_iter(refs), |row| row.get(0))?;
        Ok(count)
    }

    // ── Browse mode (filter-only, no FTS MATCH) ─────────────────────

    /// Browse search content using filters only (no text query required).
    /// Returns results sorted by timestamp (newest first by default).
    pub fn browse_content(
        &self,
        filters: &SearchFilters,
    ) -> Result<Vec<SearchResult>> {
        let mut sql = String::from(
            "SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index,
                    sc.timestamp_unix, sc.tool_name,
                    CASE WHEN LENGTH(sc.content) > 200
                         THEN SUBSTR(sc.content, 1, 200) || '…'
                         ELSE sc.content END,
                    sc.metadata_json,
                    s.summary, s.repository, s.branch, s.updated_at
             FROM search_content sc
             JOIN sessions s ON s.id = sc.session_id
             WHERE 1=1",
        );

        let mut query_params: Vec<Box<dyn ToSql>> = Vec::new();
        append_sql_filters(&mut sql, &mut query_params, filters);

        // Browse mode: relevance is meaningless without FTS, default to newest
        match filters.sort_by.as_deref() {
            Some("oldest") => sql.push_str(" ORDER BY sc.timestamp_unix ASC NULLS LAST"),
            _ => sql.push_str(" ORDER BY sc.timestamp_unix DESC NULLS LAST"),
        }

        let limit = filters.limit.unwrap_or(50).min(200) as i64;
        let offset = filters.offset.unwrap_or(0) as i64;
        sql.push_str(" LIMIT ? OFFSET ?");
        query_params.push(Box::new(limit));
        query_params.push(Box::new(offset));

        let mut stmt = self.conn.prepare(&sql)?;
        let refs: Vec<&dyn ToSql> = query_params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(params_from_iter(refs), |row| {
            let raw_snippet: String = row.get(7)?;
            Ok(SearchResult {
                id: row.get(0)?,
                session_id: row.get(1)?,
                content_type: row.get(2)?,
                turn_number: row.get(3)?,
                event_index: row.get(4)?,
                timestamp_unix: row.get(5)?,
                tool_name: row.get(6)?,
                snippet: sanitize_snippet(&raw_snippet),
                metadata_json: row.get(8)?,
                session_summary: row.get(9)?,
                session_repository: row.get(10)?,
                session_branch: row.get(11)?,
                session_updated_at: row.get(12)?,
            })
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Count total rows for browse mode (filter-only, no FTS).
    pub fn browse_content_count(
        &self,
        filters: &SearchFilters,
    ) -> Result<i64> {
        let mut sql = String::from(
            "SELECT COUNT(*) FROM search_content sc
             JOIN sessions s ON s.id = sc.session_id
             WHERE 1=1",
        );

        let mut query_params: Vec<Box<dyn ToSql>> = Vec::new();
        append_sql_filters(&mut sql, &mut query_params, filters);

        let refs: Vec<&dyn ToSql> = query_params.iter().map(|p| p.as_ref()).collect();
        let count: i64 = self.conn.query_row(&sql, params_from_iter(refs), |row| row.get(0))?;
        Ok(count)
    }

    /// Get facets for browse mode (filter-only, no FTS MATCH).
    /// Each facet dimension excludes its own filter for proper faceted navigation.
    pub fn browse_facets(&self, filters: &SearchFilters) -> Result<SearchFacets> {
        // by_content_type: exclude content_types filter
        let by_content_type = {
            let mut sql = String::from(
                "SELECT sc.content_type, COUNT(*) FROM search_content sc
                 JOIN sessions s ON s.id = sc.session_id WHERE 1=1",
            );
            let mut params: Vec<Box<dyn ToSql>> = Vec::new();
            let excl = SearchFilters { content_types: Vec::new(), ..filters.clone() };
            append_sql_filters(&mut sql, &mut params, &excl);
            sql.push_str(" GROUP BY sc.content_type ORDER BY COUNT(*) DESC");
            let mut stmt = self.conn.prepare(&sql)?;
            let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
            stmt.query_map(params_from_iter(refs), |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        };

        // by_repository: exclude repositories filter
        let by_repository = {
            let mut sql = String::from(
                "SELECT s.repository, COUNT(*) FROM search_content sc
                 JOIN sessions s ON s.id = sc.session_id
                 WHERE s.repository IS NOT NULL",
            );
            let mut params: Vec<Box<dyn ToSql>> = Vec::new();
            let excl = SearchFilters { repositories: Vec::new(), ..filters.clone() };
            append_sql_filters(&mut sql, &mut params, &excl);
            sql.push_str(" GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT 20");
            let mut stmt = self.conn.prepare(&sql)?;
            let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
            stmt.query_map(params_from_iter(refs), |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        };

        // by_tool_name: exclude tool_names filter
        let by_tool_name = {
            let mut sql = String::from(
                "SELECT sc.tool_name, COUNT(*) FROM search_content sc
                 JOIN sessions s ON s.id = sc.session_id
                 WHERE sc.tool_name IS NOT NULL",
            );
            let mut params: Vec<Box<dyn ToSql>> = Vec::new();
            let excl = SearchFilters { tool_names: Vec::new(), ..filters.clone() };
            append_sql_filters(&mut sql, &mut params, &excl);
            sql.push_str(" GROUP BY sc.tool_name ORDER BY COUNT(*) DESC LIMIT 20");
            let mut stmt = self.conn.prepare(&sql)?;
            let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
            stmt.query_map(params_from_iter(refs), |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        };

        // Total matches and distinct sessions (combined into single query)
        let (total_matches, session_count): (i64, i64) = {
            let mut sql = String::from(
                "SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_content sc
                 JOIN sessions s ON s.id = sc.session_id WHERE 1=1",
            );
            let mut params: Vec<Box<dyn ToSql>> = Vec::new();
            append_sql_filters(&mut sql, &mut params, filters);
            let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
            self.conn.query_row(&sql, params_from_iter(refs), |row| Ok((row.get(0)?, row.get(1)?)))?
        };

        Ok(SearchFacets {
            by_content_type,
            by_repository,
            by_tool_name,
            total_matches,
            session_count,
        })
    }

    /// Get facet counts for a search query (for the filter sidebar).
    /// Each facet dimension excludes its own filter for proper faceted navigation.
    pub fn search_facets(&self, query: &str, filters: &SearchFilters) -> Result<SearchFacets> {
        let sanitized = sanitize_fts_query(query);
        if sanitized.is_empty() {
            return Ok(SearchFacets {
                by_content_type: Vec::new(),
                by_repository: Vec::new(),
                by_tool_name: Vec::new(),
                total_matches: 0,
                session_count: 0,
            });
        }

        // by_content_type: exclude content_types filter so all types show counts
        let by_content_type = {
            let excl = SearchFilters { content_types: Vec::new(), ..filters.clone() };
            let filt_where = build_filter_where(&excl);
            self.facet_query(
                &format!(
                    "SELECT sc.content_type, COUNT(*) FROM search_fts
                     JOIN search_content sc ON sc.id = search_fts.rowid
                     JOIN sessions s ON s.id = sc.session_id
                     WHERE search_fts MATCH ?1 {}
                     GROUP BY sc.content_type ORDER BY COUNT(*) DESC",
                    filt_where
                ),
                &sanitized,
                &excl,
            )?
        };

        // by_repository: exclude repositories filter
        let by_repository = {
            let excl = SearchFilters { repositories: Vec::new(), ..filters.clone() };
            let filt_where = build_filter_where(&excl);
            self.facet_query(
                &format!(
                    "SELECT s.repository, COUNT(*) FROM search_fts
                     JOIN search_content sc ON sc.id = search_fts.rowid
                     JOIN sessions s ON s.id = sc.session_id
                     WHERE search_fts MATCH ?1 AND s.repository IS NOT NULL {}
                     GROUP BY s.repository ORDER BY COUNT(*) DESC
                     LIMIT 20",
                    filt_where
                ),
                &sanitized,
                &excl,
            )?
        };

        // by_tool_name: exclude tool_names filter
        let by_tool_name = {
            let excl = SearchFilters { tool_names: Vec::new(), ..filters.clone() };
            let filt_where = build_filter_where(&excl);
            self.facet_query(
                &format!(
                    "SELECT sc.tool_name, COUNT(*) FROM search_fts
                     JOIN search_content sc ON sc.id = search_fts.rowid
                     JOIN sessions s ON s.id = sc.session_id
                     WHERE search_fts MATCH ?1 AND sc.tool_name IS NOT NULL {}
                     GROUP BY sc.tool_name ORDER BY COUNT(*) DESC
                     LIMIT 20",
                    filt_where
                ),
                &sanitized,
                &excl,
            )?
        };

        // Total matches and distinct sessions (combined into single query)
        let (total_matches, session_count): (i64, i64) = {
            let base_where = build_filter_where(filters);
            let sql = format!(
                "SELECT COUNT(*), COUNT(DISTINCT sc.session_id) FROM search_fts
                 JOIN search_content sc ON sc.id = search_fts.rowid
                 JOIN sessions s ON s.id = sc.session_id
                 WHERE search_fts MATCH ?1 {}",
                base_where
            );
            let mut params: Vec<Box<dyn ToSql>> = vec![Box::new(sanitized.clone())];
            append_filter_params(filters, &mut params);
            let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
            self.conn.query_row(&sql, params_from_iter(refs), |row| Ok((row.get(0)?, row.get(1)?)))?
        };

        Ok(SearchFacets {
            by_content_type,
            by_repository,
            by_tool_name,
            total_matches,
            session_count,
        })
    }

    /// Get statistics about the search index.
    pub fn search_stats(&self) -> Result<SearchStats> {
        let total_rows: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM search_content", [], |row| row.get(0))
            .unwrap_or(0);

        let indexed_sessions: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE search_indexed_at IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let total_sessions: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap_or(0);

        let mut stmt = self.conn.prepare(
            "SELECT content_type, COUNT(*) FROM search_content GROUP BY content_type ORDER BY COUNT(*) DESC",
        )?;
        let content_type_counts: Vec<(String, i64)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

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
        let repos: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(repos)
    }

    /// Get distinct tool names from search content.
    pub fn search_tool_names(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT tool_name FROM search_content WHERE tool_name IS NOT NULL ORDER BY tool_name",
        )?;
        let names: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(names)
    }

    /// Get all available facets (no query needed — for initial page load).
    pub fn search_facets_all(&self) -> Result<SearchFacets> {
        let by_content_type = {
            let mut stmt = self.conn.prepare(
                "SELECT content_type, COUNT(*) FROM search_content GROUP BY content_type ORDER BY COUNT(*) DESC"
            )?;
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        };

        let by_repository = {
            let mut stmt = self.conn.prepare(
                "SELECT s.repository, COUNT(*) FROM search_content sc
                 JOIN sessions s ON s.id = sc.session_id
                 WHERE s.repository IS NOT NULL
                 GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT 20"
            )?;
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        };

        let by_tool_name = {
            let mut stmt = self.conn.prepare(
                "SELECT tool_name, COUNT(*) FROM search_content
                 WHERE tool_name IS NOT NULL
                 GROUP BY tool_name ORDER BY COUNT(*) DESC LIMIT 20"
            )?;
            stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect()
        };

        let total_matches: i64 = self.conn
            .query_row("SELECT COUNT(*) FROM search_content", [], |row| row.get(0))
            .unwrap_or(0);

        let session_count: i64 = self.conn
            .query_row("SELECT COUNT(DISTINCT session_id) FROM search_content", [], |row| row.get(0))
            .unwrap_or(0);

        Ok(SearchFacets {
            by_content_type,
            by_repository,
            by_tool_name,
            total_matches,
            session_count,
        })
    }

    /// Helper for facet count queries with parameterized filters.
    fn facet_query(
        &self,
        sql: &str,
        sanitized_query: &str,
        filters: &SearchFilters,
    ) -> Result<Vec<(String, i64)>> {
        let mut params: Vec<Box<dyn ToSql>> = vec![Box::new(sanitized_query.to_string())];
        append_filter_params(filters, &mut params);

        let mut stmt = self.conn.prepare(sql)?;
        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let results: Vec<(String, i64)> = stmt
            .query_map(params_from_iter(refs), |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(results)
    }
}

/// Build additional WHERE clauses from filters (for facet queries).
/// Uses numbered params starting after ?1 (which is the FTS MATCH query).
fn build_filter_where(filters: &SearchFilters) -> String {
    let mut parts = Vec::new();
    let mut param_idx = 2; // ?1 is the FTS query

    if let Some(ref _sid) = filters.session_id {
        parts.push(format!("AND sc.session_id = ?{}", param_idx));
        param_idx += 1;
    }
    if filters.date_from_unix.is_some() {
        parts.push(format!("AND sc.timestamp_unix >= ?{}", param_idx));
        param_idx += 1;
    }
    if filters.date_to_unix.is_some() {
        parts.push(format!("AND sc.timestamp_unix <= ?{}", param_idx));
        param_idx += 1;
    }
    if !filters.content_types.is_empty() {
        let placeholders: Vec<String> = filters
            .content_types
            .iter()
            .map(|_| {
                let p = format!("?{}", param_idx);
                param_idx += 1;
                p
            })
            .collect();
        parts.push(format!("AND sc.content_type IN ({})", placeholders.join(", ")));
    }
    if !filters.repositories.is_empty() {
        let placeholders: Vec<String> = filters
            .repositories
            .iter()
            .map(|_| {
                let p = format!("?{}", param_idx);
                param_idx += 1;
                p
            })
            .collect();
        parts.push(format!("AND s.repository IN ({})", placeholders.join(", ")));
    }
    if !filters.tool_names.is_empty() {
        let placeholders: Vec<String> = filters
            .tool_names
            .iter()
            .map(|_| {
                let p = format!("?{}", param_idx);
                param_idx += 1;
                p
            })
            .collect();
        parts.push(format!("AND sc.tool_name IN ({})", placeholders.join(", ")));
    }

    parts.join(" ")
}

/// Append filter values as params (matching the order in build_filter_where).
fn append_filter_params(filters: &SearchFilters, params: &mut Vec<Box<dyn ToSql>>) {
    if let Some(ref sid) = filters.session_id {
        params.push(Box::new(sid.clone()));
    }
    if let Some(from) = filters.date_from_unix {
        params.push(Box::new(from));
    }
    if let Some(to) = filters.date_to_unix {
        params.push(Box::new(to));
    }
    for ct in &filters.content_types {
        params.push(Box::new(ct.clone()));
    }
    for repo in &filters.repositories {
        params.push(Box::new(repo.clone()));
    }
    for tn in &filters.tool_names {
        params.push(Box::new(tn.clone()));
    }
}

/// Append filter clauses using anonymous `?` placeholders (for browse queries
/// that don't use numbered params). Appends both SQL fragments and param values.
fn append_sql_filters(
    sql: &mut String,
    params: &mut Vec<Box<dyn ToSql>>,
    filters: &SearchFilters,
) {
    if !filters.content_types.is_empty() {
        let placeholders = filters.content_types.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        sql.push_str(&format!(" AND sc.content_type IN ({})", placeholders));
        for ct in &filters.content_types {
            params.push(Box::new(ct.clone()));
        }
    }
    if !filters.repositories.is_empty() {
        let placeholders = filters.repositories.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        sql.push_str(&format!(" AND s.repository IN ({})", placeholders));
        for repo in &filters.repositories {
            params.push(Box::new(repo.clone()));
        }
    }
    if !filters.tool_names.is_empty() {
        let placeholders = filters.tool_names.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        sql.push_str(&format!(" AND sc.tool_name IN ({})", placeholders));
        for tn in &filters.tool_names {
            params.push(Box::new(tn.clone()));
        }
    }
    if let Some(ref sid) = filters.session_id {
        sql.push_str(" AND sc.session_id = ?");
        params.push(Box::new(sid.clone()));
    }
    if let Some(from) = filters.date_from_unix {
        sql.push_str(" AND sc.timestamp_unix >= ?");
        params.push(Box::new(from));
    }
    if let Some(to) = filters.date_to_unix {
        sql.push_str(" AND sc.timestamp_unix <= ?");
        params.push(Box::new(to));
    }
}

/// Sanitize a user query for safe FTS5 MATCH usage.
///
/// FTS5 has a specific query syntax. Raw user input can cause parse errors.
/// This function handles:
/// - Balanced quotes (phrase search), including mixed phrases + terms
/// - Prefix queries (word*)
/// - Boolean operators (AND, OR, NOT)
/// - Stripping problematic characters (parentheses, colons, carets)
/// - Leading NOT protection
/// - Adjacent operator prevention
pub fn sanitize_fts_query(query: &str) -> String {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // Strip characters that are problematic for FTS5 (but preserve quotes and *)
    let cleaned: String = trimmed
        .chars()
        .map(|c| match c {
            '(' | ')' | '{' | '}' | '[' | ']' | ':' | '^' | '~' => ' ',
            _ => c,
        })
        .collect();

    // Parse into tokens, preserving quoted phrases
    let mut tokens: Vec<String> = Vec::new();
    let mut chars = cleaned.chars().peekable();
    let mut current = String::new();

    while let Some(c) = chars.next() {
        if c == '"' {
            // Start of a quoted phrase — collect until closing quote or end
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
            let mut phrase = String::from('"');
            let mut closed = false;
            for inner in chars.by_ref() {
                if inner == '"' {
                    phrase.push('"');
                    closed = true;
                    break;
                }
                phrase.push(inner);
            }
            if !closed {
                // Unclosed quote — treat as plain tokens (strip the leading quote)
                let plain = phrase[1..].to_string();
                for word in plain.split_whitespace() {
                    if !word.is_empty() {
                        tokens.push(word.to_string());
                    }
                }
            } else {
                // Valid quoted phrase
                let inner = &phrase[1..phrase.len() - 1];
                if !inner.trim().is_empty() {
                    tokens.push(phrase);
                }
            }
        } else if c.is_whitespace() {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
        } else {
            current.push(c);
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }

    if tokens.is_empty() {
        return String::new();
    }

    // Process tokens: handle operators, strip NEAR, validate
    let operators = ["AND", "OR", "NOT"];
    let mut result_tokens: Vec<String> = Vec::new();
    let mut last_was_operator = true; // treat start as "operator" to prevent leading NOT

    for token in &tokens {
        // Quoted phrases pass through directly
        if token.starts_with('"') && token.ends_with('"') {
            result_tokens.push(token.clone());
            last_was_operator = false;
            continue;
        }

        let upper = token.to_uppercase();

        // Handle boolean operators
        if operators.contains(&upper.as_str()) {
            // Skip if: leading position, adjacent to another operator, or would be trailing
            if last_was_operator {
                continue;
            }
            result_tokens.push(upper);
            last_was_operator = true;
            continue;
        }

        // Strip NEAR() — too complex for user input
        if upper.starts_with("NEAR") {
            continue;
        }

        // Regular term — strip any remaining quotes
        let clean = token.replace('"', "");
        if !clean.is_empty() {
            result_tokens.push(clean);
            last_was_operator = false;
        }
    }

    if result_tokens.is_empty() {
        return String::new();
    }

    // Ensure we don't end with an operator
    while result_tokens
        .last()
        .map(|t| operators.contains(&t.as_str()))
        .unwrap_or(false)
    {
        result_tokens.pop();
    }

    result_tokens.join(" ")
}

/// Convert FTS5 snippet sentinel markers into safe HTML-escapable markers.
/// Input uses `\x01MARK_OPEN\x01` and `\x01MARK_CLOSE\x01` sentinels.
/// Output uses `<mark>` / `</mark>` after escaping the content.
fn sanitize_snippet(raw: &str) -> String {
    // First, HTML-escape the content (but preserve our sentinels)
    let escaped = raw
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");

    // Then replace sentinels with HTML marks
    escaped
        .replace("\x01MARK_OPEN\x01", "<mark>")
        .replace("\x01MARK_CLOSE\x01", "</mark>")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── sanitize_fts_query tests ────────────────────────────────────

    #[test]
    fn test_sanitize_simple_query() {
        assert_eq!(sanitize_fts_query("hello world"), "hello world");
    }

    #[test]
    fn test_sanitize_phrase_query() {
        assert_eq!(
            sanitize_fts_query("\"file not found\""),
            "\"file not found\""
        );
    }

    #[test]
    fn test_sanitize_mixed_phrase_and_terms() {
        // This was the critical bug: previously destroyed embedded phrases
        assert_eq!(
            sanitize_fts_query("error \"file not found\""),
            "error \"file not found\""
        );
        assert_eq!(
            sanitize_fts_query("\"hello world\" foo bar"),
            "\"hello world\" foo bar"
        );
        assert_eq!(
            sanitize_fts_query("before \"middle phrase\" after"),
            "before \"middle phrase\" after"
        );
    }

    #[test]
    fn test_sanitize_boolean_operators() {
        assert_eq!(sanitize_fts_query("rust AND async"), "rust AND async");
        assert_eq!(sanitize_fts_query("error OR warning"), "error OR warning");
        assert_eq!(sanitize_fts_query("auth NOT jwt"), "auth NOT jwt");
    }

    #[test]
    fn test_sanitize_adjacent_operators() {
        // Adjacent operators should collapse to just the term
        assert_eq!(sanitize_fts_query("foo AND OR bar"), "foo AND bar");
        assert_eq!(sanitize_fts_query("foo OR AND bar"), "foo OR bar");
        assert_eq!(sanitize_fts_query("AND AND foo"), "foo");
    }

    #[test]
    fn test_sanitize_leading_not() {
        // Leading NOT is invalid in FTS5 — strip it
        assert_eq!(sanitize_fts_query("NOT error"), "error");
    }

    #[test]
    fn test_sanitize_leading_operators() {
        assert_eq!(sanitize_fts_query("AND foo"), "foo");
        assert_eq!(sanitize_fts_query("OR foo"), "foo");
        assert_eq!(sanitize_fts_query("NOT AND foo"), "foo");
    }

    #[test]
    fn test_sanitize_trailing_operator() {
        assert_eq!(sanitize_fts_query("hello AND"), "hello");
        assert_eq!(sanitize_fts_query("hello OR"), "hello");
        assert_eq!(sanitize_fts_query("hello NOT"), "hello");
    }

    #[test]
    fn test_sanitize_strips_problematic_chars() {
        assert_eq!(sanitize_fts_query("error(code)"), "error code");
        assert_eq!(sanitize_fts_query("field:value"), "field value");
        assert_eq!(sanitize_fts_query("a{b}c"), "a b c");
        // $ is not problematic for FTS5, so it's preserved
        assert_eq!(sanitize_fts_query("^test$"), "test$");
    }

    #[test]
    fn test_sanitize_prefix_preserved() {
        assert_eq!(sanitize_fts_query("auth*"), "auth*");
        assert_eq!(sanitize_fts_query("config*"), "config*");
    }

    #[test]
    fn test_sanitize_empty_input() {
        assert_eq!(sanitize_fts_query(""), "");
        assert_eq!(sanitize_fts_query("   "), "");
    }

    #[test]
    fn test_sanitize_near_stripped() {
        assert_eq!(sanitize_fts_query("NEAR(a b)"), "a b");
        assert_eq!(sanitize_fts_query("NEAR/5 foo"), "foo");
    }

    #[test]
    fn test_sanitize_unclosed_quote() {
        // Unclosed quote should be treated as plain words
        let result = sanitize_fts_query("\"unclosed phrase");
        assert_eq!(result, "unclosed phrase");
    }

    #[test]
    fn test_sanitize_empty_phrase() {
        // Empty quoted phrase should be dropped
        let result = sanitize_fts_query("\"\" hello");
        assert_eq!(result, "hello");
    }

    #[test]
    fn test_sanitize_case_insensitive_operators() {
        assert_eq!(sanitize_fts_query("foo and bar"), "foo AND bar");
        assert_eq!(sanitize_fts_query("foo or bar"), "foo OR bar");
        assert_eq!(sanitize_fts_query("foo not bar"), "foo NOT bar");
    }

    #[test]
    fn test_sanitize_only_operators() {
        assert_eq!(sanitize_fts_query("AND OR NOT"), "");
    }

    #[test]
    fn test_sanitize_multiple_phrases() {
        assert_eq!(
            sanitize_fts_query("\"hello world\" AND \"foo bar\""),
            "\"hello world\" AND \"foo bar\""
        );
    }

    #[test]
    fn test_sanitize_phrase_with_special_chars() {
        // Problematic chars like : are stripped even inside quotes (first pass is global)
        // This is safe — FTS5 matches on the tokenized content anyway
        assert_eq!(
            sanitize_fts_query("\"error: file not found\""),
            "\"error  file not found\""
        );
    }

    // ── sanitize_snippet tests ──────────────────────────────────────

    #[test]
    fn test_snippet_sanitization() {
        let raw = "hello \x01MARK_OPEN\x01world\x01MARK_CLOSE\x01 <script>";
        let result = sanitize_snippet(raw);
        assert_eq!(
            result,
            "hello <mark>world</mark> &lt;script&gt;"
        );
    }

    #[test]
    fn test_snippet_no_markers() {
        assert_eq!(sanitize_snippet("plain text"), "plain text");
    }

    #[test]
    fn test_snippet_html_entities() {
        let raw = "a < b & c > d";
        assert_eq!(sanitize_snippet(raw), "a &lt; b &amp; c &gt; d");
    }

    #[test]
    fn test_snippet_multiple_marks() {
        let raw = "\x01MARK_OPEN\x01a\x01MARK_CLOSE\x01 b \x01MARK_OPEN\x01c\x01MARK_CLOSE\x01";
        assert_eq!(sanitize_snippet(raw), "<mark>a</mark> b <mark>c</mark>");
    }
}
