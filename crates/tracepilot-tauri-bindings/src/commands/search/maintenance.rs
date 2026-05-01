//! FTS maintenance and result-context commands.

use crate::blocking_cmd;
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
    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_or_create(&cfg.index_db_path())?;
        db.fts_optimize()
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
        db.fts_health()
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
        db.get_result_context(result_id, radius.unwrap_or(2))
    })
}
