//! `get_session_prompt_cache` — prompt-cache idle windows for one session.

use std::path::Path;

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::{EventCache, PromptCacheResponse};

use super::shared::{load_cached_typed_events, system_time_to_unix_millis};

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_prompt_cache(
    state: tauri::State<'_, SharedConfig>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<PromptCacheResponse> {
    crate::validators::validate_session_id(&session_id)?;

    let config = read_config(&state);
    let session_state_dir = config.session_state_dir();
    let index_path = config.index_db_path();
    let event_cache = event_cache.inner().clone();

    blocking_cmd!({
        let path = tracepilot_core::session::discovery::resolve_session_path_direct(
            &session_id,
            &session_state_dir,
        )?;
        let events_path = tracepilot_core::paths::SessionPaths::from_root(&path).events_jsonl();
        let (events, events_file_size, events_file_mtime) =
            load_cached_typed_events(&event_cache, &session_id, &events_path)?;

        // Sessions with checkpoints never consult the registry, so the index
        // is only opened for older sessions that need an estimate.
        let mut registry: Option<Vec<(String, u64)>> = None;
        let timeline =
            tracepilot_core::prompt_cache::build_prompt_cache_timeline(events.as_ref(), |model| {
                registry
                    .get_or_insert_with(|| load_ttl_registry(&index_path))
                    .iter()
                    .find(|(known, _)| known == model)
                    .map(|(_, ttl)| *ttl)
            });

        Ok::<_, BindingsError>(PromptCacheResponse {
            timeline,
            events_file_size,
            events_file_mtime: system_time_to_unix_millis(events_file_mtime),
        })
    })
}

/// The most common TTL per model across indexed sessions. An unavailable
/// index yields an empty registry, so windows degrade to "unavailable".
fn load_ttl_registry(index_path: &Path) -> Vec<(String, u64)> {
    let ttls = tracepilot_indexer::index_db::IndexDb::open_readonly(index_path)
        .and_then(|db| db.query_observed_cache_ttls());
    match ttls {
        Ok(ttls) => ttls
            .into_iter()
            .map(|ttl| (ttl.model, ttl.ttl_seconds))
            .collect(),
        Err(error) => {
            tracing::debug!(%error, "Prompt-cache TTL registry unavailable");
            Vec::new()
        }
    }
}
