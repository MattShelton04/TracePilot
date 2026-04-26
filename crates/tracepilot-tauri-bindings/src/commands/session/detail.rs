//! Per-session detail / incidents / shutdown-metrics commands.

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{read_config, with_session_path};
use crate::types::{EventCache, SessionIncidentItem};

use super::shared::load_cached_typed_events;

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_detail(
    state: tauri::State<'_, SharedConfig>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<tracepilot_core::SessionSummary> {
    crate::validators::validate_session_id(&session_id)?;

    let session_state_dir = read_config(&state).session_state_dir();
    let event_cache = event_cache.inner().clone();

    blocking_cmd!({
        let path = tracepilot_core::session::discovery::resolve_session_path_direct(
            &session_id,
            &session_state_dir,
        )?;
        let events_path = path.join("events.jsonl");

        // Use cached events — avoids re-parsing events.jsonl on every call.
        // Cache key is (session_id, file_size, mtime) so active sessions
        // (append-only) always get fresh data when the file changes.
        // On cache/parse error, gracefully degrade to empty events (matches
        // original load_session_summary behaviour of proceeding without event data).
        let events = if events_path.exists() {
            match load_cached_typed_events(&event_cache, &session_id, &events_path) {
                Ok((cached, _, _)) => cached,
                Err(e) => {
                    tracing::warn!(
                        path = %events_path.display(),
                        error = %e,
                        "Failed to load cached events for session detail; proceeding without event data"
                    );
                    std::sync::Arc::new(vec![])
                }
            }
        } else {
            std::sync::Arc::new(vec![])
        };

        Ok::<_, BindingsError>(tracepilot_core::summary::load_session_summary_from_events(
            &path, &events,
        )?)
    })
}

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(session_id = %session_id))]
pub async fn get_session_incidents(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<SessionIncidentItem>> {
    let sid = crate::validators::validate_session_id(&session_id)?;

    let cfg = read_config(&state);
    let index_path = cfg.index_db_path();

    blocking_cmd!({
        let db = tracepilot_indexer::index_db::IndexDb::open_readonly(&index_path)?;
        let incidents = db.get_session_incidents(&sid)?;
        Ok::<_, BindingsError>(
            incidents
                .into_iter()
                .map(|i| SessionIncidentItem {
                    event_type: i.event_type,
                    source_event_type: i.source_event_type,
                    timestamp: i.timestamp,
                    severity: i.severity,
                    summary: i.summary,
                    detail_json: i.detail_json.and_then(|s| serde_json::from_str(&s).ok()),
                })
                .collect(),
        )
    })
}

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(%session_id))]
pub async fn get_shutdown_metrics(
    state: tauri::State<'_, SharedConfig>,
    cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<Option<tracepilot_core::models::event_types::ShutdownData>> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    let cache = cache.inner().clone();
    let cache_session_id = session_id.clone();

    with_session_path(&state, sid, move |path| {
        let events_path = path.join("events.jsonl");
        let (events, _, _) = load_cached_typed_events(&cache, &cache_session_id, &events_path)?;
        Ok(
            tracepilot_core::parsing::events::extract_combined_shutdown_data(events.as_ref())
                .map(|(data, _count)| data),
        )
    })
    .await
}
