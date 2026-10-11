//! `get_session_turns` — turn reconstruction with LRU cache — and
//! `get_session_turn_activity`, the turns' start times read from that cache.

use tracepilot_core::ConversationTurn;
use tracepilot_core::provider::ResolvedSession;

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::with_session_locator;
use crate::types::{
    CachedTurns, EventCache, SourceStamp, TurnActivityResponse, TurnCache, TurnsResponse,
};

use super::shared::{load_cached_typed_events, source_stamp, system_time_to_unix_millis};

fn turns_response(mut turns: Vec<ConversationTurn>, stamp: &SourceStamp) -> TurnsResponse {
    tracepilot_core::turns::prepare_turns_for_ipc(&mut turns);
    TurnsResponse {
        turns,
        events_file_size: stamp.events_file_size,
        events_file_mtime: system_time_to_unix_millis(stamp.events_file_mtime),
    }
}

/// Each turn's start in Unix milliseconds, `None` when the turn has no timestamp.
fn turn_starts(turns: &[ConversationTurn]) -> Vec<Option<i64>> {
    turns
        .iter()
        .map(|turn| turn.timestamp.map(|t| t.timestamp_millis()))
        .collect()
}

/// Runs `read` over the session's reconstructed turns, from the LRU cache
/// while the source version is unchanged. `read` runs under the cache lock on
/// a hit, so it should only copy out what the caller needs.
fn read_turns<T>(
    session: &ResolvedSession,
    cache: &TurnCache,
    event_cache: &EventCache,
    read: impl FnOnce(&[ConversationTurn]) -> T,
) -> Result<(T, SourceStamp), BindingsError> {
    let session_id = session.locator.id.to_string();
    let stamp = source_stamp(session)?;
    let Ok(mut lru) = cache.lock() else {
        tracing::warn!("Turn cache Mutex poisoned — skipping cache read");
        let (events, stamp) = load_cached_typed_events(event_cache, session)?;
        let turns = tracepilot_core::turns::reconstruct_turns(events.as_ref());
        return Ok((read(&turns), stamp));
    };
    if let Some(cached) = lru
        .get(&session_id)
        .filter(|cached| cached.stamp.version == stamp.version)
    {
        return Ok((read(&cached.turns), stamp));
    }
    drop(lru);

    // Cache miss or stale — parse from disk
    let (events, stamp) = load_cached_typed_events(event_cache, session)?;
    let turns = tracepilot_core::turns::reconstruct_turns(events.as_ref());
    let value = read(&turns);

    // Store full (untrimmed) turns in LRU
    if let Ok(mut lru) = cache.lock() {
        lru.put(
            session_id,
            CachedTurns {
                turns,
                stamp: stamp.clone(),
            },
        );
    }
    Ok((value, stamp))
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
        // Clone the turns and run prepare_turns_for_ipc after releasing the
        // lock, to minimise Mutex hold time on concurrent IPC requests.
        let (turns, stamp) = read_turns(&session, &cache, &event_cache, <[_]>::to_vec)?;
        Ok(turns_response(turns, &stamp))
    })
    .await
}

/// The start time of every turn, for the overview's activity chart. Shares
/// the turn cache with `get_session_turns`, so it never ships turn content.
#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_turn_activity(
    state: tauri::State<'_, SharedConfig>,
    cache: tauri::State<'_, TurnCache>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<TurnActivityResponse> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    let cache = cache.inner().clone();
    let event_cache = event_cache.inner().clone();

    with_session_locator(&state, sid, move |session| {
        let (turn_starts, _) = read_turns(&session, &cache, &event_cache, turn_starts)?;
        Ok(TurnActivityResponse { turn_starts })
    })
    .await
}
