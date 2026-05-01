//! Search statistics and reference-list commands.

use crate::blocking_cmd;
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

/// Get distinct tool names for search filter dropdown.
#[tauri::command]
pub async fn get_search_tool_names(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<String>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        db.search_tool_names()
    })
}
