//! Phase 2 search content indexing and rebuild.

use std::path::Path;

use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::{SessionLocator, SessionSource};

use crate::Result;
use crate::index_db;
use crate::index_db::search_writer::SearchContentRow;
use crate::indexing::inventory::{self, SourcePass};
use crate::indexing::pipeline::{self, Flow};
use crate::indexing::progress::{SearchIndexingProgress, SourceProgress};
use crate::indexing::scope::IndexScope;
use crate::indexing::search_prepare;

/// Minimum session count for amortizing a shared search-write transaction.
const BULK_MIN_SESSIONS: usize = 10;

/// Choose between the bulk path (drop triggers → insert → rebuild FTS) and
/// per-session upserts (FTS maintained by triggers).
///
/// The bulk path rebuilds the *entire* FTS index, so its cost scales with the
/// whole index rather than with the changed rows. Measured on a 590-session /
/// 605k-row index: triggers sustain ~18k rows/s while the bulk rebuild runs at
/// ~108k rows of *total* index per second, so bulk only wins once the new rows
/// exceed roughly a sixth of the index. 10 small changed sessions took 5.8 s
/// in bulk mode versus 0.18 s via triggers; 30 very large ones (~40% of the
/// rows) remained faster in bulk mode. Bulk also covers the first index,
/// rebuilds and extractor upgrades, where `existing_rows` is 0 or the new rows
/// replace most of the index.
fn use_bulk_write(stale_sessions: usize, new_rows: usize, existing_rows: usize) -> bool {
    stale_sessions >= BULK_MIN_SESSIONS && new_rows.saturating_mul(5) >= existing_rows
}

/// Index search content for the Copilot sessions under `session_state_dir`
/// (Phase 2 — background). Returns (indexed_count, skipped_count).
pub fn reindex_search_content(
    session_state_dir: &Path,
    index_db_path: &Path,
    on_progress: impl FnMut(&SearchIndexingProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<(usize, usize)> {
    reindex_search_content_scoped(
        &IndexScope::copilot(session_state_dir),
        index_db_path,
        on_progress,
        is_cancelled,
    )
}

/// Index search content for every source in `scope` that needs it.
///
/// This should be called AFTER Phase 1 (main reindex) completes.
/// Alternates bounded source preparation and transactional search writes.
/// A source whose configuration changes mid-pass is skipped, and its current
/// batch rolled back. When `search_content` starts empty, the full-text index
/// is built once after the last write instead of with every batch; a
/// cancelled pass leaves that to the next one. Returns
/// (indexed_count, skipped_count).
#[tracing::instrument(skip_all)]
pub fn reindex_search_content_scoped(
    scope: &IndexScope,
    index_db_path: &Path,
    mut on_progress: impl FnMut(&SearchIndexingProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<(usize, usize)> {
    let phase2_start = std::time::Instant::now();
    let discovery = inventory::discover(scope, &is_cancelled);
    if is_cancelled() {
        return Ok((0, 0));
    }
    let passes = discovery?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;
    // A pass that deferred FTS sync stopped before rebuilding: catch up first.
    db.finish_deferred_search_fts()?;
    let total = passes.iter().map(|pass| pass.sessions.len()).sum();
    tracing::debug!(
        sessions = total,
        "Phase 2: starting search content indexing"
    );

    // Step 1: Collect sessions needing search reindex (sequential DB reads)
    let mut to_index = Vec::with_capacity(passes.len());
    let mut skipped = 0;
    for pass in &passes {
        let mut stale = Vec::new();
        for session in &pass.sessions {
            if is_cancelled() {
                tracing::info!(skipped, "Search indexing cancelled during staleness check");
                return Ok((0, skipped));
            }
            if db.search_is_stale(pass.provider.as_ref(), session) {
                stale.push(session);
            } else {
                skipped += 1;
            }
        }
        to_index.push(stale);
    }

    tracing::debug!(
        to_index = to_index.iter().map(Vec::len).sum::<usize>(),
        skipped,
        total,
        "Search reindex: staleness check complete"
    );

    if to_index.iter().all(Vec::is_empty) {
        on_progress(&SearchIndexingProgress {
            current: total,
            total,
            source: None,
        });
        return Ok((0, skipped));
    }

    // A first index syncs FTS once, after its writes (see `deferred_fts`).
    let fts_sync = if db.search_content_is_empty()? {
        FtsSync::AtEnd
    } else {
        FtsSync::PerBatch
    };
    let mut indexed = 0;
    let mut processed = skipped;
    for (pass, stale) in passes.iter().zip(&to_index) {
        let mut progress = SourceProgress {
            source: pass.provider.source(),
            current: pass.sessions.len() - stale.len(),
            total: pass.sessions.len(),
        };
        let (written, cancelled) =
            index_source(&db, scope, pass, stale, fts_sync, &is_cancelled, |batch| {
                processed += batch;
                progress.current += batch;
                on_progress(&SearchIndexingProgress {
                    current: processed,
                    total,
                    source: Some(progress),
                });
            })?;
        indexed += written;
        if cancelled {
            // Cancelling stops a pass before the index is deleted or
            // replaced, so a pending FTS rebuild waits for the next pass.
            return Ok((indexed, skipped));
        }
        if progress.current < progress.total {
            // The source went stale; count what it left as processed.
            processed += progress.total - progress.current;
            progress.current = progress.total;
            on_progress(&SearchIndexingProgress {
                current: processed,
                total,
                source: Some(progress),
            });
        }
    }

    // Every batch is committed: make them searchable.
    db.finish_deferred_search_fts()?;

    // Time-gated maintenance: fires on the first indexing pass after startup
    // (4-hour throttle), complete no-op during subsequent auto-refresh cycles.
    // With incremental auto_vacuum, freed pages are reused naturally.
    db.maintenance();

    tracing::debug!(
        indexed,
        skipped,
        total,
        elapsed_ms = phase2_start.elapsed().as_millis(),
        "Phase 2 complete"
    );

    Ok((indexed, skipped))
}

/// Keep only a bounded number of source batches resident (see [`pipeline`]).
/// The calling thread polls cancellation and writes each batch in order while
/// workers parse and extract the next ones.
///
/// Returns the sessions committed and whether the pass was cancelled. Stops
/// early, without failing, when the source's configuration changes.
fn index_source(
    db: &index_db::IndexDb,
    scope: &IndexScope,
    pass: &SourcePass,
    sessions: &[&SessionLocator],
    fts_sync: FtsSync,
    is_cancelled: &impl Fn() -> bool,
    mut on_batch: impl FnMut(usize),
) -> Result<(usize, bool)> {
    let source = pass.provider.source();
    // Writers check this after their writes and before committing.
    let stop = || is_cancelled() || !scope.is_current(source);
    let prepare = |session: &SessionLocator, cancelled: &dyn Fn() -> bool| {
        search_prepare::prepare_search(&pass.provider, session, &cancelled)
    };
    let mut indexed = 0;
    pipeline::prepare_and_write(sessions, &prepare, &stop, |batch, results| {
        let mut prepared = Vec::with_capacity(batch.len());
        let mut fingerprints = Vec::with_capacity(batch.len());
        for (session, result) in batch.iter().zip(results) {
            match result {
                Ok(snapshot) => {
                    prepared.push((snapshot.session_id, snapshot.rows));
                    fingerprints.push(snapshot.fingerprint);
                }
                Err(error) => tracing::warn!(session_id = %session.id, error = %error,
                    "Search snapshot not indexed; retaining previous content"),
            }
        }
        indexed += match fts_sync {
            FtsSync::PerBatch => write_batch(db, source, &prepared, &fingerprints, &stop)?,
            FtsSync::AtEnd => write_deferred(db, source, &prepared, &fingerprints, &stop),
        };
        if stop() {
            return Ok(Flow::Stop);
        }
        on_batch(batch.len());
        Ok(Flow::Continue)
    })?;
    Ok((indexed, is_cancelled()))
}

/// When a pass brings `search_fts` up to date with its writes.
#[derive(Clone, Copy)]
enum FtsSync {
    /// As each batch commits: through the sync triggers, or a bulk rebuild.
    PerBatch,
    /// Once, after the pass's last write (see `deferred_fts`).
    AtEnd,
}

/// Commit one prepared batch without FTS sync. A batch that fails is
/// skipped, keeping its sessions' previous state.
fn write_deferred(
    db: &index_db::IndexDb,
    source: SessionSource,
    prepared: &[(SessionId, Vec<SearchContentRow>)],
    fingerprints: &[String],
    stop: &impl Fn() -> bool,
) -> usize {
    match db.write_search_snapshots_deferred(source, prepared, fingerprints, stop) {
        Ok(count) => count,
        Err(_) if stop() => 0,
        Err(error) => {
            tracing::warn!(error = %error, "Search batch not committed; retaining previous content");
            0
        }
    }
}

/// Write one prepared batch, choosing the bulk or the per-session path.
fn write_batch(
    db: &index_db::IndexDb,
    source: SessionSource,
    prepared: &[(SessionId, Vec<SearchContentRow>)],
    fingerprints: &[String],
    stop: &impl Fn() -> bool,
) -> Result<usize> {
    let new_rows = prepared.iter().map(|(_, rows)| rows.len()).sum();
    let existing_rows = db.search_content_row_count()?;
    if use_bulk_write(prepared.len(), new_rows, existing_rows) {
        match db.bulk_write_search_snapshots(source, prepared, fingerprints, stop) {
            Ok(_) => return Ok(prepared.len()),
            Err(_) if stop() => return Ok(0),
            Err(error) => {
                tracing::warn!(error = %error, "Bulk search write failed; retrying individually");
            }
        }
    }
    if prepared.len() >= BULK_MIN_SESSIONS {
        return Ok(
            match db.upsert_search_snapshots(source, prepared, fingerprints, stop) {
                Ok(count) => count,
                Err(error) => {
                    tracing::warn!(error = %error,
                        "Search batch not committed; retaining previous content");
                    0
                }
            },
        );
    }
    // A few large sessions do not amortize transaction coalescing:
    // release SQLite/FTS write state between their individual commits.
    let mut indexed = 0;
    for ((session_id, rows), fingerprint) in prepared.iter().zip(fingerprints) {
        if stop() {
            break;
        }
        match db.upsert_search_snapshot(source, session_id, rows, Some(fingerprint), stop) {
            Ok(_) => indexed += 1,
            Err(error) => tracing::warn!(session_id = %session_id, error = %error,
                "Search content not written; retaining previous content"),
        }
    }
    Ok(indexed)
}

/// Full rebuild of the Copilot sessions under `session_state_dir`.
pub fn rebuild_search_content(
    session_state_dir: &Path,
    index_db_path: &Path,
    on_progress: impl FnMut(&SearchIndexingProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<(usize, usize)> {
    rebuild_search_content_scoped(
        &IndexScope::copilot(session_state_dir),
        index_db_path,
        on_progress,
        is_cancelled,
    )
}

/// Full rebuild: invalidate freshness, then atomically replace each complete snapshot.
#[tracing::instrument(skip_all)]
pub fn rebuild_search_content_scoped(
    scope: &IndexScope,
    index_db_path: &Path,
    on_progress: impl FnMut(&SearchIndexingProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<(usize, usize)> {
    let db = index_db::IndexDb::open_or_create(index_db_path)?;
    db.invalidate_search_content()?;
    drop(db);

    let result = reindex_search_content_scoped(scope, index_db_path, on_progress, is_cancelled);

    // Force full maintenance after rebuild — clear_search_content frees many
    // pages that should be reclaimed immediately, not deferred to next startup.
    if let Ok(db) = index_db::IndexDb::open_or_create(index_db_path) {
        db.maintenance_force();
    }

    result
}

#[cfg(test)]
mod tests {
    use super::use_bulk_write;

    #[test]
    fn bulk_write_only_when_new_rows_are_a_large_share_of_the_index() {
        // First index / rebuild: nothing (or little) to keep.
        assert!(use_bulk_write(590, 605_000, 0));
        assert!(use_bulk_write(10, 5_000, 0));
        // Routine incremental passes on a large index use triggers.
        assert!(!use_bulk_write(10, 1_200, 605_000));
        assert!(!use_bulk_write(40, 4_000, 605_000));
        // Many very large sessions: bulk rebuild is cheaper.
        assert!(use_bulk_write(30, 250_000, 605_000));
        // Fewer than the minimum session count never bulk-rebuilds.
        assert!(!use_bulk_write(9, 100_000, 0));
    }
}
