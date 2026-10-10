//! FTS maintenance and result-context commands.

use std::sync::Arc;

use super::cache::{FTS_HEALTH_CACHE, cached_index_read, invalidate_index_read_caches};
use crate::blocking_cmd;
use crate::concurrency::IndexingSemaphores;
use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::read_config;

/// Run FTS integrity check.
#[tauri::command]
pub async fn fts_integrity_check(state: tauri::State<'_, SharedConfig>) -> CmdResult<String> {
    let cfg = read_config(&state);
    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&cfg.index_db_path())?;
        db.fts_integrity_check()
    })
}

/// Optimize the FTS index.
#[tauri::command]
pub async fn fts_optimize(state: tauri::State<'_, SharedConfig>) -> CmdResult<String> {
    let cfg = read_config(&state);
    let result = blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&cfg.index_db_path())?;
        db.fts_optimize()
    });
    // Optimizing changes the database size that FTS health reports.
    invalidate_index_read_caches();
    result
}

/// Get detailed FTS health information. Cached until the index changes.
#[tauri::command]
pub async fn fts_health(
    state: tauri::State<'_, SharedConfig>,
    gates: tauri::State<'_, Arc<IndexingSemaphores>>,
) -> CmdResult<tracepilot_indexer::index_db::search_reader::FtsHealthInfo> {
    let index_path = read_config(&state).index_db_path();
    cached_index_read(&FTS_HEALTH_CACHE, &gates, index_path, (), |db| {
        db.fts_health()
    })
    .await
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
        db.get_result_context(result_id, radius.unwrap_or(2))
    })
}
