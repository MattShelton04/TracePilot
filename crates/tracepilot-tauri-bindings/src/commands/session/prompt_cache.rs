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
    let enrichment_enabled = config.features.session_store_enrichment;
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

        // Observations sit beside the predictions rather than changing them.
        // An unavailable store simply leaves the list empty, which is how the
        // baseline cache view keeps working on a machine without one.
        let observations = if enrichment_enabled {
            load_cache_observations(&index_path, &session_id, &timeline)
        } else {
            Vec::new()
        };

        Ok::<_, BindingsError>(PromptCacheResponse {
            timeline,
            observations,
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

/// Recorded cache reuse for the requests that resumed each window.
///
/// Read from the enrichment cache, never from the Copilot store directly:
/// the UI layer must not open that file, and a stale or absent cache is a
/// missing overlay rather than a failed request.
fn load_cache_observations(
    index_path: &Path,
    session_id: &str,
    timeline: &tracepilot_core::prompt_cache::PromptCacheTimeline,
) -> Vec<tracepilot_core::prompt_cache::CacheObservation> {
    if timeline.windows.is_empty() {
        return Vec::new();
    }
    let requests =
        tracepilot_indexer::index_db::IndexDb::open_readonly(index_path).and_then(|db| {
            if db
                .session_store_coverage(session_id)?
                .is_none_or(|coverage| coverage.freshness != "current")
            {
                return Ok(Vec::new());
            }
            db.all_session_requests(session_id)
        });
    match requests {
        Ok(requests) => {
            let core: Vec<_> = requests.iter().map(|request| request.to_core()).collect();
            tracepilot_core::prompt_cache::attach_observations(&timeline.windows, &core)
        }
        Err(error) => {
            tracing::debug!(%error, "Cache observations unavailable");
            Vec::new()
        }
    }
}
