//! `get_session_turns` — turn reconstruction with LRU cache.

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::{CachedTurns, EventCache, TurnCache, TurnsResponse};

use super::shared::{load_cached_typed_events, system_time_to_unix_millis};

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_turns(
    state: tauri::State<'_, SharedConfig>,
    cache: tauri::State<'_, TurnCache>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<TurnsResponse> {
    crate::validators::validate_session_id(&session_id)?;

    let session_state_dir = read_config(&state).session_state_dir();
    let cache = cache.inner().clone();
    let event_cache = event_cache.inner().clone();

    blocking_cmd!({
        let path = tracepilot_core::session::discovery::resolve_session_path_in(
            &session_id,
            &session_state_dir,
        )?;
        let events_path = path.join("events.jsonl");

        // Check LRU cache — return if file size unchanged (append-only).
        // Clone cache data and release lock before running prepare_turns_for_ipc
        // to minimise Mutex hold time on concurrent IPC requests.
        let cached_turns = {
            let meta = std::fs::metadata(&events_path).ok();
            let file_size = meta.as_ref().map_or(0, |m| m.len());
            let file_mtime = meta.and_then(|m| m.modified().ok());
            let Ok(mut lru) = cache.lock() else {
                tracing::warn!("Turn cache Mutex poisoned — skipping cache read");
                let (events, events_file_size, events_file_mtime) =
                    load_cached_typed_events(&event_cache, &session_id, &events_path)?;
                let turns = tracepilot_core::turns::reconstruct_turns(events.as_ref());
                let mut ipc_turns = turns;
                tracepilot_core::turns::prepare_turns_for_ipc(&mut ipc_turns);
                return Ok(TurnsResponse {
                    turns: ipc_turns,
                    events_file_size,
                    events_file_mtime: system_time_to_unix_millis(events_file_mtime),
                });
            };
            (
                lru.get(&session_id)
                    .filter(|cached| {
                        cached.events_file_size == file_size
                            && cached.events_file_mtime == file_mtime
                    })
                    .map(|cached| cached.turns.clone()),
                file_size,
                file_mtime,
            )
        };

        if let (Some(mut turns), file_size, file_mtime) = cached_turns {
            tracepilot_core::turns::prepare_turns_for_ipc(&mut turns);
            return Ok(TurnsResponse {
                turns,
                events_file_size: file_size,
                events_file_mtime: system_time_to_unix_millis(file_mtime),
            });
        }

        // Cache miss or stale — parse from disk
        let (events, events_file_size, events_file_mtime) =
            load_cached_typed_events(&event_cache, &session_id, &events_path)?;
        let turns = tracepilot_core::turns::reconstruct_turns(events.as_ref());

        // Store full (untrimmed) turns in LRU
        if let Ok(mut lru) = cache.lock() {
            lru.put(
                session_id.clone(),
                CachedTurns {
                    turns: turns.clone(),
                    events_file_size,
                    events_file_mtime,
                },
            );
        }

        let mut ipc_turns = turns;
        tracepilot_core::turns::prepare_turns_for_ipc(&mut ipc_turns);
        Ok::<_, BindingsError>(TurnsResponse {
            turns: ipc_turns,
            events_file_size,
            events_file_mtime: system_time_to_unix_millis(events_file_mtime),
        })
    })
}
