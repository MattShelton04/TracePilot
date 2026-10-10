//! Search statistics and reference-list commands.

use std::sync::Arc;

use super::cache::{TOOL_NAMES_CACHE, cached_index_read};
use crate::blocking_cmd;
use crate::concurrency::IndexingSemaphores;
use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::read_config;
use crate::types::SearchStatsResponse;

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

        Ok::<_, crate::error::BindingsError>(SearchStatsResponse {
            total_rows: stats.total_rows,
            indexed_sessions: stats.indexed_sessions,
            total_sessions: stats.total_sessions,
            content_type_counts: stats.content_type_counts,
        })
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
        db.search_repositories()
    })
}

/// Get distinct canonical tool names, with their native names and sources,
/// for the search filter dropdown. Cached until the index changes: every
/// Search page load asks, and a large index takes a while to answer.
#[tauri::command]
pub async fn get_search_tool_names(
    state: tauri::State<'_, SharedConfig>,
    gates: tauri::State<'_, Arc<IndexingSemaphores>>,
) -> CmdResult<Vec<tracepilot_indexer::index_db::SearchToolName>> {
    let index_path = read_config(&state).index_db_path();
    cached_index_read(&TOOL_NAMES_CACHE, &gates, index_path, (), |db| {
        db.search_tool_names()
    })
    .await
}
