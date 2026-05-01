//! Content search and facets commands.

use super::cache::{FACETS_CACHE, facets_cache_key};
use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::{SearchFacetsResponse, SearchResultItem, SearchResultsResponse};

/// Search session content with full-text search or browse mode.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%query))]
#[allow(clippy::too_many_arguments)]
pub async fn search_content(
    state: tauri::State<'_, SharedConfig>,
    query: String,
    content_types: Option<Vec<String>>,
    exclude_content_types: Option<Vec<String>>,
    repositories: Option<Vec<String>>,
    tool_names: Option<Vec<String>>,
    session_id: Option<String>,
    date_from_unix: Option<i64>,
    date_to_unix: Option<i64>,
    limit: Option<usize>,
    offset: Option<usize>,
    sort_by: Option<String>,
) -> CmdResult<SearchResultsResponse> {
    crate::validators::validate_optional_session_id(&session_id)?;
    crate::validators::validate_unix_date_range(date_from_unix, date_to_unix)?;

    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let query_for_closure = query.clone();

    blocking_cmd!({
        let start = std::time::Instant::now();
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;

        let filters = tracepilot_indexer::SearchFilters {
            content_types: content_types.unwrap_or_default(),
            exclude_content_types: exclude_content_types.unwrap_or_default(),
            repositories: repositories.unwrap_or_default(),
            tool_names: tool_names.unwrap_or_default(),
            session_id,
            date_from_unix,
            date_to_unix,
            limit,
            offset,
            sort_by,
        };

        let query_opt = if query_for_closure.trim().is_empty() {
            None
        } else {
            Some(query_for_closure.as_str())
        };

        let results = db.query_content(query_opt, &filters)?;
        let total_count = db.query_count(query_opt, &filters)?;

        let latency_ms = start.elapsed().as_secs_f64() * 1000.0;

        let page_limit = filters.limit.unwrap_or(50).min(200) as i64;
        let page_offset = filters.offset.unwrap_or(0) as i64;
        let has_more = (page_offset + page_limit) < total_count;

        Ok::<SearchResultsResponse, BindingsError>(SearchResultsResponse {
            results: results
                .into_iter()
                .map(|r| SearchResultItem {
                    id: r.id,
                    session_id: r.session_id,
                    content_type: r.content_type,
                    turn_number: r.turn_number,
                    event_index: r.event_index,
                    timestamp_unix: r.timestamp_unix,
                    tool_name: r.tool_name,
                    snippet: Some(r.snippet),
                    metadata_json: r.metadata_json,
                    session_summary: r.session_summary,
                    session_repository: r.session_repository,
                    session_branch: r.session_branch,
                    session_updated_at: r.session_updated_at,
                })
                .collect(),
            total_count,
            has_more,
            query: query_for_closure,
            latency_ms,
        })
    })
}

/// Get facet counts (with 60-second TTL cache).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn get_search_facets(
    state: tauri::State<'_, SharedConfig>,
    query: Option<String>,
    content_types: Option<Vec<String>>,
    exclude_content_types: Option<Vec<String>>,
    repositories: Option<Vec<String>>,
    tool_names: Option<Vec<String>>,
    session_id: Option<String>,
    date_from_unix: Option<i64>,
    date_to_unix: Option<i64>,
) -> CmdResult<SearchFacetsResponse> {
    crate::validators::validate_optional_session_id(&session_id)?;
    crate::validators::validate_unix_date_range(date_from_unix, date_to_unix)?;

    let key = facets_cache_key(
        &query,
        &content_types,
        &exclude_content_types,
        &repositories,
        &tool_names,
        &session_id,
        &date_from_unix,
        &date_to_unix,
    );

    // Return cached value if still fresh.
    if let Some(response) = FACETS_CACHE.get(&key) {
        return Ok(response);
    }

    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    let result = blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;

        let filters = tracepilot_indexer::SearchFilters {
            content_types: content_types.unwrap_or_default(),
            exclude_content_types: exclude_content_types.unwrap_or_default(),
            repositories: repositories.unwrap_or_default(),
            tool_names: tool_names.unwrap_or_default(),
            session_id,
            date_from_unix,
            date_to_unix,
            ..Default::default()
        };

        let query_opt = query.as_deref().filter(|q| !q.trim().is_empty());
        let facets = db.facets(query_opt, &filters)?;

        Ok::<_, crate::error::BindingsError>(SearchFacetsResponse {
            by_content_type: facets.by_content_type,
            by_repository: facets.by_repository,
            by_tool_name: facets.by_tool_name,
            total_matches: facets.total_matches,
            session_count: facets.session_count,
        })
    });

    // Cache the result.
    if let Ok(ref response) = result {
        FACETS_CACHE.insert(key, response.clone());
    }

    result
}
