//! Phase 2 search content indexing and rebuild.

use std::path::Path;

use rayon::prelude::*;

use crate::Result;
use crate::index_db;
use crate::indexing::progress::SearchIndexingProgress;

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
    // Use bulk write (drop triggers → insert → FTS rebuild) when many sessions
    // need indexing — ~5x faster than per-row trigger updates. Fall back to
    // per-session upsert for small incremental updates where the FTS rebuild
    // cost would outweigh the trigger savings.
    const BULK_THRESHOLD: usize = 10;
    let mut indexed = 0;
    let prepared_count = prepared.len();

    if prepared_count >= BULK_THRESHOLD {
        // Bulk path: collect all valid rows, write without triggers, rebuild FTS
        let bulk_data: Vec<(String, Vec<index_db::search_writer::SearchContentRow>)> = prepared
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
