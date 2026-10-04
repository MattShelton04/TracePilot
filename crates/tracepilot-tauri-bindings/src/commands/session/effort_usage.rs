//! `get_session_effort_usage` — user turns per model and reasoning effort.

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::{EffortUsageResponse, EventCache};

use super::shared::{load_cached_typed_events, system_time_to_unix_millis};

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_effort_usage(
    state: tauri::State<'_, SharedConfig>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<EffortUsageResponse> {
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
        let turns = tracepilot_core::turns::reconstruct_turns(events.as_ref());
        // Read live so a running session's latest requests appear.
        let requests = tracepilot_core::session_store::read_request_usage(&path);
        let usage = tracepilot_core::effort_usage::build_effort_usage(&turns, requests.as_deref());

        Ok::<_, BindingsError>(EffortUsageResponse {
            usage,
            events_file_size,
            events_file_mtime: system_time_to_unix_millis(events_file_mtime),
        })
    })
}
