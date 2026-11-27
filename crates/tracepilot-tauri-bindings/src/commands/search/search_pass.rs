//! The background search pass (Phase 2): which pass runs, and the loop that
//! reruns it while sessions keep being indexed.

use super::cache::invalidate_index_read_caches;
use super::reindex_lifecycle::IndexTarget;
use crate::concurrency::IndexingSemaphores;
use crate::helpers::emit_best_effort;
use crate::types::SourceProgressPayload;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::OwnedSemaphorePermit;
use tracepilot_indexer::IndexScope;

pub(super) enum SearchPass {
    Incremental,
    Rebuild,
    /// The search content a session pass extracted for the sessions it
    /// indexed. It covers every session only while the search epoch is
    /// still `epoch`; otherwise, or if any of it isn't written, the
    /// incremental pass runs instead.
    Handoff {
        handoff: tracepilot_indexer::SearchHandoff,
        epoch: u64,
    },
}

impl SearchPass {
    /// Run the pass, which started at search epoch `epoch`.
    fn run(
        self,
        epoch: u64,
        scope: &IndexScope,
        index_path: &Path,
        on_progress: impl FnMut(&tracepilot_indexer::SearchIndexingProgress),
        is_cancelled: impl Fn() -> bool,
    ) -> tracepilot_indexer::Result<tracepilot_indexer::PassCoverage> {
        match self {
            Self::Handoff {
                handoff,
                epoch: covers,
            } if covers == epoch => {
                let sessions = handoff.len();
                match tracepilot_indexer::write_search_handoff(
                    handoff,
                    scope,
                    index_path,
                    &is_cancelled,
                ) {
                    Ok(pass) if pass.complete || is_cancelled() => return Ok(pass),
                    Ok(_) => tracing::debug!(
                        sessions,
                        "Search handoff incomplete; running the search pass"
                    ),
                    Err(error) => {
                        tracing::warn!(error = %error, "Search handoff failed; running the search pass")
                    }
                }
                Self::Incremental.run(epoch, scope, index_path, on_progress, is_cancelled)
            }
            Self::Incremental | Self::Handoff { .. } => {
                tracepilot_indexer::reindex_search_content_covered(
                    scope,
                    index_path,
                    on_progress,
                    is_cancelled,
                )
            }
            Self::Rebuild => tracepilot_indexer::rebuild_search_content_covered(
                scope,
                index_path,
                on_progress,
                is_cancelled,
            ),
        }
    }
}

pub(super) fn emit_search_progress(
    app: &tauri::AppHandle,
    progress: &tracepilot_indexer::SearchIndexingProgress,
) {
    emit_best_effort(
        app,
        crate::events::SEARCH_INDEXING_PROGRESS,
        serde_json::json!({
            "current": progress.current,
            "total": progress.total,
            "source": progress.source.map(SourceProgressPayload::from),
        }),
    );
}

/// Spawn the background search-content pass (Phase 2).
///
/// With `permit = None` the search gate is acquired without blocking; if a
/// pass is already running, a rerun is requested instead so the sessions
/// indexed by this caller still receive search content once it finishes.
pub(super) fn spawn_search_content_phase2(
    gates: Arc<IndexingSemaphores>,
    permit: Option<OwnedSemaphorePermit>,
    target: IndexTarget,
    app: tauri::AppHandle,
    pass: SearchPass,
) {
    let permit = match permit {
        Some(permit) => permit,
        None => match gates.try_acquire_search() {
            Ok(permit) => permit,
            Err(_) => {
                if target.is_current(&gates) {
                    gates.jobs().request_search_rerun(target.generation);
                }
                return;
            }
        },
    };
    if !target.is_current(&gates) {
        return;
    }
    tokio::task::spawn_blocking(move || {
        let mut pass = pass;
        let mut target = target;
        loop {
            let start = std::time::Instant::now();
            let epoch = gates.jobs().search_epoch();
            emit_best_effort(&app, crate::events::SEARCH_INDEXING_STARTED, ());
            let result = std::mem::replace(&mut pass, SearchPass::Incremental).run(
                epoch,
                &target.scope,
                &target.index_path,
                |progress| emit_search_progress(&app, progress),
                || gates.jobs().search_cancelled(),
            );
            // Every source listed and every session indexed or found fresh.
            if result.as_ref().is_ok_and(|pass| pass.complete) && !gates.jobs().search_cancelled() {
                gates.jobs().mark_search_clean(epoch);
            }
            // Even a pass that failed or indexed nothing may have committed
            // batches or removed stale rows.
            invalidate_index_read_caches();
            match result {
                Ok(pass) => {
                    tracing::debug!(
                        indexed = pass.indexed,
                        skipped = pass.skipped,
                        elapsed_ms = start.elapsed().as_millis(),
                        "Phase 2 search indexing wall time"
                    );
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
            if gates.jobs().search_cancelled() || !gates.jobs().take_search_rerun(target.generation)
            {
                break;
            }
            pass = SearchPass::Incremental;
            // A source turned on or moved since the capture asked for this rerun.
            match target.refreshed(&gates) {
                Ok(current) => target = current,
                Err(_) => break,
            }
        }
        drop(permit);
        // A request that raced with the release above must not be lost: start
        // another pass (which re-flags the rerun if someone else got the gate).
        if !gates.jobs().search_cancelled()
            && gates.jobs().take_search_rerun(target.generation)
            && let Ok(target) = target.refreshed(&gates)
        {
            spawn_search_content_phase2(gates, None, target, app, SearchPass::Incremental);
        }
    });
}
