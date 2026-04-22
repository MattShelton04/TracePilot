//! Deep FTS query builder and result reader.
//!
//! Provides parameterized search across `search_content` + `search_fts` with
//! filtering by content type, session, tool name, date range, and repository.
//! Results include highlighted snippets and pagination. Supports FTS (via the
//! `search_fts` table) and Browse (filter-only, empty query) modes.
//!
//! Decomposed into submodules: [`query_builder`], [`sanitize`], [`queries`],
//! [`stats`]. Cross-module tests live in [`tests`].

mod queries;
mod query_builder;
mod sanitize;
mod stats;
#[cfg(test)]
mod tests;

pub use sanitize::sanitize_fts_query;

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
