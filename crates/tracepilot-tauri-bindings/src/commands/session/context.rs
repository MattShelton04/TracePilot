//! `get_session_context_timeline` — on-demand context pressure reconstruction.

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::{ContextTimelineResponse, EventCache};

use super::shared::{load_cached_typed_events, system_time_to_unix_millis};

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_context_timeline(
    state: tauri::State<'_, SharedConfig>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<ContextTimelineResponse> {
    crate::validators::validate_session_id(&session_id)?;

    let session_state_dir = read_config(&state).session_state_dir();
    let event_cache = event_cache.inner().clone();

    blocking_cmd!({
        let path = tracepilot_core::session::discovery::resolve_session_path_direct(
            &session_id,
            &session_state_dir,
        )?;
        let events_path = tracepilot_core::paths::SessionPaths::from_root(&path).events_jsonl();
        let (events, events_file_size, events_file_mtime) =
            load_cached_typed_events(&event_cache, &session_id, &events_path)?;
        Ok::<_, BindingsError>(ContextTimelineResponse {
            timeline: tracepilot_core::context_window::build_context_timeline(events.as_ref()),
            events_file_size,
            events_file_mtime: system_time_to_unix_millis(events_file_mtime),
        })
    })
}
