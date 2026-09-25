//! Phase 2 search content indexing and rebuild.

use std::path::Path;

use rayon::prelude::*;

use crate::Result;
use crate::index_db;
use crate::indexing::progress::SearchIndexingProgress;

/// Minimum number of stale sessions before the bulk path is considered.
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
/// Collects sessions needing reindex, parses events in parallel with Rayon,
/// then writes search content sequentially.
/// Returns (indexed_count, skipped_count).
#[tracing::instrument(skip_all)]
pub fn reindex_search_content(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(&SearchIndexingProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<(usize, usize)> {
    let phase2_start = std::time::Instant::now();
    let sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
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

    // Step 2: Parse events + extract search content in parallel (no DB access)
    let prepared: Vec<_> = to_index
        .par_iter()
        .map(|session| {
            let events_path = session.path.join("events.jsonl");
            let content = if events_path.exists() {
                match tracepilot_core::parsing::events::parse_typed_events(&events_path) {
                    Ok(parsed) => Some(index_db::search_writer::extract_search_content(
                        &session.id,
                        &parsed.events,
                    )),
                    Err(e) => {
                        tracing::warn!(
                            session_id = %session.id,
                            error = %e,
                            "Failed to parse events for search indexing — skipping"
                        );
                        None
                    }
                }
            } else {
                Some(Vec::new())
            };
            (session.id.clone(), content)
        })
        .collect();

    // Check cancellation after parallel phase
    if is_cancelled() {
        tracing::info!("Search indexing cancelled after parse phase");
        return Ok((0, skipped));
    }

    // Step 3: Write search content to DB.
    let mut indexed = 0;
    let prepared_count = prepared.len();
    let new_rows: usize = prepared
        .iter()
        .filter_map(|(_, content)| content.as_ref().map(Vec::len))
        .sum();
    let existing_rows = db.search_content_row_count().unwrap_or(0);

    if use_bulk_write(prepared_count, new_rows, existing_rows) {
        // Bulk path: collect all valid rows, write without triggers, rebuild FTS
        let bulk_data: Vec<(
            tracepilot_core::ids::SessionId,
            Vec<index_db::search_writer::SearchContentRow>,
        )> = prepared
            .into_iter()
            .filter_map(|(id, content)| content.map(|rows| (id, rows)))
            .collect();

        if is_cancelled() {
            tracing::info!(
                indexed,
                skipped,
                "Search indexing cancelled before bulk write"
            );
            return Ok((indexed, skipped));
        }

        let bulk_count = bulk_data.len();
        match db.bulk_write_search_content(&bulk_data) {
            Ok(rows) => {
                indexed = bulk_count;
                tracing::debug!(sessions = bulk_count, rows, "Phase 2: bulk write complete");
            }
            Err(e) => {
                tracing::error!(error = %e, "Phase 2: bulk write failed, falling back to per-session");
                // Fall back to per-session writes
                for (session_id, rows) in &bulk_data {
                    if is_cancelled() {
                        tracing::info!(
                            indexed,
                            skipped,
                            "Search indexing cancelled during fallback write"
                        );
                        return Ok((indexed, skipped));
                    }
                    match db.upsert_search_content(session_id, rows) {
                        Ok(_) => indexed += 1,
                        Err(e) => {
                            tracing::warn!(
                                session_id = %session_id,
                                error = %e,
                                "Failed to write search content"
                            );
                        }
                    }
                }
            }
        }
        on_progress(&SearchIndexingProgress {
            current: total,
            total,
        });
    } else {
        // Incremental path: per-session upsert (triggers update FTS per row)
        for (i, (session_id, content)) in prepared.into_iter().enumerate() {
            if is_cancelled() {
                tracing::info!(indexed, skipped, "Search indexing cancelled during write");
                return Ok((indexed, skipped));
            }

            if let Some(ref rows) = content {
                let session_start = std::time::Instant::now();
                match db.upsert_search_content(&session_id, rows) {
                    Ok(_) => {
                        indexed += 1;
                        let elapsed = session_start.elapsed();
                        if elapsed.as_millis() > 100 {
                            tracing::debug!(
                                session_id = %session_id,
                                rows = rows.len(),
                                elapsed_ms = elapsed.as_millis(),
                                "Phase 2: slow session write"
                            );
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            session_id = %session_id,
                            error = %e,
                            "Failed to write search content"
                        );
                    }
                }
            }

            // Throttle progress events (every 5 sessions or at end)
            let progress_idx = skipped + i + 1;
            if (i + 1) % 5 == 0 || i + 1 == prepared_count || progress_idx == total {
                on_progress(&SearchIndexingProgress {
                    current: progress_idx,
                    total,
                });
            }
        }
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

/// Full rebuild of search content: clears everything and re-indexes all sessions.
#[tracing::instrument(skip_all)]
pub fn rebuild_search_content(
    session_state_dir: &Path,
    index_db_path: &Path,
    on_progress: impl FnMut(&SearchIndexingProgress),
    is_cancelled: impl Fn() -> bool,
) -> Result<(usize, usize)> {
    let db = index_db::IndexDb::open_or_create(index_db_path)?;
    db.clear_search_content()?;
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
