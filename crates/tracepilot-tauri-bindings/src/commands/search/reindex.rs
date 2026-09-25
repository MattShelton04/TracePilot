//! Search and session reindex orchestration commands.
//!
//! Concurrency model (see `crate::concurrency`):
//! - At most one session reindex and one search pass run at a time.
//! - Incremental session reindex requests *queue and coalesce*: a caller that
//!   arrives while a job is running waits, and is satisfied by the next job
//!   that started after it arrived. N concurrent callers cost at most two
//!   passes, never N.
//! - A search pass requested while one is running is re-run once afterwards,
//!   so newly indexed sessions always get search content.
//! - Destructive operations (full rebuild) cancel and wait for any running
//!   search pass before touching database files.

use super::cache::invalidate_facets_cache;
use crate::concurrency::{IndexingSemaphores, InitialBuildGuard};
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{
    emit_best_effort, emit_indexing_progress, open_index_db, read_config, remove_index_db_files,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::OwnedSemaphorePermit;

/// Returns (updated, total) session counts.
#[tauri::command]
#[tracing::instrument(skip_all)]
pub async fn reindex_sessions(
    state: tauri::State<'_, SharedConfig>,
    gates: tauri::State<'_, Arc<IndexingSemaphores>>,
    app: tauri::AppHandle,
) -> CmdResult<(usize, usize)> {
    run_incremental_reindex(&state, gates.inner(), &app).await
}

/// Run (or join) an incremental session reindex, then schedule search indexing.
///
/// Waits behind a running job instead of failing, and returns early with the
/// result of any job that started after this call arrived.
pub(crate) async fn run_incremental_reindex(
    state: &SharedConfig,
    gates: &Arc<IndexingSemaphores>,
    app: &tauri::AppHandle,
) -> CmdResult<(usize, usize)> {
    let ticket = gates.jobs().arrival_ticket();
    let permit = gates.acquire_sessions().await;
    if let Some(result) = gates.jobs().completed_since(ticket) {
        tracing::debug!("reindex_sessions coalesced with a newer completed job");
        return Ok(result);
    }
    let seq = gates.jobs().begin_job();

    let cfg = read_config(state);
    let session_state_dir = cfg.session_state_dir();
    let index_path = cfg.index_db_path();
    let app_handle = app.clone();
    let gates_for_job = Arc::clone(gates);

    emit_best_effort(app, crate::events::INDEXING_STARTED, ());

    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        // Readers wait for a build that starts from an empty index rather
        // than serving partial results or scanning every session from disk.
        let _initial = open_index_db(&index_path)
            .is_none()
            .then(|| InitialBuildGuard::start(Arc::clone(&gates_for_job)));
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
            Err(e) => {
                tracing::warn!(error = %e, "Incremental reindex failed; running full reindex");
                tracepilot_indexer::reindex_all_with_rich_progress(
                    &session_state_dir,
                    &index_path,
                    |progress| {
                        emit_indexing_progress(&app_fallback, progress);
                    },
                )
                .map(|n| (n, n))
                .map_err(Into::into)
            }
        };
        tracing::debug!(
            elapsed_ms = start.elapsed().as_millis(),
            "reindex_sessions Phase 1 wall time"
        );
        // Publish the result before the permit drops so queued callers see it.
        if let Ok(counts) = res {
            gates_for_job.jobs().complete_job(seq, counts);
        }
        res
    })
    .await;

    emit_best_effort(app, crate::events::INDEXING_FINISHED, ());

    // Invalidate facets cache after reindex.
    invalidate_facets_cache();

    let result = result?;
    if result.is_ok() {
        let cfg2 = read_config(state);
        spawn_search_content_phase2(
            Arc::clone(gates),
            None,
            cfg2.session_state_dir(),
            cfg2.index_db_path(),
            app.clone(),
            SearchPass::Incremental,
        );
    }
    result
}

/// Make the index usable for reads, building it on demand.
///
/// Index readers (session list, analytics) call this instead of scanning every
/// session on disk when the index is missing or empty. All concurrent readers
/// share one incremental build through the session gate, and none of them
/// observe a partially populated index while an initial build is running.
///
/// Returns `true` when the index is populated. Before first-run setup has
/// finished, the setup flow owns the initial build, so no build is started.
pub(crate) async fn ensure_index_ready(
    state: &SharedConfig,
    gates: &Arc<IndexingSemaphores>,
    app: &tauri::AppHandle,
) -> bool {
    gates.jobs().wait_initial_build().await;
    let cfg = read_config(state);
    let index_path = cfg.index_db_path();
    if index_populated(index_path.clone()).await {
        return true;
    }
    if !cfg.general.setup_complete {
        return false;
    }
    if let Err(e) = run_incremental_reindex(state, gates, app).await {
        tracing::warn!(error = %e, "On-demand index build failed");
        return false;
    }
    index_populated(index_path).await
}

async fn index_populated(index_path: PathBuf) -> bool {
    tokio::task::spawn_blocking(move || open_index_db(&index_path).is_some())
        .await
        .unwrap_or(false)
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
    // A background search pass may still be writing to the database we are
    // about to delete: stop it and hold its gate until the rebuild is done.
    let search_permit = gates.cancel_and_acquire_search().await;
    let seq = gates.jobs().begin_job();

    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();
    let index_path = cfg.index_db_path();
    let app_handle = app.clone();
    let gates_for_job = Arc::clone(gates.inner());

    emit_best_effort(&app, crate::events::INDEXING_STARTED, ());

    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let _initial = InitialBuildGuard::start(Arc::clone(&gates_for_job));

        remove_index_db_files(&index_path)?;

        let counts = tracepilot_indexer::reindex_all_with_rich_progress(
            &session_state_dir,
            &index_path,
            |progress| {
                emit_indexing_progress(&app_handle, progress);
            },
        )
        .map(|n| (n, n))?;
        gates_for_job.jobs().complete_job(seq, counts);
        Ok::<_, BindingsError>(counts)
    })
    .await;

    emit_best_effort(&app, crate::events::INDEXING_FINISHED, ());

    // Invalidate facets cache after full reindex.
    invalidate_facets_cache();

    let result = result?;
    if result.is_ok() {
        let cfg2 = read_config(&state);
        spawn_search_content_phase2(
            Arc::clone(gates.inner()),
            Some(search_permit),
            cfg2.session_state_dir(),
            cfg2.index_db_path(),
            app.clone(),
            SearchPass::Rebuild,
        );
    }
    result
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
    let gates_for_job = Arc::clone(gates.inner());

    emit_best_effort(&app, crate::events::SEARCH_INDEXING_STARTED, ());

    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        tracepilot_indexer::rebuild_search_content(
            &session_state_dir,
            &index_path,
            |progress| emit_search_progress(&app_handle, progress),
            || gates_for_job.jobs().search_cancelled(),
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

#[derive(Clone, Copy)]
enum SearchPass {
    Incremental,
    Rebuild,
}

impl SearchPass {
    fn run(
        self,
        session_state_dir: &Path,
        index_path: &Path,
        on_progress: impl FnMut(&tracepilot_indexer::SearchIndexingProgress),
        is_cancelled: impl Fn() -> bool,
    ) -> tracepilot_indexer::Result<(usize, usize)> {
        match self {
            Self::Incremental => tracepilot_indexer::reindex_search_content(
                session_state_dir,
                index_path,
                on_progress,
                is_cancelled,
            ),
            Self::Rebuild => tracepilot_indexer::rebuild_search_content(
                session_state_dir,
                index_path,
                on_progress,
                is_cancelled,
            ),
        }
    }
}

fn emit_search_progress(
    app: &tauri::AppHandle,
    progress: &tracepilot_indexer::SearchIndexingProgress,
) {
    emit_best_effort(
        app,
        crate::events::SEARCH_INDEXING_PROGRESS,
        serde_json::json!({
            "current": progress.current,
            "total": progress.total
        }),
    );
}

/// Spawn the background search-content pass (Phase 2).
///
/// With `permit = None` the search gate is acquired without blocking; if a
/// pass is already running, a rerun is requested instead so the sessions
/// indexed by this caller still receive search content once it finishes.
fn spawn_search_content_phase2(
    gates: Arc<IndexingSemaphores>,
    permit: Option<OwnedSemaphorePermit>,
    session_state_dir: PathBuf,
    index_path: PathBuf,
    app: tauri::AppHandle,
    pass: SearchPass,
) {
    let permit = match permit {
        Some(permit) => permit,
        None => match gates.try_acquire_search() {
            Ok(permit) => permit,
            Err(_) => {
                gates.jobs().request_search_rerun();
                return;
            }
        },
    };
    tokio::task::spawn_blocking(move || {
        let mut pass = pass;
        loop {
            let start = std::time::Instant::now();
            emit_best_effort(&app, crate::events::SEARCH_INDEXING_STARTED, ());
            let result = pass.run(
                &session_state_dir,
                &index_path,
                |progress| emit_search_progress(&app, progress),
                || gates.jobs().search_cancelled(),
            );
            match result {
                Ok((indexed, skipped)) => {
                    tracing::debug!(
                        indexed,
                        skipped,
                        elapsed_ms = start.elapsed().as_millis(),
                        "Phase 2 search indexing wall time"
                    );
                    if indexed > 0 {
                        invalidate_facets_cache();
                    }
                    emit_best_effort(
                        &app,
                        crate::events::SEARCH_INDEXING_FINISHED,
                        serde_json::json!({"success": true}),
                    );
                }
                Err(e) => {
                    tracing::warn!(error = %e, "Phase 2 search indexing failed");
                    emit_best_effort(
                        &app,
                        crate::events::SEARCH_INDEXING_FINISHED,
                        serde_json::json!({"success": false, "error": e.to_string()}),
                    );
                }
            }
            // Sessions indexed while this pass ran asked for a rerun. The
            // incremental staleness check makes a no-change rerun cheap.
            if gates.jobs().search_cancelled() || !gates.jobs().take_search_rerun() {
                break;
            }
            pass = SearchPass::Incremental;
        }
        drop(permit);
        // A request that raced with the release above must not be lost: start
        // another pass (which re-flags the rerun if someone else got the gate).
        if !gates.jobs().search_cancelled() && gates.jobs().take_search_rerun() {
            spawn_search_content_phase2(
                gates,
                None,
                session_state_dir,
                index_path,
                app,
                SearchPass::Incremental,
            );
        }
    });
}
