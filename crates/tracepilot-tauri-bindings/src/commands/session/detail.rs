//! Per-session detail / incidents / shutdown-metrics commands.

use std::path::Path;

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{read_config, with_session_locator};
use crate::types::{EventCache, SessionDetailResponse, SessionIncidentItem};
use tracepilot_core::provider::ResolvedSession;

use super::shared::load_cached_summary;

#[tauri::command]
#[tracing::instrument(skip_all, fields(%session_id))]
pub async fn get_session_detail(
    state: tauri::State<'_, SharedConfig>,
    event_cache: tauri::State<'_, EventCache>,
    session_id: String,
) -> CmdResult<SessionDetailResponse> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    let event_cache = event_cache.inner().clone();

    with_session_locator(&state, sid, move |session| {
        session_detail(&event_cache, &session)
    })
    .await
}

/// The session's summary and source. Blocking.
pub(super) fn session_detail(
    event_cache: &EventCache,
    session: &ResolvedSession,
) -> Result<SessionDetailResponse, BindingsError> {
    // Cached per source_version, so active sessions get fresh data when
    // any of their files changes. On a load error, degrade to a summary
    // without event data (the original load_session_summary behaviour).
    let summary = match load_cached_summary(event_cache, session) {
        Ok(summary) => summary,
        Err(e) => {
            tracing::warn!(
                path = %session.locator.primary_path.display(),
                error = %e,
                "Failed to load cached events for session detail; proceeding without event data"
            );
            session
                .provider
                .summary_from_events(&session.locator, &[])?
        }
    };
    Ok(SessionDetailResponse {
        source: session.locator.source,
        folder: session_folder(&session.locator.primary_path)
            .map(|folder| folder.to_string_lossy().into_owned()),
        summary,
    })
}

/// The folder to open for a session: its own directory when the source keeps
/// one per session (Copilot), otherwise the folder holding its main file.
/// For Claude Code that is the project folder, which holds the `<id>.jsonl`
/// transcript and, when the session has one, its `<id>/` folder of subagent
/// transcripts and tool results.
fn session_folder(primary_path: &Path) -> Option<&Path> {
    if primary_path.is_dir() {
        Some(primary_path)
    } else {
        primary_path.parent()
    }
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
        super::provider_metrics::metrics_for_session(&session, &cache)
    })
    .await
}
