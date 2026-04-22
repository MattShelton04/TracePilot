//! `list_sessions` command — index-DB fast path with filesystem fallback.

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{indexed_session_to_list_item, load_summary_list_item, read_config};
use crate::types::SessionListItem;

#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all)]
pub async fn list_sessions(
    state: tauri::State<'_, SharedConfig>,
    limit: Option<u32>,
    repo: Option<String>,
    branch: Option<String>,
    hide_empty: Option<bool>,
    hide_orchestrator: Option<bool>,
) -> CmdResult<Vec<SessionListItem>> {
    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();
    let session_state_dir = cfg.session_state_dir();
    let exclude_cwd = if hide_orchestrator.unwrap_or(false) {
        Some(cfg.jobs_dir().to_string_lossy().to_string())
    } else {
        None
    };

    blocking_cmd!({
        // Fast path: query the index DB (single SQLite read, no per-session I/O)
        if index_path.exists() {
            let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;

            // Check if index has any sessions; if empty, fall through to disk scan
            let count = db.session_count().unwrap_or(0);
            if count > 0 {
                let indexed = db.list_sessions_filtered(
                    limit.map(|l| l as usize),
                    repo.as_deref(),
                    branch.as_deref(),
                    hide_empty.unwrap_or(false),
                    exclude_cwd.as_deref(),
                )?;

                return Ok(indexed
                    .into_iter()
                    .map(indexed_session_to_list_item)
                    .collect());
            }
        }

        // Fallback: full disk scan (used when index is empty or missing)
        let sessions = tracepilot_core::session::discovery::discover_sessions(&session_state_dir)?;

        let mut items = Vec::new();
        let should_hide_empty = hide_empty.unwrap_or(false);
        // Normalize the exclude_cwd prefix for comparison (forward slashes)
        let exclude_cwd_normalized = exclude_cwd.as_deref().map(|p| p.replace('\\', "/"));
        for session in sessions {
            let item = match load_summary_list_item(&session.path) {
                Ok(item) => item,
                Err(_) => continue,
            };

            // Apply CWD exclusion filter (same logic as SQL path in session_reader)
            if let Some(ref prefix) = exclude_cwd_normalized
                && let Some(ref cwd) = item.cwd
                && cwd.replace('\\', "/").starts_with(prefix.as_str())
            {
                continue;
            }

            if repo
                .as_ref()
                .is_some_and(|value| item.repository.as_deref() != Some(value.as_str()))
            {
                continue;
            }
            if branch
                .as_ref()
                .is_some_and(|value| item.branch.as_deref() != Some(value.as_str()))
            {
                continue;
            }
            if should_hide_empty && item.turn_count.unwrap_or(0) == 0 {
                continue;
            }

            items.push(item);
        }

        items.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| a.id.cmp(&b.id))
        });

        if let Some(limit) = limit {
            items.truncate(limit as usize);
        }

        Ok::<_, BindingsError>(items)
    })
}
