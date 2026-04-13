//! SQL query builder for task database operations.
//!
//! Provides a fluent API for constructing SQL queries with type-safe parameter binding,
//! eliminating manual placeholder numbering and reducing code duplication.

use rusqlite::types::ToSql;

/// Builder for constructing SQL queries for task database operations.
///
/// Consolidates query construction logic that was previously duplicated in
/// `list_tasks()` and `list_jobs()`, providing a cleaner API with automatic
/// parameter binding.
///
/// # Example
/// ```ignore
/// let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
///     .with_equality_filter("status", Some(&"pending"))
///     .with_equality_filter("job_id", Some(&"job-123"))
///     .with_order_by("created_at DESC")
///     .with_limit(Some(50))
///     .with_offset(Some(0))
///     .build();
/// ```
pub(crate) struct TaskQueryBuilder {
    base_query: String,
    where_clauses: Vec<String>,
    params: Vec<Box<dyn ToSql>>,
    order_by: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}

impl TaskQueryBuilder {
    /// Create a new query builder with a base SELECT statement.
    ///
    /// # Arguments
    /// * `base_query` - The SELECT clause (e.g., "SELECT * FROM tasks")
    pub(crate) fn new(base_query: &str) -> Self {
        Self {
            base_query: base_query.to_string(),
            where_clauses: Vec::new(),
            params: Vec::new(),
            order_by: None,
            limit: None,
            offset: None,
        }
    }

    /// Add an equality filter for a string value.
    ///
    /// Generates `column = ?` if value is Some, otherwise no-op.
    ///
    /// # Arguments
    /// * `column` - The column name to filter on
    /// * `value` - Optional string value to filter by (None = skip filter)
    pub(crate) fn with_string_filter(mut self, column: &str, value: Option<&str>) -> Self {
        if let Some(val) = value {
            self.where_clauses.push(format!("{} = ?", column));
            self.params.push(Box::new(val.to_string()));
        }
        self
    }

    /// Add an equality filter for an i64 value.
    ///
    /// Generates `column = ?` if value is Some, otherwise no-op.
    ///
    /// # Arguments
    /// * `column` - The column name to filter on
    /// * `value` - Optional i64 value to filter by (None = skip filter)
    pub(crate) fn with_i64_filter(mut self, column: &str, value: Option<i64>) -> Self {
        if let Some(val) = value {
            self.where_clauses.push(format!("{} = ?", column));
            self.params.push(Box::new(val));
        }
        self
    }

    /// Add an ORDER BY clause to the query.
    ///
    /// # Arguments
    /// * `order` - The ORDER BY expression (e.g., "created_at DESC")
    pub(crate) fn with_order_by(mut self, order: &str) -> Self {
        self.order_by = Some(format!("ORDER BY {}", order));
        self
    }

    /// Add a LIMIT clause to the query.
    ///
    /// # Arguments
    /// * `limit` - Optional limit value (None = no limit)
    pub(crate) fn with_limit(mut self, limit: Option<i64>) -> Self {
        self.limit = limit;
        self
    }

    /// Add an OFFSET clause to the query.
    ///
    /// # Arguments
    /// * `offset` - Optional offset value (None = no offset)
    pub(crate) fn with_offset(mut self, offset: Option<i64>) -> Self {
        self.offset = offset;
        self
    }

    /// Build the final SQL query and parameter vector.
    ///
    /// Returns `(sql_string, params)` ready for execution with rusqlite.
    pub(crate) fn build(mut self) -> (String, Vec<Box<dyn ToSql>>) {
        let mut sql = self.base_query.clone();

        // Build WHERE clause
        if !self.where_clauses.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&self.where_clauses.join(" AND "));
        }

        // Add ORDER BY
        if let Some(order_by) = self.order_by {
            sql.push_str(" ");
            sql.push_str(&order_by);
        }

        // Add LIMIT
        if let Some(limit) = self.limit {
            sql.push_str(" LIMIT ?");
            self.params.push(Box::new(limit));
        }

        // Add OFFSET
        if let Some(offset) = self.offset {
            sql.push_str(" OFFSET ?");
            self.params.push(Box::new(offset));
        }

        (sql, self.params)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_query() {
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks").build();
        assert_eq!(sql, "SELECT * FROM tasks");
        assert!(params.is_empty());
    }

    #[test]
    fn test_single_equality_filter() {
        let status = "pending";
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_string_filter("status", Some(status))
            .build();

        assert_eq!(sql, "SELECT * FROM tasks WHERE status = ?");
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_multiple_equality_filters() {
        let status = "pending";
        let job_id = "job-123";
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_string_filter("status", Some(status))
            .with_string_filter("job_id", Some(job_id))
            .build();

        assert_eq!(sql, "SELECT * FROM tasks WHERE status = ? AND job_id = ?");
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn test_none_filter_is_skipped() {
        let status = "pending";
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_string_filter("status", Some(status))
            .with_string_filter("job_id", None)
            .build();

        assert_eq!(sql, "SELECT * FROM tasks WHERE status = ?");
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_all_none_filters() {
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_string_filter("status", None)
            .with_string_filter("job_id", None)
            .build();

        assert_eq!(sql, "SELECT * FROM tasks");
        assert!(params.is_empty());
    }

    #[test]
    fn test_order_by() {
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_order_by("created_at DESC")
            .build();

        assert_eq!(sql, "SELECT * FROM tasks ORDER BY created_at DESC");
        assert!(params.is_empty());
    }

    #[test]
    fn test_limit_only() {
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_limit(Some(50))
            .build();

        assert_eq!(sql, "SELECT * FROM tasks LIMIT ?");
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_offset_only() {
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_offset(Some(100))
            .build();

        assert_eq!(sql, "SELECT * FROM tasks OFFSET ?");
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_limit_and_offset() {
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_limit(Some(50))
            .with_offset(Some(100))
            .build();

        assert_eq!(sql, "SELECT * FROM tasks LIMIT ? OFFSET ?");
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn test_complete_query() {
        let status = "pending";
        let task_type = "session_summary";
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_string_filter("status", Some(status))
            .with_string_filter("task_type", Some(task_type))
            .with_order_by("created_at DESC")
            .with_limit(Some(50))
            .with_offset(Some(0))
            .build();

        assert_eq!(
            sql,
            "SELECT * FROM tasks WHERE status = ? AND task_type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
        );
        assert_eq!(params.len(), 4);
    }

    #[test]
    fn test_filters_before_pagination() {
        let status = "pending";
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_string_filter("status", Some(status))
            .with_limit(Some(10))
            .build();

        // Verify WHERE comes before LIMIT
        assert!(sql.starts_with("SELECT * FROM tasks WHERE"));
        assert!(sql.ends_with("LIMIT ?"));
        assert_eq!(params.len(), 2); // status + limit
    }

    #[test]
    fn test_order_by_before_limit() {
        let (sql, _params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_order_by("created_at DESC")
            .with_limit(Some(10))
            .build();

        // Verify ORDER BY comes before LIMIT
        let order_idx = sql.find("ORDER BY").unwrap();
        let limit_idx = sql.find("LIMIT").unwrap();
        assert!(order_idx < limit_idx);
    }

    #[test]
    fn test_limit_before_offset() {
        let (sql, _params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_limit(Some(50))
            .with_offset(Some(100))
            .build();

        // Verify LIMIT comes before OFFSET
        let limit_idx = sql.find("LIMIT").unwrap();
        let offset_idx = sql.find("OFFSET").unwrap();
        assert!(limit_idx < offset_idx);
    }

    #[test]
    fn test_integer_filter() {
        let max_retries: i64 = 3;
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_i64_filter("max_retries", Some(max_retries))
            .build();

        assert_eq!(sql, "SELECT * FROM tasks WHERE max_retries = ?");
        assert_eq!(params.len(), 1);
    }

    #[test]
    fn test_mixed_filter_types() {
        let status = "pending";
        let max_retries: i64 = 3;
        let (sql, params) = TaskQueryBuilder::new("SELECT * FROM tasks")
            .with_string_filter("status", Some(status))
            .with_i64_filter("max_retries", Some(max_retries))
            .build();

        assert_eq!(
            sql,
            "SELECT * FROM tasks WHERE status = ? AND max_retries = ?"
        );
        assert_eq!(params.len(), 2);
    }
}
