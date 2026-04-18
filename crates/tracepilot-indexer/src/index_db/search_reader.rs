//! Deep FTS query builder and result reader.
//!
//! Provides parameterized search across `search_content` + `search_fts`,
//! with filtering by content type, session, tool name, date range, and
//! repository. Results include highlighted snippets and pagination.
//!
//! Supports two search modes:
//! - **FTS**: Full-text search via `search_fts` table (default)
//! - **Browse**: Filter-only queries without FTS MATCH (empty query)

use crate::Result;
use rusqlite::{params_from_iter, types::ToSql};

use super::IndexDb;
use super::row_helpers::context_snippet_from_row;

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
    pub exclude_content_types: Vec<String>,
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

/// Detailed FTS health information.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FtsHealthInfo {
    pub total_content_rows: i64,
    pub fts_index_rows: i64,
    pub indexed_sessions: i64,
    pub total_sessions: i64,
    pub pending_sessions: i64,
    pub in_sync: bool,
    pub content_types: Vec<(String, i64)>,
    pub db_size_bytes: i64,
}

/// A context snippet for surrounding results.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnippet {
    pub id: i64,
    pub content_type: String,
    pub turn_number: Option<i64>,
    pub event_index: Option<i64>,
    pub tool_name: Option<String>,
    pub preview: String,
}

// ── SearchQueryBuilder ──────────────────────────────────────────

/// Builder for constructing SQL search queries with type-safe parameter binding.
///
/// Consolidates query construction logic that was previously duplicated across
/// `query_content`, `query_count`, `facet_dimension`, and `totals_query`.
///
/// # Example
/// ```ignore
/// let (sql, params) = SearchQueryBuilder::new("SELECT * FROM ...", true)
///     .with_fts_match("error message")
///     .with_filters(&filters)
///     .with_sort(Some("newest"))
///     .with_pagination(50, 0)
///     .build();
/// ```
struct SearchQueryBuilder {
    base_query: String,
    from_clause: &'static str,
    is_fts: bool,
    where_clauses: Vec<String>,
    params: Vec<Box<dyn ToSql>>,
    order_by: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

impl SearchQueryBuilder {
    /// Create a new query builder.
    ///
    /// # Arguments
    /// * `base_select` - The SELECT and FROM portion (e.g., "SELECT * FROM ...")
    /// * `is_fts` - Whether this is an FTS query (affects FROM clause)
    fn new(base_select: &str, is_fts: bool) -> Self {
        Self {
            base_query: base_select.to_string(),
            from_clause: build_from_clause(is_fts),
            is_fts,
            where_clauses: Vec::new(),
            params: Vec::new(),
            order_by: None,
            limit: None,
            offset: None,
        }
    }

    /// Add FTS MATCH clause if query is provided.
    fn with_fts_match(mut self, query: &str) -> Self {
        self.where_clauses.push("search_fts MATCH ?".to_string());
        self.params.push(Box::new(query.to_string()));
        self
    }

    /// Add FTS MATCH clause only if query is Some.
    fn with_optional_fts_match(mut self, query: Option<&str>) -> Self {
        if let Some(q) = query {
            self = self.with_fts_match(q);
        }
        self
    }

    /// Add an IN-filter for a list of values.
    ///
    /// Generates `column IN (?, ?, ...)` with one placeholder per value.
    /// Empty value lists are ignored (no-op).
    fn add_in_filter<T: ToString>(mut self, column: &str, values: &[T]) -> Self {
        if values.is_empty() {
            return self;
        }
        let placeholders = values.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        self.where_clauses
            .push(format!("{} IN ({})", column, placeholders));
        for val in values {
            self.params.push(Box::new(val.to_string()));
        }
        self
    }

    /// Add a NOT IN-filter for a list of values.
    ///
    /// Generates `column NOT IN (?, ?, ...)` with one placeholder per value.
    /// Empty value lists are ignored (no-op).
    fn add_not_in_filter<T: ToString>(mut self, column: &str, values: &[T]) -> Self {
        if values.is_empty() {
            return self;
        }
        let placeholders = values.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        self.where_clauses
            .push(format!("{} NOT IN ({})", column, placeholders));
        for val in values {
            self.params.push(Box::new(val.to_string()));
        }
        self
    }

    /// Add standard search filters (content types, repositories, tools, dates, session ID).
    fn with_filters(mut self, filters: &SearchFilters) -> Self {
        // Use helper methods for IN-filters
        self = self.add_in_filter("sc.content_type", &filters.content_types);
        self = self.add_not_in_filter("sc.content_type", &filters.exclude_content_types);
        self = self.add_in_filter("s.repository", &filters.repositories);
        self = self.add_in_filter("sc.tool_name", &filters.tool_names);

        // Build equality filter for session_id
        if let Some(ref sid) = filters.session_id {
            self.where_clauses.push("sc.session_id = ?".to_string());
            self.params.push(Box::new(sid.clone()));
        }

        // Build timestamp range filters
        if let Some(from_unix) = filters.date_from_unix {
            self.where_clauses
                .push("sc.timestamp_unix >= ?".to_string());
            self.params.push(Box::new(from_unix));
        }
        if let Some(to_unix) = filters.date_to_unix {
            self.where_clauses
                .push("sc.timestamp_unix <= ?".to_string());
            self.params.push(Box::new(to_unix));
        }

        self
    }

    /// Add a single extra WHERE clause with additional parameters.
    fn with_extra_where(mut self, clause: &str) -> Self {
        if !clause.is_empty() {
            self.where_clauses.push(clause.to_string());
        }
        self
    }

    /// Add ORDER BY clause.
    ///
    /// For FTS queries with no explicit sort, applies relevance-weighted ranking.
    fn with_sort(mut self, sort_by: Option<&str>) -> Self {
        match sort_by {
            Some("newest") => {
                self.order_by = Some("ORDER BY sc.timestamp_unix DESC NULLS LAST".to_string());
            }
            Some("oldest") => {
                self.order_by = Some("ORDER BY sc.timestamp_unix ASC NULLS LAST".to_string());
            }
            _ if self.is_fts => {
                // Relevance-weighted ranking for FTS queries
                self.order_by = Some(
                    "ORDER BY CASE sc.content_type \
                        WHEN 'user_message' THEN rank * 2.0 \
                        WHEN 'error' THEN rank * 2.0 \
                        WHEN 'tool_error' THEN rank * 1.8 \
                        WHEN 'assistant_message' THEN rank * 1.5 \
                        WHEN 'reasoning' THEN rank * 1.3 \
                        WHEN 'compaction_summary' THEN rank * 1.1 \
                        WHEN 'subagent' THEN rank * 1.1 \
                        WHEN 'system_message' THEN rank * 1.0 \
                        WHEN 'tool_call' THEN rank * 0.6 \
                        WHEN 'tool_result' THEN rank * 0.7 \
                        ELSE rank END"
                        .to_string(),
                );
            }
            _ => {
                // Default: newest first
                self.order_by = Some("ORDER BY sc.timestamp_unix DESC NULLS LAST".to_string());
            }
        }
        self
    }

    /// Add LIMIT and OFFSET clauses.
    fn with_pagination(mut self, limit: usize, offset: usize) -> Self {
        self.limit = Some(limit as i64);
        self.offset = Some(offset as i64);
        self
    }

    /// Add a GROUP BY and optional ORDER BY clause to the query.
    ///
    /// This replaces any existing order_by with GROUP BY + optional order.
    fn with_group_by(mut self, group_by: &str, order_by: Option<&str>) -> Self {
        let order_part = order_by.unwrap_or("");
        self.order_by = Some(format!("GROUP BY {} {}", group_by, order_part));
        self
    }

    /// Add a LIMIT clause (without pagination - just limit, no offset).
    fn with_limit(mut self, limit: usize) -> Self {
        self.limit = Some(limit as i64);
        self
    }

    /// Build the final SQL query and parameter vector.
    ///
    /// Returns `(sql_string, params)` ready for execution.
    fn build(mut self) -> (String, Vec<Box<dyn ToSql>>) {
        let mut sql = format!("{} {}", self.base_query, self.from_clause);

        // Build WHERE clause
        if !self.where_clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&self.where_clauses.join(" AND "));
        } else {
            sql.push_str(" WHERE 1=1");
        }

        // Add GROUP BY / ORDER BY
        if let Some(ref order) = self.order_by {
            sql.push(' ');
            sql.push_str(order);
        }

        // Add LIMIT (and OFFSET if both are set)
        if let Some(lim) = self.limit {
            sql.push_str(" LIMIT ?");
            self.params.push(Box::new(lim));

            // Only add OFFSET if it was set via with_pagination
            if let Some(off) = self.offset {
                sql.push_str(" OFFSET ?");
                self.params.push(Box::new(off));
            }
        }

        (sql, self.params)
    }
}

impl IndexDb {
    // ── Unified query methods ───────────────────────────────────────

    /// Query content with optional FTS. When `query` is `Some` and non-empty
    /// after sanitization, uses FTS MATCH; otherwise falls back to browse mode.
    pub fn query_content(
        &self,
        query: Option<&str>,
        filters: &SearchFilters,
    ) -> Result<Vec<SearchResult>> {
        let sanitized = query.map(sanitize_fts_query).filter(|s| !s.is_empty());
        let is_fts = sanitized.is_some();

        let snippet_col = if is_fts {
            "snippet(search_fts, 0, '\x01MARK_OPEN\x01', '\x01MARK_CLOSE\x01', '…', 48)"
        } else {
            "CASE WHEN LENGTH(sc.content) > 200 \
                  THEN SUBSTR(sc.content, 1, 200) || '…' \
                  ELSE sc.content END"
        };

        let base_select = format!(
            "SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, \
                    sc.timestamp_unix, sc.tool_name, {snippet_col}, sc.metadata_json, \
                    s.summary, s.repository, s.branch, s.updated_at"
        );

        let limit = filters.limit.unwrap_or(50).min(200);
        let offset = filters.offset.unwrap_or(0);

        let (sql, params) = SearchQueryBuilder::new(&base_select, is_fts)
            .with_optional_fts_match(sanitized.as_deref())
            .with_filters(filters)
            .with_sort(filters.sort_by.as_deref())
            .with_pagination(limit, offset)
            .build();

        let mut stmt = self.conn.prepare(&sql)?;
        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(params_from_iter(refs), map_search_result)?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Count matching rows with optional FTS.
    pub fn query_count(&self, query: Option<&str>, filters: &SearchFilters) -> Result<i64> {
        let sanitized = query.map(sanitize_fts_query).filter(|s| !s.is_empty());
        let is_fts = sanitized.is_some();

        let (sql, params) = SearchQueryBuilder::new("SELECT COUNT(*)", is_fts)
            .with_optional_fts_match(sanitized.as_deref())
            .with_filters(filters)
            .build();

        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let count: i64 = self
            .conn
            .query_row(&sql, params_from_iter(refs), |row| row.get(0))?;
        Ok(count)
    }

    /// Get facet counts with optional FTS.
    /// Each facet dimension excludes its own filter for proper faceted navigation.
    pub fn facets(&self, query: Option<&str>, filters: &SearchFilters) -> Result<SearchFacets> {
        let sanitized = query.map(sanitize_fts_query).filter(|s| !s.is_empty());

        let by_content_type = {
            let excl = SearchFilters {
                content_types: Vec::new(),
                ..filters.clone()
            };
            self.facet_dimension("sc.content_type", None, None, sanitized.as_deref(), &excl)?
        };

        let by_repository = {
            let excl = SearchFilters {
                repositories: Vec::new(),
                ..filters.clone()
            };
            self.facet_dimension(
                "s.repository",
                Some("s.repository IS NOT NULL"),
                Some(20),
                sanitized.as_deref(),
                &excl,
            )?
        };

        let by_tool_name = {
            let excl = SearchFilters {
                tool_names: Vec::new(),
                ..filters.clone()
            };
            self.facet_dimension(
                "sc.tool_name",
                Some("sc.tool_name IS NOT NULL"),
                Some(20),
                sanitized.as_deref(),
                &excl,
            )?
        };

        // Total matches and distinct sessions
        let (total_matches, session_count) = self.totals_query(sanitized.as_deref(), filters)?;

        Ok(SearchFacets {
            by_content_type,
            by_repository,
            by_tool_name,
            total_matches,
            session_count,
        })
    }

    // ── Private helpers ─────────────────────────────────────────────

    /// Run a single facet-dimension query (content_type, repository, or tool_name).
    fn facet_dimension(
        &self,
        column: &str,
        extra_where: Option<&str>,
        limit: Option<usize>,
        sanitized_query: Option<&str>,
        filters: &SearchFilters,
    ) -> Result<Vec<(String, i64)>> {
        let is_fts = sanitized_query.is_some();
        let base_select = format!("SELECT {column}, COUNT(*)");

        let mut builder =
            SearchQueryBuilder::new(&base_select, is_fts).with_optional_fts_match(sanitized_query);

        if let Some(extra) = extra_where {
            builder = builder.with_extra_where(extra);
        }

        builder = builder
            .with_filters(filters)
            .with_group_by(column, Some("ORDER BY COUNT(*) DESC"));

        if let Some(n) = limit {
            builder = builder.with_limit(n);
        }

        let (sql, params) = builder.build();

        let mut stmt = self.conn.prepare(&sql)?;
        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_from_iter(refs), |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Run the totals sub-query (COUNT + COUNT DISTINCT session_id).
    fn totals_query(
        &self,
        sanitized_query: Option<&str>,
        filters: &SearchFilters,
    ) -> Result<(i64, i64)> {
        let is_fts = sanitized_query.is_some();

        let (sql, params) =
            SearchQueryBuilder::new("SELECT COUNT(*), COUNT(DISTINCT sc.session_id)", is_fts)
                .with_optional_fts_match(sanitized_query)
                .with_filters(filters)
                .build();

        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        Ok(self.conn.query_row(&sql, params_from_iter(refs), |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?)
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

    /// Get distinct tool names from search content.
    pub fn search_tool_names(&self) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT tool_name FROM search_content WHERE tool_name IS NOT NULL ORDER BY tool_name",
        )?;
        let rows = stmt.query_map([], |row| row.get(0))?;
        let mut names = Vec::new();
        for row in rows {
            names.push(row?);
        }
        Ok(names)
    }

    /// Get content type facet counts (without a search query).
    pub fn query_content_type_facets(&self) -> Result<Vec<(String, i64)>> {
        let mut stmt = self.conn.prepare(
            "SELECT content_type, COUNT(*) FROM search_content GROUP BY content_type ORDER BY COUNT(*) DESC",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Get repository facet counts (without a search query).
    pub fn query_repository_facets(&self) -> Result<Vec<(String, i64)>> {
        let mut stmt = self.conn.prepare(
            "SELECT s.repository, COUNT(*) FROM search_content sc \
             JOIN sessions s ON s.id = sc.session_id \
             WHERE s.repository IS NOT NULL \
             GROUP BY s.repository ORDER BY COUNT(*) DESC LIMIT 20",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }

    /// Get tool name facet counts (without a search query).
    pub fn query_tool_name_facets(&self) -> Result<Vec<(String, i64)>> {
        let mut stmt = self.conn.prepare(
            "SELECT tool_name, COUNT(*) FROM search_content \
             WHERE tool_name IS NOT NULL \
             GROUP BY tool_name ORDER BY COUNT(*) DESC LIMIT 20",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
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
        let mut before_stmt = self.conn.prepare(
            "SELECT id, content_type, turn_number, event_index, tool_name, substr(content, 1, 300)
             FROM search_content
             WHERE session_id = ?1 AND event_index < ?2 AND event_index IS NOT NULL
             ORDER BY event_index DESC LIMIT ?3",
        )?;
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
        let mut after_stmt = self.conn.prepare(
            "SELECT id, content_type, turn_number, event_index, tool_name, substr(content, 1, 300)
             FROM search_content
             WHERE session_id = ?1 AND event_index > ?2 AND event_index IS NOT NULL
             ORDER BY event_index ASC LIMIT ?3",
        )?;
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

// ── Shared helpers ──────────────────────────────────────────────

/// Build the FROM clause for search queries.
/// When `is_fts` is true, joins through search_fts for full-text matching.
/// When false, queries search_content directly for browse-mode filtering.
#[inline]
fn build_from_clause(is_fts: bool) -> &'static str {
    if is_fts {
        "FROM search_fts \
         JOIN search_content sc ON sc.id = search_fts.rowid \
         JOIN sessions s ON s.id = sc.session_id"
    } else {
        "FROM search_content sc \
         JOIN sessions s ON s.id = sc.session_id"
    }
}

/// Map a rusqlite row to a `SearchResult`.
fn map_search_result(row: &rusqlite::Row<'_>) -> rusqlite::Result<SearchResult> {
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

    // Strip characters that are problematic for FTS5 — only keep alphanumeric,
    // whitespace, quotes (for phrases), * (for prefix), and basic separators.
    // The unicode61 tokenizer treats most punctuation as separators anyway.
    let cleaned: String = trimmed
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '"' || c == '*' || c == '_' || c.is_whitespace() {
                c
            } else {
                ' '
            }
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

        // Regular term — strip any remaining quotes and normalize wildcards
        let clean = token.replace('"', "");
        // Only allow a single trailing * on terms with at least one alphanumeric char
        let normalized = if clean.contains('*') {
            let base: String = clean.chars().filter(|c| *c != '*').collect();
            if base.chars().any(|c| c.is_alphanumeric()) {
                format!("{}*", base)
            } else {
                continue; // bare * or ** with no real content
            }
        } else {
            clean
        };
        if !normalized.is_empty() {
            result_tokens.push(normalized);
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

    // ── SearchQueryBuilder helper method tests ─────────────────────

    #[test]
    fn test_add_in_filter_single_value() {
        let builder = SearchQueryBuilder::new("SELECT *", false);
        let (sql, params) = builder
            .add_in_filter("col", &vec!["value1".to_string()])
            .build();

        assert!(sql.contains("col IN (?)"));
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_add_in_filter_multiple_values() {
        let builder = SearchQueryBuilder::new("SELECT *", false);
        let (sql, params) = builder
            .add_in_filter(
                "col",
                &vec!["val1".to_string(), "val2".to_string(), "val3".to_string()],
            )
            .build();

        assert!(sql.contains("col IN (?, ?, ?)"));
        assert_eq!(params.len(), 3);
    }

    #[test]
    fn test_add_in_filter_empty_values() {
        let builder = SearchQueryBuilder::new("SELECT *", false);
        let empty_vec: Vec<String> = vec![];
        let (sql, params) = builder.add_in_filter("col", &empty_vec).build();

        // Empty filter should not add WHERE clause
        assert!(!sql.contains("col IN"));
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn test_add_not_in_filter_single_value() {
        let builder = SearchQueryBuilder::new("SELECT *", false);
        let (sql, params) = builder
            .add_not_in_filter("col", &vec!["exclude1".to_string()])
            .build();

        assert!(sql.contains("col NOT IN (?)"));
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_add_not_in_filter_multiple_values() {
        let builder = SearchQueryBuilder::new("SELECT *", false);
        let (sql, params) = builder
            .add_not_in_filter("col", &vec!["exc1".to_string(), "exc2".to_string()])
            .build();

        assert!(sql.contains("col NOT IN (?, ?)"));
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn test_add_not_in_filter_empty_values() {
        let builder = SearchQueryBuilder::new("SELECT *", false);
        let empty_vec: Vec<String> = vec![];
        let (sql, params) = builder.add_not_in_filter("col", &empty_vec).build();

        // Empty filter should not add WHERE clause
        assert!(!sql.contains("col NOT IN"));
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn test_combined_in_filters() {
        let builder = SearchQueryBuilder::new("SELECT *", false);
        let (sql, params) = builder
            .add_in_filter("col1", &vec!["a".to_string()])
            .add_not_in_filter("col2", &vec!["b".to_string(), "c".to_string()])
            .add_in_filter(
                "col3",
                &vec!["d".to_string(), "e".to_string(), "f".to_string()],
            )
            .build();

        assert!(sql.contains("col1 IN (?)"));
        assert!(sql.contains("col2 NOT IN (?, ?)"));
        assert!(sql.contains("col3 IN (?, ?, ?)"));
        assert_eq!(params.len(), 6);
    }

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
        assert_eq!(sanitize_fts_query("^test$"), "test");
        // Slashes and other punctuation are stripped to prevent FTS5 errors
        assert_eq!(sanitize_fts_query("path/to/file"), "path to file");
        assert_eq!(sanitize_fts_query("a+b-c"), "a b c");
    }

    #[test]
    fn test_sanitize_prefix_preserved() {
        assert_eq!(sanitize_fts_query("auth*"), "auth*");
        assert_eq!(sanitize_fts_query("config*"), "config*");
    }

    #[test]
    fn test_sanitize_invalid_wildcards() {
        // Leading wildcard — normalized to trailing
        assert_eq!(sanitize_fts_query("*foo"), "foo*");
        // Double wildcard — collapsed to single trailing
        assert_eq!(sanitize_fts_query("foo**"), "foo*");
        // Bare wildcard — dropped entirely
        assert_eq!(sanitize_fts_query("*"), "");
        // Double bare wildcard — dropped
        assert_eq!(sanitize_fts_query("**"), "");
        // Wildcard with valid context preserved
        assert_eq!(sanitize_fts_query("err* AND warn*"), "err* AND warn*");
    }

    #[test]
    fn test_sanitize_empty_input() {
        assert_eq!(sanitize_fts_query(""), "");
        assert_eq!(sanitize_fts_query("   "), "");
    }

    #[test]
    fn test_sanitize_near_stripped() {
        assert_eq!(sanitize_fts_query("NEAR(a b)"), "a b");
        // / becomes space, so "NEAR/5" → "NEAR 5"; NEAR is stripped, 5 is kept as a term
        assert_eq!(sanitize_fts_query("NEAR/5 foo"), "5 foo");
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
        assert_eq!(result, "hello <mark>world</mark> &lt;script&gt;");
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

    /// Build an IndexDb backed by an in-memory SQLite connection using the provided schema/data.
    fn build_db_with_fixture(sql: &str) -> IndexDb {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(sql).unwrap();
        IndexDb { conn }
    }

    #[test]
    fn search_stats_propagates_row_errors_in_content_type_counts() {
        let db = build_db_with_fixture(
            "CREATE TABLE search_content (id INTEGER PRIMARY KEY, content_type TEXT);
             CREATE TABLE sessions (id INTEGER PRIMARY KEY, repository TEXT, search_indexed_at TEXT);
             INSERT INTO sessions(id, repository) VALUES (1, 'repo');
             INSERT INTO search_content(id, content_type) VALUES (1, NULL);",
        );

        let result = db.search_stats();
        assert!(
            result.is_err(),
            "row-level errors should surface instead of being dropped silently"
        );
    }

    #[test]
    fn facets_propagate_row_errors_from_dimension_queries() {
        let db = build_db_with_fixture(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, repository TEXT);
             CREATE TABLE search_content (
                 id INTEGER PRIMARY KEY,
                 session_id TEXT,
                 content_type TEXT,
                 tool_name TEXT,
                 timestamp_unix INTEGER,
                 event_index INTEGER
             );
             INSERT INTO sessions (id, repository) VALUES ('s1', 'repo');
             INSERT INTO search_content (id, session_id, content_type) VALUES (1, 's1', NULL);",
        );

        let result = db.facets(None, &SearchFilters::default());
        assert!(
            result.is_err(),
            "facet queries should propagate row mapping errors"
        );
    }

    // ── SearchQueryBuilder tests ───────────────────────────────────

    #[test]
    fn test_builder_basic_construction() {
        let (sql, params) = SearchQueryBuilder::new("SELECT *", false).build();

        assert!(sql.contains("FROM search_content sc"));
        assert!(sql.contains("JOIN sessions s"));
        assert!(sql.contains("WHERE 1=1"));
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn test_builder_fts_mode() {
        let (sql, params) = SearchQueryBuilder::new("SELECT *", true).build();

        assert!(sql.contains("FROM search_fts"));
        assert!(sql.contains("JOIN search_content sc ON sc.id = search_fts.rowid"));
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn test_builder_with_fts_match() {
        let (sql, params) = SearchQueryBuilder::new("SELECT *", true)
            .with_fts_match("error message")
            .build();

        assert!(sql.contains("WHERE search_fts MATCH ?"));
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_builder_with_optional_fts_match_some() {
        let (sql, params) = SearchQueryBuilder::new("SELECT *", true)
            .with_optional_fts_match(Some("test query"))
            .build();

        assert!(sql.contains("WHERE search_fts MATCH ?"));
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_builder_with_optional_fts_match_none() {
        let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
            .with_optional_fts_match(None)
            .build();

        assert!(sql.contains("WHERE 1=1"));
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn test_builder_with_filters() {
        let filters = SearchFilters {
            content_types: vec!["user_message".to_string(), "assistant_message".to_string()],
            repositories: vec!["org/repo".to_string()],
            session_id: Some("session-123".to_string()),
            ..Default::default()
        };

        let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
            .with_filters(&filters)
            .build();

        assert!(sql.contains("sc.content_type IN (?, ?)"));
        assert!(sql.contains("s.repository IN (?)"));
        assert!(sql.contains("sc.session_id = ?"));
        assert_eq!(params.len(), 4); // 2 content types + 1 repo + 1 session_id
    }

    #[test]
    fn test_builder_with_exclude_filters() {
        let filters = SearchFilters {
            exclude_content_types: vec!["tool_call".to_string(), "tool_result".to_string()],
            ..Default::default()
        };

        let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
            .with_filters(&filters)
            .build();

        assert!(sql.contains("sc.content_type NOT IN (?, ?)"));
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn test_builder_with_date_range() {
        let filters = SearchFilters {
            date_from_unix: Some(1700000000),
            date_to_unix: Some(1700100000),
            ..Default::default()
        };

        let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
            .with_filters(&filters)
            .build();

        assert!(sql.contains("sc.timestamp_unix >= ?"));
        assert!(sql.contains("sc.timestamp_unix <= ?"));
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn test_builder_with_sort_newest() {
        let (sql, _) = SearchQueryBuilder::new("SELECT *", false)
            .with_sort(Some("newest"))
            .build();

        assert!(sql.contains("ORDER BY sc.timestamp_unix DESC NULLS LAST"));
    }

    #[test]
    fn test_builder_with_sort_oldest() {
        let (sql, _) = SearchQueryBuilder::new("SELECT *", false)
            .with_sort(Some("oldest"))
            .build();

        assert!(sql.contains("ORDER BY sc.timestamp_unix ASC NULLS LAST"));
    }

    #[test]
    fn test_builder_with_sort_relevance_fts() {
        let (sql, _) = SearchQueryBuilder::new("SELECT *", true)
            .with_sort(None)
            .build();

        assert!(sql.contains("ORDER BY CASE sc.content_type"));
        assert!(sql.contains("WHEN 'user_message' THEN rank * 2.0"));
        assert!(sql.contains("WHEN 'error' THEN rank * 2.0"));
    }

    #[test]
    fn test_builder_with_pagination() {
        let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
            .with_pagination(50, 100)
            .build();

        assert!(sql.contains("LIMIT ?"));
        assert!(sql.contains("OFFSET ?"));
        // Params from pagination are added at the end
        assert!(params.len() >= 2);
    }

    #[test]
    fn test_builder_with_limit_only() {
        let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
            .with_limit(20)
            .build();

        assert!(sql.contains("LIMIT ?"));
        assert!(!sql.contains("OFFSET"));
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_builder_with_group_by() {
        let (sql, _) = SearchQueryBuilder::new("SELECT column, COUNT(*)", false)
            .with_group_by("column", Some("ORDER BY COUNT(*) DESC"))
            .build();

        assert!(sql.contains("GROUP BY column"));
        assert!(sql.contains("ORDER BY COUNT(*) DESC"));
    }

    #[test]
    fn test_builder_with_extra_where() {
        let (sql, _) = SearchQueryBuilder::new("SELECT *", false)
            .with_extra_where("s.repository IS NOT NULL")
            .build();

        assert!(sql.contains("s.repository IS NOT NULL"));
    }

    #[test]
    fn test_builder_complex_query() {
        // Test a realistic complex query combining multiple features
        let filters = SearchFilters {
            content_types: vec!["error".to_string()],
            repositories: vec!["org/repo-a".to_string(), "org/repo-b".to_string()],
            date_from_unix: Some(1700000000),
            tool_names: vec!["read_file".to_string()],
            ..Default::default()
        };

        let (sql, params) = SearchQueryBuilder::new("SELECT sc.id, sc.content", true)
            .with_fts_match("authentication failed")
            .with_filters(&filters)
            .with_sort(Some("newest"))
            .with_pagination(25, 50)
            .build();

        // Verify structure
        assert!(sql.contains("FROM search_fts"));
        assert!(sql.contains("WHERE search_fts MATCH ?"));
        assert!(sql.contains("sc.content_type IN (?)"));
        assert!(sql.contains("s.repository IN (?, ?)"));
        assert!(sql.contains("sc.timestamp_unix >= ?"));
        assert!(sql.contains("sc.tool_name IN (?)"));
        assert!(sql.contains("ORDER BY sc.timestamp_unix DESC"));
        assert!(sql.contains("LIMIT ?"));
        assert!(sql.contains("OFFSET ?"));

        // Verify params: 1 FTS query + 1 content_type + 2 repos + 1 date + 1 tool + limit + offset = 8
        assert_eq!(params.len(), 8);
    }

    #[test]
    fn test_builder_param_order_matches_placeholders() {
        // This test ensures params are in the right order for SQL execution
        let filters = SearchFilters {
            content_types: vec!["user_message".to_string()],
            repositories: vec!["org/repo".to_string()],
            ..Default::default()
        };

        let (sql, params) = SearchQueryBuilder::new("SELECT *", true)
            .with_fts_match("test")
            .with_filters(&filters)
            .with_pagination(10, 0)
            .build();

        let placeholder_count = sql.matches('?').count();
        assert_eq!(
            params.len(),
            placeholder_count,
            "Number of params should match number of placeholders"
        );
    }

    #[test]
    fn test_builder_empty_filters() {
        let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
            .with_filters(&SearchFilters::default())
            .build();

        // Empty filters should still produce valid SQL
        assert!(sql.contains("WHERE 1=1"));
        assert_eq!(params.len(), 0);
    }

    #[test]
    fn test_builder_method_chaining() {
        // Test that builder methods can be chained fluently
        let (sql, params) = SearchQueryBuilder::new("SELECT *", false)
            .with_optional_fts_match(None)
            .with_filters(&SearchFilters::default())
            .with_sort(Some("newest"))
            .with_pagination(10, 0)
            .build();

        assert!(sql.contains("FROM search_content sc"));
        assert!(sql.contains("ORDER BY sc.timestamp_unix DESC NULLS LAST"));
        assert!(sql.contains("LIMIT ?"));
        assert!(sql.contains("OFFSET ?"));
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn test_open_readonly_fails_on_missing_database() {
        // Test that open_readonly fails appropriately on non-existent database
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("nonexistent.db");

        // Attempting to open a non-existent database in readonly mode should fail
        let result = IndexDb::open_readonly(&db_path);
        assert!(
            result.is_err(),
            "Should fail to open non-existent database in readonly mode"
        );

        // Verify error message contains useful context
        if let Err(err) = result {
            let err_msg = err.to_string();
            assert!(
                err_msg.contains("readonly") || err_msg.contains("open"),
                "Error message should indicate readonly/open failure: {}",
                err_msg
            );
        }
    }

    #[test]
    fn test_fts_health_returns_error_on_query_failure() {
        use rusqlite::Connection;

        // Create an in-memory database without the required schema
        let conn = Connection::open_in_memory().unwrap();
        let db = IndexDb { conn };

        // Calling fts_health on a database without the required tables should error
        let result = db.fts_health();
        assert!(
            result.is_err(),
            "fts_health should return error when tables don't exist, not zeros"
        );

        // Verify the error is a database error
        match result {
            Err(crate::IndexerError::Database(e)) => {
                assert!(
                    format!("{:?}", e).contains("no such table"),
                    "Error should indicate missing table, got: {:?}",
                    e
                );
            }
            _ => panic!("Expected Database error variant"),
        }
    }

    #[test]
    fn test_search_stats_propagates_errors() {
        use rusqlite::Connection;

        // Create an in-memory database with partial schema (missing tables)
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE sessions (id TEXT)", []).unwrap();
        // Deliberately not creating search_content table

        let db = IndexDb { conn };

        // search_stats should fail when search_content table doesn't exist
        let result = db.search_stats();
        assert!(
            result.is_err(),
            "search_stats should return error when tables are missing"
        );

        // Verify error indicates the missing table
        match result {
            Err(crate::IndexerError::Database(e)) => {
                let err_msg = format!("{:?}", e);
                assert!(
                    err_msg.contains("no such table") || err_msg.contains("search_content"),
                    "Error should reference missing search_content table, got: {}",
                    err_msg
                );
            }
            _ => panic!("Expected Database error variant"),
        }
    }
}
