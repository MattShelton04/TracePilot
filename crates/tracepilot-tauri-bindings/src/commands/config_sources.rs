//! Session-source settings: validating a source's folder, and what follows
//! a change to which sources are enabled.

use std::sync::Arc;
use std::time::Duration;

use tauri::Manager;

use tracepilot_core::provider::SessionProvider;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;

use crate::blocking_cmd;
use crate::concurrency::IndexingSemaphores;
use crate::config::{ConfigCoordinator, SharedConfig, canonical_claude_config_dir};
use crate::error::{BindingsError, CmdResult};
use crate::helpers::emit_best_effort;
use crate::services::config::SavedConfig;
use crate::services::source_change::{PendingPurge, retry_purges};
use crate::types::{EventCache, TurnCache, ValidateSessionDirResult};

pub(super) fn clear_session_caches(turn_cache: &TurnCache, event_cache: &EventCache) {
    if let Ok(mut cache) = turn_cache.lock() {
        cache.clear();
    }
    if let Ok(mut cache) = event_cache.lock() {
        cache.clear();
    }
}

/// Check a Claude Code config folder the way saving it will (ADR 0012), and
/// count its sessions.
#[tauri::command]
#[specta::specta]
pub async fn validate_claude_config_dir(path: String) -> CmdResult<ValidateSessionDirResult> {
    blocking_cmd!({
        let invalid = |error: String| ValidateSessionDirResult {
            valid: false,
            session_count: 0,
            error: Some(error),
        };
        let dir = match canonical_claude_config_dir(&path) {
            Ok(dir) => dir,
            Err(error) => return Ok(invalid(error)),
        };
        Ok::<_, BindingsError>(match ClaudeCodeProvider::new(&dir).discover(&|| false) {
            Ok(sessions) => ValidateSessionDirResult {
                valid: true,
                session_count: sessions.len(),
                error: None,
            },
            Err(error) => invalid(error.to_string()),
        })
    })
}

/// The steps that follow a source's purge (see `services::source_change`):
/// drop cached sessions and facets, tell the UI the index changed, then
/// index each newly enabled source in the background. A purge that failed is
/// retried in the background until it succeeds or a later change supersedes
/// it; the UI hears about the change only once the rows are gone.
pub(super) fn after_source_change(
    saved: &SavedConfig,
    state: &SharedConfig,
    gates: &Arc<IndexingSemaphores>,
    turn_cache: &TurnCache,
    event_cache: &EventCache,
    app: &tauri::AppHandle,
) {
    if saved.sources.is_empty() {
        return;
    }
    clear_session_caches(turn_cache, event_cache);
    crate::commands::search::invalidate_index_read_caches();
    if !saved.failed_purges.is_empty() {
        tracing::warn!("A disabled source's sessions are still indexed; retrying the purge");
        spawn_purge_retry(saved.failed_purges.clone(), state, gates, app);
    } else if saved.sources.purged_any() {
        announce_purge(gates, app);
    }
    if !saved.config.general.setup_complete {
        return;
    }
    for source in saved.sources.to_reindex() {
        let (state, gates, app) = (state.clone(), Arc::clone(gates), app.clone());
        tauri::async_runtime::spawn(async move {
            if let Err(error) =
                crate::commands::search::run_source_reindex(&state, &gates, &app, source).await
            {
                tracing::warn!(source = source.as_str(), error = %error, "Source reindex failed");
            }
        });
    }
}

/// Tell views a purge changed the index. Session lists refetch on
/// `INDEXING_FINISHED`; search counts refetch on `SEARCH_INDEXING_FINISHED`.
/// A running search pass announces that itself, after one more incremental
/// round, so its progress state is never cut short.
fn announce_purge(gates: &IndexingSemaphores, app: &tauri::AppHandle) {
    emit_best_effort(app, crate::events::INDEXING_FINISHED, ());
    match gates.try_acquire_search() {
        Ok(_idle) => emit_best_effort(
            app,
            crate::events::SEARCH_INDEXING_FINISHED,
            serde_json::json!({"success": true}),
        ),
        Err(_) => gates.jobs().request_search_rerun(gates.jobs().generation()),
    }
}

const PURGE_RETRY_MAX_DELAY: Duration = Duration::from_secs(60);

/// Retry failed purges, ordered with configuration changes like the first
/// attempt, backing off up to a minute between tries. Every full pass also
/// sweeps disabled sources, so this only shortens how long rows linger.
fn spawn_purge_retry(
    mut pending: Vec<PendingPurge>,
    state: &SharedConfig,
    gates: &Arc<IndexingSemaphores>,
    app: &tauri::AppHandle,
) {
    let (state, gates, app) = (state.clone(), Arc::clone(gates), app.clone());
    tauri::async_runtime::spawn(async move {
        let mut delay = Duration::from_secs(2);
        while !pending.is_empty() {
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(PURGE_RETRY_MAX_DELAY);
            let _ordered = app.state::<ConfigCoordinator>().mutation().await;
            let Some(index_path) = state
                .read()
                .ok()
                .and_then(|config| config.as_ref().map(|config| config.index_db_path()))
            else {
                return; // Factory reset removed the index.
            };
            let generations = Arc::clone(gates.jobs().source_generations());
            let before = pending.len();
            pending = match tokio::task::spawn_blocking(move || {
                retry_purges(&pending, &index_path, &generations)
            })
            .await
            {
                Ok(still) => still,
                Err(_) => return,
            };
            if pending.len() < before {
                clear_session_caches(&app.state::<TurnCache>(), &app.state::<EventCache>());
                crate::commands::search::invalidate_index_read_caches();
                announce_purge(&gates, &app);
            }
        }
    });
}
