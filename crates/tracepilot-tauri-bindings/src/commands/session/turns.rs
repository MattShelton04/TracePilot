//! `get_session_turns` — turn reconstruction with LRU cache.

use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::with_session_locator;
use crate::types::{CachedTurns, EventCache, SourceStamp, TurnCache, TurnsResponse};

use super::shared::{load_cached_typed_events, source_stamp, system_time_to_unix_millis};

fn turns_response(
    mut turns: Vec<tracepilot_core::ConversationTurn>,
    stamp: &SourceStamp,
) -> TurnsResponse {
    tracepilot_core::turns::prepare_turns_for_ipc(&mut turns);
    TurnsResponse {
        turns,
        events_file_size: stamp.events_file_size,
        events_file_mtime: system_time_to_unix_millis(stamp.events_file_mtime),
    }
}

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_turns(
    state: tauri::State<'_, SharedConfig>,
    cache: tauri::State<'_, TurnCache>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<TurnsResponse> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    let cache = cache.inner().clone();
    let event_cache = event_cache.inner().clone();

    with_session_locator(&state, sid, move |session| {
        let session_id = session.locator.id.to_string();

        // Check the LRU cache: entries are valid while the source_version is
        // unchanged. Clone cache data and release the lock before running
        // prepare_turns_for_ipc to minimise Mutex hold time on concurrent
        // IPC requests.
        let stamp = source_stamp(&session)?;
        let Ok(mut lru) = cache.lock() else {
            tracing::warn!("Turn cache Mutex poisoned — skipping cache read");
            let (events, stamp) = load_cached_typed_events(&event_cache, &session)?;
            let turns = tracepilot_core::turns::reconstruct_turns(events.as_ref());
            return Ok(turns_response(turns, &stamp));
        };
        let cached_turns = lru
            .get(&session_id)
            .filter(|cached| cached.stamp.version == stamp.version)
            .map(|cached| cached.turns.clone());
        drop(lru);

        if let Some(turns) = cached_turns {
            return Ok(turns_response(turns, &stamp));
        }

        // Cache miss or stale — parse from disk
        let (events, stamp) = load_cached_typed_events(&event_cache, &session)?;
        let turns = tracepilot_core::turns::reconstruct_turns(events.as_ref());

        // Store full (untrimmed) turns in LRU
        if let Ok(mut lru) = cache.lock() {
            lru.put(
                session_id,
                CachedTurns {
                    turns: turns.clone(),
                    stamp: stamp.clone(),
                },
            );
        }

        Ok(turns_response(turns, &stamp))
    })
    .await
}
