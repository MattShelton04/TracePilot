//! Search and indexing Tauri commands (9 commands).

use crate::blocking_cmd;
use crate::cache::TtlCache;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{
    emit_indexing_progress, load_summary_list_item, read_config, remove_index_db_files,
};
use crate::types::{
    SearchFacetsResponse, SearchResultItem, SearchResultsResponse, SearchSemaphore,
    SearchStatsResponse, SessionListItem,
};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, LazyLock};
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::Semaphore;

// ---------------------------------------------------------------------------
// Facets TTL cache (P1 perf fix)
// ---------------------------------------------------------------------------

static FACETS_CACHE: LazyLock<TtlCache<u64, SearchFacetsResponse>> =
    LazyLock::new(|| TtlCache::new(Duration::from_secs(60)));

fn facets_cache_key(
    query: &Option<String>,
    content_types: &Option<Vec<String>>,
    exclude_content_types: &Option<Vec<String>>,
    repositories: &Option<Vec<String>>,
    tool_names: &Option<Vec<String>>,
    session_id: &Option<String>,
    date_from_unix: &Option<i64>,
    date_to_unix: &Option<i64>,
) -> u64 {
    let mut hasher = DefaultHasher::new();
    query.hash(&mut hasher);
    content_types.hash(&mut hasher);
    exclude_content_types.hash(&mut hasher);
    repositories.hash(&mut hasher);
    tool_names.hash(&mut hasher);
    session_id.hash(&mut hasher);
    date_from_unix.hash(&mut hasher);
    date_to_unix.hash(&mut hasher);
    hasher.finish()
}

/// Clear the facets cache (called after reindex / rebuild operations).
pub fn invalidate_facets_cache() {
    FACETS_CACHE.clear();
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(%query))]
pub async fn search_sessions(
    state: tauri::State<'_, SharedConfig>,
    query: String,
) -> CmdResult<Vec<SessionListItem>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let session_state_dir = cfg.session_state_dir();

    blocking_cmd!({
        if !index_path.exists() {
            return Vec::new();
        }

        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        let result_ids = db.search(&query)?;
        let mut sessions = Vec::new();
        for session_id in result_ids {
            let path = match db.get_session_path(&session_id) {
                Ok(Some(p)) => p,
                _ => match tracepilot_core::session::discovery::resolve_session_path_in(
                    &session_id,
                    &session_state_dir,
                ) {
                    Ok(path) => path,
                    Err(_) => continue,
                },
            };
            let item = match load_summary_list_item(&path) {
                Ok(item) => item,
                Err(_) => continue,
            };
            sessions.push(item);
        }

        sessions.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| a.id.cmp(&b.id))
        });

        Ok(sessions)
    })
}

/// Returns (updated, total) session counts.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn reindex_sessions(
    state: tauri::State<'_, SharedConfig>,
    semaphore: tauri::State<'_, Arc<Semaphore>>,
    search_semaphore: tauri::State<'_, SearchSemaphore>,
    app: tauri::AppHandle,
) -> CmdResult<(usize, usize)> {
    let permit = match semaphore.inner().clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => return Err(BindingsError::AlreadyIndexing),
    };

    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();
    let index_path = cfg.index_db_path();
    let app_handle = app.clone();

    let _ = app.emit("indexing-started", ());

    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let start = std::time::Instant::now();
        let app_fallback = app_handle.clone();
        let res = match tracepilot_indexer::reindex_incremental_with_rich_progress(
            &session_state_dir,
            &index_path,
            |progress| {
                emit_indexing_progress(&app_handle, progress);
            },
        ) {
            Ok((indexed, skipped)) => Ok((indexed, indexed + skipped)),
            Err(_) => tracepilot_indexer::reindex_all_with_rich_progress(
                &session_state_dir,
                &index_path,
                |progress| {
                    emit_indexing_progress(&app_fallback, progress);
                },
            )
            .map(|n| (n, n))
            .map_err(Into::into),
        };
        tracing::debug!(
            elapsed_ms = start.elapsed().as_millis(),
            "reindex_sessions Phase 1 wall time"
        );
        res
    })
    .await;

    let _ = app.emit("indexing-finished", ());

    // Invalidate facets cache after reindex.
    invalidate_facets_cache();

    // Phase 2: Kick off search content indexing in background (non-blocking).
    if result.as_ref().map(|r| r.is_ok()).unwrap_or(false) {
        let search_permit = search_semaphore.0.clone().try_acquire_owned();
        if let Ok(search_permit) = search_permit {
            let cfg2 = read_config(&state);
            let session_state_dir2 = cfg2.session_state_dir();
            let index_path2 = cfg2.index_db_path();
            let app2 = app.clone();
            tokio::task::spawn_blocking(move || {
                let _permit = search_permit;
                let start = std::time::Instant::now();
                let _ = app2.emit("search-indexing-started", ());
                match tracepilot_indexer::reindex_search_content(
                    &session_state_dir2,
                    &index_path2,
                    |progress| {
                        let _ = app2.emit(
                            "search-indexing-progress",
                            serde_json::json!({
                                "current": progress.current,
                                "total": progress.total
                            }),
                        );
                    },
                    || false,
                ) {
                    Ok((indexed, skipped)) => {
                        tracing::debug!(
                            indexed,
                            skipped,
                            elapsed_ms = start.elapsed().as_millis(),
                            "reindex_sessions Phase 2 wall time"
                        );
                        let _ = app2.emit(
                            "search-indexing-finished",
                            serde_json::json!({"success": true}),
                        );
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "Phase 2 search indexing failed");
                        let _ = app2.emit(
                            "search-indexing-finished",
                            serde_json::json!({"success": false, "error": e.to_string()}),
                        );
                    }
                }
            });
        }
    }

    result?
}

/// Full reindex: delete the index DB and rebuild from scratch.
#[tauri::command]
pub async fn reindex_sessions_full(
    state: tauri::State<'_, SharedConfig>,
    semaphore: tauri::State<'_, Arc<Semaphore>>,
    search_semaphore: tauri::State<'_, SearchSemaphore>,
    app: tauri::AppHandle,
) -> CmdResult<(usize, usize)> {
    let permit = match semaphore.inner().clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => return Err(BindingsError::AlreadyIndexing),
    };

    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();
    let index_path = cfg.index_db_path();
    let app_handle = app.clone();

    let _ = app.emit("indexing-started", ());

    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;

        remove_index_db_files(&index_path)?;

        tracepilot_indexer::reindex_all_with_rich_progress(
            &session_state_dir,
            &index_path,
            |progress| {
                emit_indexing_progress(&app_handle, progress);
            },
        )
        .map(|n| (n, n))
        .map_err(Into::into)
    })
    .await;

    let _ = app.emit("indexing-finished", ());

    // Invalidate facets cache after full reindex.
    invalidate_facets_cache();

    // Phase 2: search content rebuild
    if result.as_ref().map(|r| r.is_ok()).unwrap_or(false) {
        let search_permit = search_semaphore.0.clone().try_acquire_owned();
        if let Ok(search_permit) = search_permit {
            let cfg2 = read_config(&state);
            let session_state_dir2 = cfg2.session_state_dir();
            let index_path2 = cfg2.index_db_path();
            let app2 = app.clone();
            tokio::task::spawn_blocking(move || {
                let _permit = search_permit;
                let start = std::time::Instant::now();
                let _ = app2.emit("search-indexing-started", ());
                match tracepilot_indexer::rebuild_search_content(
                    &session_state_dir2,
                    &index_path2,
                    |progress| {
                        let _ = app2.emit(
                            "search-indexing-progress",
                            serde_json::json!({
                                "current": progress.current,
                                "total": progress.total
                            }),
                        );
                    },
                    || false,
                ) {
                    Ok((indexed, skipped)) => {
                        tracing::debug!(
                            indexed,
                            skipped,
                            elapsed_ms = start.elapsed().as_millis(),
                            "rebuild_search_index Phase 2 wall time"
                        );
                        let _ = app2.emit(
                            "search-indexing-finished",
                            serde_json::json!({"success": true}),
                        );
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "Phase 2 search rebuild failed");
                        let _ = app2.emit(
                            "search-indexing-finished",
                            serde_json::json!({"success": false, "error": e.to_string()}),
                        );
                    }
                }
            });
        }
    }

    result?
}

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

        Ok(SearchFacetsResponse {
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

/// Get search index statistics.
#[tauri::command]
pub async fn get_search_stats(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<SearchStatsResponse> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;

        let stats = db.search_stats()?;

        SearchStatsResponse {
            total_rows: stats.total_rows,
            indexed_sessions: stats.indexed_sessions,
            total_sessions: stats.total_sessions,
            content_type_counts: stats.content_type_counts,
        }
    })
}

/// Get distinct repositories for search filter dropdown.
#[tauri::command]
pub async fn get_search_repositories(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<String>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        db.search_repositories()?
    })
}

/// Get distinct tool names for search filter dropdown.
#[tauri::command]
pub async fn get_search_tool_names(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<String>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        db.search_tool_names()?
    })
}

/// Rebuild the search index from scratch.
#[tauri::command]
pub async fn rebuild_search_index(
    state: tauri::State<'_, SharedConfig>,
    semaphore: tauri::State<'_, Arc<Semaphore>>,
    search_semaphore: tauri::State<'_, SearchSemaphore>,
    app: tauri::AppHandle,
) -> CmdResult<(usize, usize)> {
    if semaphore.inner().available_permits() == 0 {
        return Err(BindingsError::AlreadyIndexing);
    }
    let permit = match search_semaphore.0.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => return Err(BindingsError::AlreadyIndexing),
    };

    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();
    let index_path = cfg.index_db_path();
    let app_handle = app.clone();

    let _ = app.emit("search-indexing-started", ());

    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        tracepilot_indexer::rebuild_search_content(
            &session_state_dir,
            &index_path,
            |progress| {
                let _ = app_handle.emit(
                    "search-indexing-progress",
                    serde_json::json!({
                        "current": progress.current,
                        "total": progress.total
                    }),
                );
            },
            || false,
        )
        .map_err(Into::into)
    })
    .await;

    let success = result.as_ref().map(|r| r.is_ok()).unwrap_or(false);
    if success {
        invalidate_facets_cache();
    }
    let _ = app.emit(
        "search-indexing-finished",
        serde_json::json!({"success": success}),
    );
    result?
}

/// Run FTS integrity check.
#[tauri::command]
pub async fn fts_integrity_check(state: tauri::State<'_, SharedConfig>) -> CmdResult<String> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&cfg.index_db_path())?;
        Ok(db.fts_integrity_check()?)
    })
}

/// Optimize the FTS index.
#[tauri::command]
pub async fn fts_optimize(state: tauri::State<'_, SharedConfig>) -> CmdResult<String> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&cfg.index_db_path())?;
        Ok(db.fts_optimize()?)
    })
}

/// Get detailed FTS health information.
#[tauri::command]
pub async fn fts_health(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<tracepilot_indexer::index_db::search_reader::FtsHealthInfo> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&cfg.index_db_path())?;
        Ok(db.fts_health()?)
    })
}

/// Get surrounding context for a search result.
#[tauri::command]
pub async fn get_result_context(
    state: tauri::State<'_, SharedConfig>,
    result_id: i64,
    radius: Option<usize>,
) -> CmdResult<(
    Vec<tracepilot_indexer::index_db::ContextSnippet>,
    Vec<tracepilot_indexer::index_db::ContextSnippet>,
)> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&cfg.index_db_path())?;
        Ok(db.get_result_context(result_id, radius.unwrap_or(2))?)
    })
}
