//! Full and incremental reindex of session metadata and analytics, across
//! every source of an [`IndexScope`].

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;

use rayon::prelude::*;
use tracepilot_core::provider::{SessionLocator, SessionProvider, SessionSource};

use crate::Result;
use crate::error::IndexerError;
use crate::index_db;
use crate::index_db::session_writer::prepare_snapshot;
use crate::indexing::inventory::{self, SourcePass};
use crate::indexing::progress::{IndexingProgress, ProgressTracker};
use crate::indexing::scope::{IndexScope, stale_source};

/// Perform a full reindex of all sessions, pruning any that no longer exist on disk.
pub fn reindex_all(session_state_dir: &Path, index_db_path: &Path) -> Result<usize> {
    reindex_all_with_progress(session_state_dir, index_db_path, |_, _| {})
}

/// Full reindex with a simple progress callback invoked as `on_progress(current, total)`.
pub fn reindex_all_with_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(usize, usize),
) -> Result<usize> {
    reindex_all_with_rich_progress(session_state_dir, index_db_path, |p| {
        on_progress(p.current, p.total);
    })
}

/// Full reindex of the Copilot sessions under `session_state_dir`.
pub fn reindex_all_with_rich_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    on_progress: impl FnMut(&IndexingProgress),
) -> Result<usize> {
    reindex_all_scoped(
        &IndexScope::copilot(session_state_dir),
        index_db_path,
        on_progress,
    )
}

/// Full reindex of every source in `scope`, with enriched progress.
///
/// Uses Rayon to parse sessions in parallel (CPU/IO-bound), then writes
/// results to SQLite sequentially (rusqlite::Connection is !Send).
#[tracing::instrument(skip_all)]
pub fn reindex_all_scoped(
    scope: &IndexScope,
    index_db_path: &Path,
    on_progress: impl FnMut(&IndexingProgress),
) -> Result<usize> {
    reindex_sources(scope, index_db_path, false, on_progress).map(|(indexed, _)| indexed)
}

/// Reindex only sessions whose workspace.yaml/events.jsonl changed or analytics version bumped.
pub fn reindex_incremental(
    session_state_dir: &Path,
    index_db_path: &Path,
) -> Result<(usize, usize)> {
    reindex_incremental_with_progress(session_state_dir, index_db_path, |_, _| {})
}

/// Incremental reindex with a simple progress callback invoked as `on_progress(current, total)`.
pub fn reindex_incremental_with_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(usize, usize),
) -> Result<(usize, usize)> {
    reindex_incremental_with_rich_progress(session_state_dir, index_db_path, |p| {
        on_progress(p.current, p.total);
    })
}

/// Incremental reindex of the Copilot sessions under `session_state_dir`.
pub fn reindex_incremental_with_rich_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    on_progress: impl FnMut(&IndexingProgress),
) -> Result<(usize, usize)> {
    reindex_incremental_scoped(
        &IndexScope::copilot(session_state_dir),
        index_db_path,
        on_progress,
    )
}

/// Incremental reindex of every source in `scope`: only sessions whose
/// source fingerprint changed, or whose analytics version is old.
///
/// Emits progress for every session (including skipped ones) so the loading
/// screen tracks smoothly. Stale sessions are parsed in parallel via Rayon,
/// then written sequentially.
#[tracing::instrument(skip_all)]
pub fn reindex_incremental_scoped(
    scope: &IndexScope,
    index_db_path: &Path,
    on_progress: impl FnMut(&IndexingProgress),
) -> Result<(usize, usize)> {
    reindex_sources(scope, index_db_path, true, on_progress)
}

fn reindex_sources(
    scope: &IndexScope,
    index_db_path: &Path,
    incremental: bool,
    mut on_progress: impl FnMut(&IndexingProgress),
) -> Result<(usize, usize)> {
    let start = std::time::Instant::now();
    let passes = inventory::discover(scope, &|| false)?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;

    let total = passes.iter().map(|pass| pass.sessions.len()).sum();
    let mut tracker = ProgressTracker::new(total);
    if !incremental {
        // Emit initial progress so UI loading screen initializes immediately.
        // For zero sessions this is also the final emission.
        tracker.emit(&mut on_progress, None);
    }

    let (mut indexed, mut skipped) = (0, 0);
    for pass in &passes {
        let source = pass.provider.source();
        tracker.begin_source(source, pass.sessions.len());
        let mut stale = Vec::new();
        for session in &pass.sessions {
            if !incremental || db.session_is_stale(pass.provider.as_ref(), session) {
                stale.push(session);
            } else {
                skipped += 1;
                tracker.increment();
                tracker.emit_if_ready(&mut on_progress, None);
            }
        }
        match index_batches(
            &db,
            scope,
            &pass.provider,
            &stale,
            &mut tracker,
            &mut on_progress,
        ) {
            Ok(count) => indexed += count,
            Err(IndexerError::StaleSource { .. }) => {
                tracing::info!(
                    source = source.as_str(),
                    "Source configuration changed; its sessions were not indexed"
                );
                tracker.finish_source();
                tracker.emit_if_ready(&mut on_progress, None);
                continue;
            }
            Err(error) => return Err(error),
        }
        prune(&db, scope, pass);
    }
    // Final 100% emission is guaranteed by is_complete() in emit_if_ready.

    tracing::debug!(
        indexed,
        skipped,
        total,
        incremental,
        elapsed_ms = start.elapsed().as_millis(),
        "Reindex complete"
    );
    Ok((indexed, skipped))
}

/// Remove a source's sessions that no longer exist, but only after a
/// complete inventory of its root.
fn prune(db: &index_db::IndexDb, scope: &IndexScope, pass: &SourcePass) {
    let source = pass.provider.source();
    if !pass.complete {
        return;
    }
    let live_ids: HashSet<&str> = pass.sessions.iter().map(|s| s.id.as_str()).collect();
    match db.prune_source(source, &live_ids, &|| scope.is_current(source)) {
        Ok(pruned) if pruned > 0 => {
            tracing::info!(
                source = source.as_str(),
                pruned,
                "Pruned deleted sessions from index"
            );
        }
        Err(e) => {
            tracing::warn!(source = source.as_str(), error = %e, "Failed to prune deleted sessions");
        }
        _ => {}
    }
}

/// Preparation and database writes alternate so memory is independent of the
/// total number of sessions. SQLite transactions are bounded by the same batch.
///
/// Fails with [`IndexerError::StaleSource`], after rolling back the current
/// batch, when the source's configuration changes.
fn index_batches(
    db: &index_db::IndexDb,
    scope: &IndexScope,
    provider: &Arc<dyn SessionProvider>,
    sessions: &[&SessionLocator],
    tracker: &mut ProgressTracker,
    on_progress: &mut impl FnMut(&IndexingProgress),
) -> Result<usize> {
    let source: SessionSource = provider.source();
    let is_stale = || !scope.is_current(source);
    let mut remaining = sessions;
    let mut indexed = 0;
    while !remaining.is_empty() {
        if is_stale() {
            return Err(stale_source(source));
        }
        let batch = super::batches::take_batch(&mut remaining);
        let prepared: Vec<_> = batch
            .par_iter()
            .map(|session| {
                (
                    session.id.clone(),
                    prepare_snapshot(provider, session, &is_stale),
                )
            })
            .collect();
        indexed += db.with_transaction(|db| {
            let mut written = 0;
            for (session_id, result) in prepared {
                let info = match result.and_then(|data| db.write_prepared_session(&data)) {
                    Ok(info) => {
                        written += 1;
                        tracker.accumulate(&info);
                        Some(info)
                    }
                    Err(error) => {
                        tracing::warn!(session_id = %session_id, error = %error, "Session snapshot not indexed; retaining previous data");
                        None
                    }
                };
                tracker.increment();
                tracker.emit_if_ready(on_progress, info);
            }
            // The writes above hold the write lock, so a purge that follows a
            // generation bump waits for this commit and then removes its rows.
            if is_stale() {
                return Err(stale_source(source));
            }
            Ok(written)
        })?;
    }
    Ok(indexed)
}
