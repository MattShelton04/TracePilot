//! `SearchQueryBuilder` — parameterized SQL builder for search queries.
//!
//! Consolidates query construction logic that was previously duplicated across
//! `query_content`, `query_count`, `facet_dimension`, and `totals_query`.

use rusqlite::types::ToSql;
use tracepilot_core::session_store::WorkRefKind;
use tracepilot_core::utils::sqlite::build_in_placeholders;

use super::SearchFilters;

/// Builder for constructing SQL search queries with type-safe parameter binding.
///
/// # Example
/// ```ignore
/// let (sql, params) = SearchQueryBuilder::new("SELECT * FROM ...", true)
///     .with_fts_match("error message")
///     .with_filters(&filters, true)
///     .with_sort(Some("newest"))
///     .with_pagination(50, 0)
///     .build();
/// ```
pub(super) struct SearchQueryBuilder {
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
    pub(super) fn new(base_select: &str, is_fts: bool) -> Self {
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
    pub(super) fn with_fts_match(mut self, query: &str) -> Self {
        self.where_clauses.push("search_fts MATCH ?".to_string());
        self.params.push(Box::new(query.to_string()));
        self
    }

    /// Add FTS MATCH clause only if query is Some.
    pub(super) fn with_optional_fts_match(mut self, query: Option<&str>) -> Self {
        if let Some(q) = query {
            self = self.with_fts_match(q);
        }
        self
    }

    /// Add an IN-filter for a list of values.
    ///
    /// Generates `column IN (?, ?, ...)` with one placeholder per value.
    /// Empty value lists are ignored (no-op).
    pub(super) fn add_in_filter<T: ToString>(mut self, column: &str, values: &[T]) -> Self {
        if values.is_empty() {
            return self;
        }
        let placeholders = build_in_placeholders(values.len());
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
    pub(super) fn add_not_in_filter<T: ToString>(mut self, column: &str, values: &[T]) -> Self {
        if values.is_empty() {
            return self;
        }
        let placeholders = build_in_placeholders(values.len());
        self.where_clauses
            .push(format!("{} NOT IN ({})", column, placeholders));
        for val in values {
            self.params.push(Box::new(val.to_string()));
        }
        self
    }

    /// Add standard search filters (content types, repositories, tools, dates,
    /// session ID, linked-work references).
    ///
    /// `work_refs_available` reports whether `session_work_refs` exists on this
    /// connection. It is a parameter rather than a probe because the builder
    /// has no connection; see `IndexDb::work_refs_available`.
    pub(super) fn with_filters(
        mut self,
        filters: &SearchFilters,
        work_refs_available: bool,
    ) -> Self {
        // Use helper methods for IN-filters
        self = self.add_in_filter("sc.content_type", &filters.content_types);
        self = self.add_not_in_filter("sc.content_type", &filters.exclude_content_types);
        self = self.add_in_filter("s.repository", &filters.repositories);
        self = self.add_in_filter("sc.tool_name", &filters.tool_names);

        // Linked-work qualifiers. Each kind is its own clause so `repo:x pr:1`
        // and `pr:1 issue:2` intersect, while repeated values of one kind union.
        self = self.add_work_ref_filter(
            &WorkRefKind::PullRequest,
            &filters.pull_requests,
            work_refs_available,
        );
        self = self.add_work_ref_filter(&WorkRefKind::Issue, &filters.issues, work_refs_available);
        self =
            self.add_work_ref_filter(&WorkRefKind::GitRef, &filters.git_refs, work_refs_available);

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

    /// Add an EXISTS filter over `session_work_refs` for one reference kind.
    ///
    /// Values are normalized exactly as `tracepilot_core::session_store` wrote
    /// the stored column, so a typed `#123` matches the stored `123`. A value
    /// that cannot normalize — a non-numeric `pr:` for instance — can never
    /// match a row, and an absent table means this connection has no source to
    /// answer from; both degrade to "no results for this qualifier" rather than
    /// an error, because the caller reports an unavailable source separately.
    fn add_work_ref_filter(
        mut self,
        kind: &WorkRefKind,
        values: &[String],
        available: bool,
    ) -> Self {
        if values.is_empty() {
            return self;
        }

        let normalized: Vec<String> = values
            .iter()
            .filter_map(|value| normalize_work_ref_value(kind, value))
            .collect();
        if normalized.is_empty() || !available {
            self.where_clauses.push("1=0".to_string());
            return self;
        }

        let mut clause = String::from("(");
        for (i, value) in normalized.iter().enumerate() {
            if i > 0 {
                clause.push_str(" OR ");
            }
            clause.push_str(WORK_REF_EXISTS);
            // Params are pushed with the clause: `build` emits WHERE clauses in
            // insertion order, and the placeholders are positional.
            self.params.push(Box::new(kind.as_str().to_string()));
            self.params.push(Box::new(value.clone()));
        }
        clause.push(')');
        self.where_clauses.push(clause);
        self
    }

    /// Add a single extra WHERE clause with additional parameters.
    pub(super) fn with_extra_where(mut self, clause: &str) -> Self {
        if !clause.is_empty() {
            self.where_clauses.push(clause.to_string());
        }
        self
    }

    /// Add ORDER BY clause.
    ///
    /// For FTS queries with no explicit sort, applies relevance-weighted ranking.
    pub(super) fn with_sort(mut self, sort_by: Option<&str>) -> Self {
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
    pub(super) fn with_pagination(mut self, limit: usize, offset: usize) -> Self {
        self.limit = Some(limit as i64);
        self.offset = Some(offset as i64);
        self
    }

    /// Add a GROUP BY and optional ORDER BY clause to the query.
    ///
    /// This replaces any existing order_by with GROUP BY + optional order.
    pub(super) fn with_group_by(mut self, group_by: &str, order_by: Option<&str>) -> Self {
        let order_part = order_by.unwrap_or("");
        self.order_by = Some(format!("GROUP BY {} {}", group_by, order_part));
        self
    }

    /// Add a LIMIT clause (without pagination - just limit, no offset).
    pub(super) fn with_limit(mut self, limit: usize) -> Self {
        self.limit = Some(limit as i64);
        self
    }

    /// Build the final SQL query and parameter vector.
    ///
    /// Returns `(sql_string, params)` ready for execution.
    pub(super) fn build(mut self) -> (String, Vec<Box<dyn ToSql>>) {
        let mut sql = format!("{} {}", self.base_query, self.from_clause);

        // Build WHERE clause
        if !self.where_clauses.is_empty() {
            sql.push_str(" WHERE ");
            for (i, clause) in self.where_clauses.iter().enumerate() {
                if i > 0 {
                    sql.push_str(" AND ");
                }
                sql.push_str(clause);
            }
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

/// Correlated existence test for one linked-work reference.
const WORK_REF_EXISTS: &str = "EXISTS (SELECT 1 FROM session_work_refs wr      WHERE wr.session_id = sc.session_id AND wr.kind = ? AND wr.normalized_value = ?)";

/// Normalize one typed qualifier value into the stored `normalized_value`
/// form: trimmed, a leading `#` dropped, lowercased, and — for pull requests
/// and issues — a positive decimal. Returns `None` when no stored row could
/// ever carry the value.
fn normalize_work_ref_value(kind: &WorkRefKind, value: &str) -> Option<String> {
    let trimmed = value.trim().trim_start_matches('#').trim();
    if trimmed.is_empty() {
        return None;
    }
    match kind {
        WorkRefKind::PullRequest | WorkRefKind::Issue => match trimmed.parse::<u64>() {
            Ok(number) if number > 0 => Some(number.to_string()),
            _ => None,
        },
        _ => Some(trimmed.to_ascii_lowercase()),
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

    // ── SearchQueryBuilder helper method tests ─────────────────────

    #[test]
    fn test_add_in_filter_single_value() {
        let builder = SearchQueryBuilder::new("SELECT *", false);
        let (sql, params) = builder
            .add_in_filter("col", &["value1".to_string()])
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
                &["val1".to_string(), "val2".to_string(), "val3".to_string()],
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
            .add_not_in_filter("col", &["exclude1".to_string()])
            .build();

        assert!(sql.contains("col NOT IN (?)"));
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_add_not_in_filter_multiple_values() {
        let builder = SearchQueryBuilder::new("SELECT *", false);
        let (sql, params) = builder
            .add_not_in_filter("col", &["exc1".to_string(), "exc2".to_string()])
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
            .add_in_filter("col1", &["a".to_string()])
            .add_not_in_filter("col2", &["b".to_string(), "c".to_string()])
            .add_in_filter("col3", &["d".to_string(), "e".to_string(), "f".to_string()])
            .build();

        assert!(sql.contains("col1 IN (?)"));
        assert!(sql.contains("col2 NOT IN (?, ?)"));
        assert!(sql.contains("col3 IN (?, ?, ?)"));
        assert_eq!(params.len(), 6);
    }
}
