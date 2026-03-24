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
    // ── Unified query methods ───────────────────────────────────────

    /// Query content with optional FTS. When `query` is `Some` and non-empty
    /// after sanitization, uses FTS MATCH; otherwise falls back to browse mode.
    pub fn query_content(
        &self,
        query: Option<&str>,
        filters: &SearchFilters,
    ) -> Result<Vec<SearchResult>> {
        let sanitized = query.map(|q| sanitize_fts_query(q)).filter(|s| !s.is_empty());
        let is_fts = sanitized.is_some();

        let snippet_col = if is_fts {
            "snippet(search_fts, 0, '\x01MARK_OPEN\x01', '\x01MARK_CLOSE\x01', '…', 48)"
        } else {
            "CASE WHEN LENGTH(sc.content) > 200 \
                  THEN SUBSTR(sc.content, 1, 200) || '…' \
                  ELSE sc.content END"
        };

        let from_clause = if is_fts {
            "FROM search_fts \
             JOIN search_content sc ON sc.id = search_fts.rowid \
             JOIN sessions s ON s.id = sc.session_id"
        } else {
            "FROM search_content sc \
             JOIN sessions s ON s.id = sc.session_id"
        };

        let mut sql = format!(
            "SELECT sc.id, sc.session_id, sc.content_type, sc.turn_number, sc.event_index, \
                    sc.timestamp_unix, sc.tool_name, {snippet_col}, sc.metadata_json, \
                    s.summary, s.repository, s.branch, s.updated_at \
             {from_clause}"
        );

        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        if let Some(ref q) = sanitized {
            sql.push_str(" WHERE search_fts MATCH ?");
            params.push(Box::new(q.clone()));
        } else {
            sql.push_str(" WHERE 1=1");
        }

        append_filters(&mut sql, &mut params, filters);

        match filters.sort_by.as_deref() {
            Some("newest") => sql.push_str(" ORDER BY sc.timestamp_unix DESC NULLS LAST"),
            Some("oldest") => sql.push_str(" ORDER BY sc.timestamp_unix ASC NULLS LAST"),
            _ if is_fts => sql.push_str(" ORDER BY rank"),
            _ => sql.push_str(" ORDER BY sc.timestamp_unix DESC NULLS LAST"),
        }

        let limit = filters.limit.unwrap_or(50).min(200) as i64;
        let offset = filters.offset.unwrap_or(0) as i64;
        sql.push_str(" LIMIT ? OFFSET ?");
        params.push(Box::new(limit));
        params.push(Box::new(offset));

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
    pub fn query_count(
        &self,
        query: Option<&str>,
        filters: &SearchFilters,
    ) -> Result<i64> {
        let sanitized = query.map(|q| sanitize_fts_query(q)).filter(|s| !s.is_empty());

        let from_clause = if sanitized.is_some() {
            "FROM search_fts \
             JOIN search_content sc ON sc.id = search_fts.rowid \
             JOIN sessions s ON s.id = sc.session_id"
        } else {
            "FROM search_content sc \
             JOIN sessions s ON s.id = sc.session_id"
        };

        let mut sql = format!("SELECT COUNT(*) {from_clause}");

        let mut params: Vec<Box<dyn ToSql>> = Vec::new();
        if let Some(ref q) = sanitized {
            sql.push_str(" WHERE search_fts MATCH ?");
            params.push(Box::new(q.clone()));
        } else {
            sql.push_str(" WHERE 1=1");
        }

        append_filters(&mut sql, &mut params, filters);

        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let count: i64 = self.conn.query_row(&sql, params_from_iter(refs), |row| row.get(0))?;
        Ok(count)
    }

    /// Get facet counts with optional FTS.
    /// Each facet dimension excludes its own filter for proper faceted navigation.
    pub fn facets(
        &self,
        query: Option<&str>,
        filters: &SearchFilters,
    ) -> Result<SearchFacets> {
        let sanitized = query.map(|q| sanitize_fts_query(q)).filter(|s| !s.is_empty());

        let by_content_type = {
            let excl = SearchFilters { content_types: Vec::new(), ..filters.clone() };
            self.facet_dimension("sc.content_type", None, None, sanitized.as_deref(), &excl)?
        };

        let by_repository = {
            let excl = SearchFilters { repositories: Vec::new(), ..filters.clone() };
            self.facet_dimension("s.repository", Some("s.repository IS NOT NULL"), Some(20), sanitized.as_deref(), &excl)?
        };

        let by_tool_name = {
            let excl = SearchFilters { tool_names: Vec::new(), ..filters.clone() };
            self.facet_dimension("sc.tool_name", Some("sc.tool_name IS NOT NULL"), Some(20), sanitized.as_deref(), &excl)?
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
        let from_clause = if sanitized_query.is_some() {
            "FROM search_fts \
             JOIN search_content sc ON sc.id = search_fts.rowid \
             JOIN sessions s ON s.id = sc.session_id"
        } else {
            "FROM search_content sc \
             JOIN sessions s ON s.id = sc.session_id"
        };

        let mut sql = format!("SELECT {column}, COUNT(*) {from_clause}");
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();

        if let Some(q) = sanitized_query {
            sql.push_str(" WHERE search_fts MATCH ?");
            params.push(Box::new(q.to_string()));
            if let Some(extra) = extra_where {
                sql.push_str(&format!(" AND {extra}"));
            }
        } else if let Some(extra) = extra_where {
            sql.push_str(&format!(" WHERE {extra}"));
        } else {
            sql.push_str(" WHERE 1=1");
        }

        append_filters(&mut sql, &mut params, filters);
        sql.push_str(&format!(" GROUP BY {column} ORDER BY COUNT(*) DESC"));
        if let Some(n) = limit {
            sql.push_str(&format!(" LIMIT {n}"));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let results: Vec<(String, i64)> = stmt
            .query_map(params_from_iter(refs), |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(results)
    }

    /// Run the totals sub-query (COUNT + COUNT DISTINCT session_id).
    fn totals_query(
        &self,
        sanitized_query: Option<&str>,
        filters: &SearchFilters,
    ) -> Result<(i64, i64)> {
        let from_clause = if sanitized_query.is_some() {
            "FROM search_fts \
             JOIN search_content sc ON sc.id = search_fts.rowid \
             JOIN sessions s ON s.id = sc.session_id"
        } else {
            "FROM search_content sc \
             JOIN sessions s ON s.id = sc.session_id"
        };

        let mut sql = format!("SELECT COUNT(*), COUNT(DISTINCT sc.session_id) {from_clause}");
        let mut params: Vec<Box<dyn ToSql>> = Vec::new();

        if let Some(q) = sanitized_query {
            sql.push_str(" WHERE search_fts MATCH ?");
            params.push(Box::new(q.to_string()));
        } else {
            sql.push_str(" WHERE 1=1");
        }

        append_filters(&mut sql, &mut params, filters);

        let refs: Vec<&dyn ToSql> = params.iter().map(|p| p.as_ref()).collect();
        Ok(self.conn.query_row(&sql, params_from_iter(refs), |row| Ok((row.get(0)?, row.get(1)?)))?)
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

}

// ── Shared helpers ──────────────────────────────────────────────

/// Append all filter WHERE clauses and their param values using anonymous `?` placeholders.
fn append_filters(sql: &mut String, params: &mut Vec<Box<dyn ToSql>>, filters: &SearchFilters) {
    use super::helpers::{build_in_filter, build_eq_filter, build_timestamp_range_filter};

    sql.push_str(&build_in_filter("sc.content_type", &filters.content_types, params));
    sql.push_str(&build_in_filter("s.repository", &filters.repositories, params));
    sql.push_str(&build_in_filter("sc.tool_name", &filters.tool_names, params));

    if let Some(ref sid) = filters.session_id {
        sql.push_str(&build_eq_filter("sc.session_id", sid.clone(), params));
    }

    sql.push_str(&build_timestamp_range_filter(
        "sc.timestamp_unix",
        filters.date_from_unix,
        filters.date_to_unix,
        params,
    ));
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
