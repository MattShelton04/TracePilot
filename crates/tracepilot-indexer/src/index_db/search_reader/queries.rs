//! `IndexDb` search and facet query methods that execute against the FTS index.

use rusqlite::params_from_iter;

use super::query_builder::SearchQueryBuilder;
use super::sanitize::{map_search_result, sanitize_fts_query};
use super::{SearchFacets, SearchFilters, SearchResult};
use crate::Result;
use crate::index_db::IndexDb;

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
        let rows = stmt.query_map(
            params_from_iter(params.iter().map(|p| p.as_ref())),
            map_search_result,
        )?;

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

        let count: i64 = self.conn.query_row(
            &sql,
            params_from_iter(params.iter().map(|p| p.as_ref())),
            |row| row.get(0),
        )?;
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
        let rows = stmt.query_map(
            params_from_iter(params.iter().map(|p| p.as_ref())),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
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

        Ok(self.conn.query_row(
            &sql,
            params_from_iter(params.iter().map(|p| p.as_ref())),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?)
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
}
