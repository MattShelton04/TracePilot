//! `get_session_prompt_cache` — prompt-cache idle windows for one session.

use std::path::Path;

use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::{read_config, with_session_locator};
use crate::types::{EventCache, PromptCacheResponse};

use super::shared::{load_cached_typed_events, system_time_to_unix_millis};

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_prompt_cache(
    state: tauri::State<'_, SharedConfig>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<PromptCacheResponse> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    let index_path = read_config(&state).index_db_path();
    let event_cache = event_cache.inner().clone();

    with_session_locator(&state, sid, move |session| {
        let (events, stamp) = load_cached_typed_events(&event_cache, &session)?;

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

        Ok(PromptCacheResponse {
            timeline,
            events_file_size: stamp.events_file_size,
            events_file_mtime: system_time_to_unix_millis(stamp.events_file_mtime),
        })
    })
    .await
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
