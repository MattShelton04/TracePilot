//! Per-session detail / incidents / shutdown-metrics commands.

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{read_config, with_session_locator};
use crate::types::{EventCache, SessionIncidentItem};

use super::shared::load_cached_typed_events;

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_detail(
    state: tauri::State<'_, SharedConfig>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<tracepilot_core::SessionSummary> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    let event_cache = event_cache.inner().clone();

    with_session_locator(&state, sid, move |session| {
        // Use cached events — avoids re-parsing the event log on every call.
        // The cache is keyed on the session's source_version, so active
        // sessions always get fresh data when a file changes. On cache or
        // parse error, gracefully degrade to empty events (matches original
        // load_session_summary behaviour of proceeding without event data).
        let events = match load_cached_typed_events(&event_cache, &session) {
            Ok((cached, _)) => cached,
            Err(e) => {
                tracing::warn!(
                    path = %session.locator.primary_path.display(),
                    error = %e,
                    "Failed to load cached events for session detail; proceeding without event data"
                );
                std::sync::Arc::new(vec![])
            }
        };

        Ok(session
            .provider
            .summary_from_events(&session.locator, &events)?)
    })
    .await
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
                    detail_json: i.detail_json.and_then(|s| {
                        tracepilot_core::TracePilotError::from_json_str(&s, "Incident Detail").ok()
                    }),
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

    with_session_locator(&state, sid, move |session| {
        let (events, _) = load_cached_typed_events(&cache, &session)?;
        Ok(super::provider_metrics::metrics_for_session(
            &session, &events,
        )?)
    })
    .await
}
