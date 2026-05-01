//! Search and session reindex orchestration commands.

use super::cache::invalidate_facets_cache;
use crate::concurrency::IndexingSemaphores;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{
    emit_best_effort, emit_indexing_progress, read_config, remove_index_db_files,
};
use std::sync::Arc;

/// Returns (updated, total) session counts.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn reindex_sessions(
    state: tauri::State<'_, SharedConfig>,
    gates: tauri::State<'_, Arc<IndexingSemaphores>>,
    app: tauri::AppHandle,
) -> CmdResult<(usize, usize)> {
    let permit = gates
        .try_acquire_sessions()
        .map_err(|_| BindingsError::AlreadyIndexing)?;

    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();
    let index_path = cfg.index_db_path();
    let app_handle = app.clone();

    emit_best_effort(&app, crate::events::INDEXING_STARTED, ());

    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let start = std::time::Instant::now();
        let app_fallback = app_handle.clone();
        let res = match tracepilot_indexer::reindex_incremental_with_rich_progress(
            &session_state_dir,
            &index_path,
            |progress| {
                emit_indexing_progress(&app_handle, progress);
            },
        ) {
            Ok((indexed, skipped)) => Ok((indexed, indexed + skipped)),
            Err(_) => tracepilot_indexer::reindex_all_with_rich_progress(
                &session_state_dir,
                &index_path,
                |progress| {
                    emit_indexing_progress(&app_fallback, progress);
                },
            )
            .map(|n| (n, n))
            .map_err(Into::into),
        };
        tracing::debug!(
            elapsed_ms = start.elapsed().as_millis(),
            "reindex_sessions Phase 1 wall time"
        );
        res
    })
    .await;

    emit_best_effort(&app, crate::events::INDEXING_FINISHED, ());

    // Invalidate facets cache after reindex.
    invalidate_facets_cache();

    // Phase 2: Kick off search content indexing in background (non-blocking).
    if result.as_ref().map(|r| r.is_ok()).unwrap_or(false) {
        let cfg2 = read_config(&state);
        spawn_search_content_phase2(
            gates.inner().clone(),
            cfg2.session_state_dir(),
            cfg2.index_db_path(),
            app.clone(),
            "reindex_sessions Phase 2 wall time",
            "Phase 2 search indexing failed",
            |sdir, ipath, on_progress| {
                tracepilot_indexer::reindex_search_content(sdir, ipath, on_progress, || false)
            },
        );
    }

    result?
}

/// Full reindex: delete the index DB and rebuild from scratch.
#[tauri::command]
pub async fn reindex_sessions_full(
    state: tauri::State<'_, SharedConfig>,
    gates: tauri::State<'_, Arc<IndexingSemaphores>>,
    app: tauri::AppHandle,
) -> CmdResult<(usize, usize)> {
    let permit = gates
        .try_acquire_sessions()
        .map_err(|_| BindingsError::AlreadyIndexing)?;

    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();
    let index_path = cfg.index_db_path();
    let app_handle = app.clone();

    emit_best_effort(&app, crate::events::INDEXING_STARTED, ());

    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;

        remove_index_db_files(&index_path)?;

        tracepilot_indexer::reindex_all_with_rich_progress(
            &session_state_dir,
            &index_path,
            |progress| {
                emit_indexing_progress(&app_handle, progress);
            },
        )
        .map(|n| (n, n))
        .map_err(Into::into)
    })
    .await;

    emit_best_effort(&app, crate::events::INDEXING_FINISHED, ());

    // Invalidate facets cache after full reindex.
    invalidate_facets_cache();

    // Phase 2: search content rebuild
    if result.as_ref().map(|r| r.is_ok()).unwrap_or(false) {
        let cfg2 = read_config(&state);
        spawn_search_content_phase2(
            gates.inner().clone(),
            cfg2.session_state_dir(),
            cfg2.index_db_path(),
            app.clone(),
            "rebuild_search_index Phase 2 wall time",
            "Phase 2 search rebuild failed",
            |sdir, ipath, on_progress| {
                tracepilot_indexer::rebuild_search_content(sdir, ipath, on_progress, || false)
            },
        );
    }

    result?
}

/// Rebuild the search index from scratch.
#[tauri::command]
pub async fn rebuild_search_index(
    state: tauri::State<'_, SharedConfig>,
    gates: tauri::State<'_, Arc<IndexingSemaphores>>,
    app: tauri::AppHandle,
) -> CmdResult<(usize, usize)> {
    if gates.sessions_available() == 0 {
        return Err(BindingsError::AlreadyIndexing);
    }
    let permit = gates
        .try_acquire_search()
        .map_err(|_| BindingsError::AlreadyIndexing)?;

    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();
    let index_path = cfg.index_db_path();
    let app_handle = app.clone();

    emit_best_effort(&app, crate::events::SEARCH_INDEXING_STARTED, ());

    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        tracepilot_indexer::rebuild_search_content(
            &session_state_dir,
            &index_path,
            |progress| {
                emit_best_effort(
                    &app_handle,
                    crate::events::SEARCH_INDEXING_PROGRESS,
                    serde_json::json!({
                        "current": progress.current,
                        "total": progress.total
                    }),
                );
            },
            || false,
        )
        .map_err(Into::into)
    })
    .await;

    let success = result.as_ref().map(|r| r.is_ok()).unwrap_or(false);
    if success {
        invalidate_facets_cache();
    }
    emit_best_effort(
        &app,
        crate::events::SEARCH_INDEXING_FINISHED,
        serde_json::json!({"success": success}),
    );
    result?
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Acquires the search semaphore and spawns a background `spawn_blocking` task
/// that runs a Phase 2 search-content job. The caller supplies `search_fn` so
/// that both `reindex_sessions` and `reindex_sessions_full` share identical
/// orchestration: semaphore guard, event emission, and logging.
fn spawn_search_content_phase2<F>(
    gates: std::sync::Arc<IndexingSemaphores>,
    session_state_dir: std::path::PathBuf,
    index_path: std::path::PathBuf,
    app: tauri::AppHandle,
    debug_label: &'static str,
    warn_label: &'static str,
    search_fn: F,
) where
    F: FnOnce(
            &std::path::Path,
            &std::path::Path,
            &mut dyn FnMut(&tracepilot_indexer::SearchIndexingProgress),
        ) -> tracepilot_indexer::Result<(usize, usize)>
        + Send
        + 'static,
{
    let Ok(permit) = gates.try_acquire_search() else {
        return;
    };
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let start = std::time::Instant::now();
        emit_best_effort(&app, crate::events::SEARCH_INDEXING_STARTED, ());
        match search_fn(&session_state_dir, &index_path, &mut |progress| {
            emit_best_effort(
                &app,
                crate::events::SEARCH_INDEXING_PROGRESS,
                serde_json::json!({
                    "current": progress.current,
                    "total": progress.total
                }),
            );
        }) {
            Ok((indexed, skipped)) => {
                tracing::debug!(
                    indexed,
                    skipped,
                    elapsed_ms = start.elapsed().as_millis(),
                    "{}",
                    debug_label
                );
                emit_best_effort(
                    &app,
                    crate::events::SEARCH_INDEXING_FINISHED,
                    serde_json::json!({"success": true}),
                );
            }
            Err(e) => {
                tracing::warn!(error = %e, "{}", warn_label);
                emit_best_effort(
                    &app,
                    crate::events::SEARCH_INDEXING_FINISHED,
                    serde_json::json!({"success": false, "error": e.to_string()}),
                );
            }
        }
    });
}
