//! Phase 2 search content indexing and rebuild.

use std::path::Path;

use crate::Result;
use crate::index_db;
use crate::indexing::progress::SearchIndexingProgress;
use tracepilot_core::provider::SessionSource;

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

/// Index search content for sessions that need it (Phase 2 — background).
///
/// This should be called AFTER Phase 1 (main reindex) completes.
/// Alternates bounded source preparation and transactional search writes.
/// Returns (indexed_count, skipped_count).
#[tracing::instrument(skip_all)]
pub fn reindex_search_content(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(&SearchIndexingProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<(usize, usize)> {
    let phase2_start = std::time::Instant::now();
    let discovery = tracepilot_core::session::discovery::discover_sessions_cancellable(
        session_state_dir,
        &is_cancelled,
    );
    if is_cancelled() {
        return Ok((0, 0));
    }
    let sessions = discovery?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;
    tracing::debug!(
        sessions = sessions.len(),
        "Phase 2: starting search content indexing"
    );

    let total = sessions.len();

    // Step 1: Collect sessions needing search reindex (sequential DB reads)
    let mut to_index = Vec::new();
    let mut skipped = 0;

    for session in &sessions {
        if is_cancelled() {
            tracing::info!(skipped, "Search indexing cancelled during staleness check");
            return Ok((0, skipped));
        }
        if db.needs_search_reindex(&session.id, &session.path) {
            to_index.push(session);
        } else {
            skipped += 1;
        }
    }

    tracing::debug!(
        to_index = to_index.len(),
        skipped,
        total,
        "Search reindex: staleness check complete"
    );

    if to_index.is_empty() {
        on_progress(&SearchIndexingProgress {
            current: total,
            total,
        });
        return Ok((0, skipped));
    }

    // Keep only a bounded source batch resident. The calling thread polls
    // cancellation while workers parse and extract each source snapshot.
    let mut remaining = to_index.as_slice();
    let mut indexed = 0;
    let mut processed = skipped;
    while !remaining.is_empty() {
        if is_cancelled() {
            return Ok((indexed, skipped));
        }
        let batch = super::batches::take_batch(&mut remaining);
        let mut prepared = Vec::new();
        let mut fingerprints = Vec::new();
        for snapshot in super::search_prepare::prepare_batch(batch, &is_cancelled) {
            prepared.push((snapshot.session_id, snapshot.rows));
            fingerprints.push(snapshot.fingerprint);
        }
        if is_cancelled() {
            return Ok((indexed, skipped));
        }
        let new_rows = prepared.iter().map(|(_, rows)| rows.len()).sum();
        let existing_rows = db.search_content_row_count()?;
        let bulk = use_bulk_write(prepared.len(), new_rows, existing_rows);
        let bulk_done = if bulk {
            match db.bulk_write_search_snapshots(
                SessionSource::Copilot,
                &prepared,
                &fingerprints,
                &is_cancelled,
            ) {
                Ok(_) => {
                    indexed += prepared.len();
                    true
                }
                Err(error) => {
                    tracing::warn!(error = %error, "Bulk search write failed; retrying individually");
                    false
                }
            }
        } else {
            false
        };
        if !bulk_done {
            if prepared.len() >= BULK_MIN_SESSIONS {
                match db.upsert_search_snapshots(
                    SessionSource::Copilot,
                    &prepared,
                    &fingerprints,
                    &is_cancelled,
                ) {
                    Ok(count) => indexed += count,
                    Err(error) => tracing::warn!(error = %error,
                        "Search batch not committed; retaining previous content"),
                }
            } else {
                // A few large sessions do not amortize transaction coalescing:
                // release SQLite/FTS write state between their individual commits.
                for (snapshot, fingerprint) in prepared.iter().zip(&fingerprints) {
                    if is_cancelled() {
                        return Ok((indexed, skipped));
                    }
                    match db.upsert_search_snapshot(
                        SessionSource::Copilot,
                        &snapshot.0,
                        &snapshot.1,
                        Some(fingerprint),
                        &is_cancelled,
                    ) {
                        Ok(_) => indexed += 1,
                        Err(error) => tracing::warn!(session_id = %snapshot.0, error = %error,
                            "Search content not written; retaining previous content"),
                    }
                }
            }
        }
        if is_cancelled() {
            return Ok((indexed, skipped));
        }
        processed += batch.len();
        on_progress(&SearchIndexingProgress {
            current: processed,
            total,
        });
    }

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

/// Full rebuild: invalidate freshness, then atomically replace each complete snapshot.
#[tracing::instrument(skip_all)]
pub fn rebuild_search_content(
    session_state_dir: &Path,
    index_db_path: &Path,
    on_progress: impl FnMut(&SearchIndexingProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<(usize, usize)> {
    let db = index_db::IndexDb::open_or_create(index_db_path)?;
    db.invalidate_search_content()?;
    drop(db);

    let result =
        reindex_search_content(session_state_dir, index_db_path, on_progress, is_cancelled);

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
