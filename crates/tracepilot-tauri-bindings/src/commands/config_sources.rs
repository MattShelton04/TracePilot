//! Session-source settings: validating a source's folder, and what follows
//! a change to which sources are enabled.

use std::path::PathBuf;
use std::sync::Arc;

use tracepilot_core::provider::SessionProvider;
use tracepilot_core::provider::claude_code::ClaudeCodeProvider;

use crate::blocking_cmd;
use crate::concurrency::IndexingSemaphores;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::emit_best_effort;
use crate::services::config::SavedConfig;
use crate::types::{EventCache, TurnCache, ValidateSessionDirResult};

pub(super) fn clear_session_caches(turn_cache: &TurnCache, event_cache: &EventCache) {
    if let Ok(mut cache) = turn_cache.lock() {
        cache.clear();
    }
    if let Ok(mut cache) = event_cache.lock() {
        cache.clear();
    }
}

/// Check a Claude Code config folder and count its sessions, like
/// `validate_session_dir` does for Copilot.
#[tauri::command]
#[specta::specta]
pub async fn validate_claude_config_dir(path: String) -> CmdResult<ValidateSessionDirResult> {
    blocking_cmd!({
        let dir = PathBuf::from(path);
        let invalid = |error: String| ValidateSessionDirResult {
            valid: false,
            session_count: 0,
            error: Some(error),
        };
        if !dir.is_absolute() {
            return Ok(invalid(format!("Path must be absolute: {}", dir.display())));
        }
        if !dir.exists() {
            return Ok(invalid(format!(
                "Directory does not exist: {}",
                dir.display()
            )));
        }
        if !dir.is_dir() {
            return Ok(invalid(format!(
                "Path is not a directory: {}",
                dir.display()
            )));
        }
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
/// index each newly enabled source in the background.
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
    crate::commands::search::invalidate_facets_cache();
    if saved.sources.purged_any() {
        // Views refetch on this event; a purge changes the index like a pass.
        emit_best_effort(app, crate::events::INDEXING_FINISHED, ());
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
