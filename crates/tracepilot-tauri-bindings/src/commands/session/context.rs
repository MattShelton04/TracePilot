//! `get_session_context_timeline` — on-demand context pressure reconstruction.

use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::with_session_locator;
use crate::types::{ContextTimelineResponse, EventCache};

use super::shared::{load_cached_typed_events, system_time_to_unix_millis};

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_context_timeline(
    state: tauri::State<'_, SharedConfig>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<ContextTimelineResponse> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    let event_cache = event_cache.inner().clone();

    with_session_locator(&state, sid, move |session| {
        let (events, stamp) = load_cached_typed_events(&event_cache, &session)?;
        Ok(ContextTimelineResponse {
            timeline: tracepilot_core::context_window::build_context_timeline(events.as_ref()),
            events_file_size: stamp.events_file_size,
            events_file_mtime: system_time_to_unix_millis(stamp.events_file_mtime),
        })
    })
    .await
}
