//! Session metadata search command.

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::{indexed_session_to_list_item, read_config};
use crate::types::SessionListItem;

#[tauri::command]
#[tracing::instrument(skip_all, fields(%query))]
pub async fn search_sessions(
    state: tauri::State<'_, SharedConfig>,
    query: String,
) -> CmdResult<Vec<SessionListItem>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    blocking_cmd!({
        if !index_path.exists() {
            return Ok(Vec::new());
        }

        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        let indexed = db.search_sessions(&query)?;
        Ok::<_, crate::error::BindingsError>(
            indexed
                .into_iter()
                .map(indexed_session_to_list_item)
                .collect(),
        )
    })
}
