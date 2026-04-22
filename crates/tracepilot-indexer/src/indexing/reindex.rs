//! Full and incremental reindex of session metadata and analytics.

use std::path::Path;

use rayon::prelude::*;

use crate::Result;
use crate::index_db;
use crate::indexing::progress::{IndexingProgress, ProgressTracker};

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

/// Full reindex with enriched progress callback including per-session data.
///
/// Uses Rayon to parse sessions in parallel (CPU/IO-bound), then writes
/// results to SQLite sequentially (rusqlite::Connection is !Send).
#[tracing::instrument(skip_all)]
pub fn reindex_all_with_rich_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(&IndexingProgress),
) -> Result<usize> {
    let reindex_start = std::time::Instant::now();
    let sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;

    let live_ids: std::collections::HashSet<&str> =
        sessions.iter().map(|s| s.id.as_str()).collect();

    let total = sessions.len();
    let mut tracker = ProgressTracker::new(total);

    // Emit initial progress so UI loading screen initializes immediately
    tracker.emit(&mut on_progress, None);

    // Phase 1: Parse all sessions in parallel (file I/O + JSON, no DB access)
    let prepared: Vec<_> = sessions
        .par_iter()
        .map(|session| {
            let result = index_db::session_writer::prepare_session_data(&session.path);
            (session.id.clone(), result)
        })
        .collect();

    // Phase 2: Write results to DB sequentially with throttled progress
    let mut indexed = 0;

    db.begin_transaction()?;
    for (session_id, parse_result) in prepared.into_iter() {
        let info = match parse_result {
            Ok(data) => match db.write_prepared_session(&data) {
                Ok(info) => {
                    indexed += 1;
                    tracker.accumulate(&info);
                    Some(info)
                }
                Err(e) => {
                    tracing::warn!(session_id = %session_id, error = %e, "Failed to write session");
                    None
                }
            },
            Err(e) => {
                tracing::warn!(session_id = %session_id, error = %e, "Failed to parse session");
                None
            }
        };

        tracker.increment();
        tracker.emit_if_ready(&mut on_progress, info);
    }
    db.commit_transaction()?;

    // Note: Final 100% emission is guaranteed by is_complete() check in emit_if_ready.
    // For zero sessions, the initial emit above covers it (current=0, total=0).

    tracing::debug!(
        indexed,
        total,
        elapsed_ms = reindex_start.elapsed().as_millis(),
        "Full reindex complete"
    );

    // Remove stale entries for sessions that no longer exist on disk
    match db.prune_deleted(&live_ids) {
        Ok(pruned) if pruned > 0 => {
            tracing::info!(pruned, "Pruned deleted sessions from index");
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to prune deleted sessions");
        }
        _ => {}
    }

    Ok(indexed)
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

/// Incremental reindex with enriched progress callback including per-session data.
///
/// Emits progress for every session (including skipped ones) so the loading
/// screen tracks smoothly. Stale sessions are parsed in parallel via Rayon,
/// then written sequentially.
#[tracing::instrument(skip_all)]
pub fn reindex_incremental_with_rich_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(&IndexingProgress),
) -> Result<(usize, usize)> {
    let phase1_start = std::time::Instant::now();
    let sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;

    let live_ids: std::collections::HashSet<&str> =
        sessions.iter().map(|s| s.id.as_str()).collect();

    let total = sessions.len();
    let mut tracker = ProgressTracker::new(total);

    // Step 1: Check staleness (sequential DB reads), emit throttled progress for skipped
    let mut stale_sessions = Vec::new();
    let mut skipped = 0;
    for session in &sessions {
        if db.needs_reindex(&session.id, &session.path) {
            stale_sessions.push(session);
        } else {
            skipped += 1;
            tracker.increment();
            tracker.emit_if_ready(&mut on_progress, None);
        }
    }

    // Note: is_complete() in should_emit() guarantees the last emit_if_ready
    // in the skip loop fires unconditionally, so no explicit final emit needed.

    // Step 2: Parse stale sessions in parallel (no DB access)
    let prepared: Vec<_> = stale_sessions
        .par_iter()
        .map(|session| {
            let result = index_db::session_writer::prepare_session_data(&session.path);
            (session.id.clone(), result)
        })
        .collect();

    // Step 3: Write results sequentially with progress
    let mut indexed = 0;

    // Batch size for transaction grouping — amortizes WAL fsyncs while keeping
    // lock duration reasonable for concurrent readers.
    const BATCH_SIZE: usize = 100;
    let mut batch_count = 0;
    let mut in_transaction = false;

    for (session_id, parse_result) in prepared.into_iter() {
        let info = match parse_result {
            Ok(data) => {
                if !in_transaction {
                    db.begin_transaction()?;
                    in_transaction = true;
                    batch_count = 0;
                }

                match db.write_prepared_session(&data) {
                    Ok(info) => {
                        indexed += 1;
                        batch_count += 1;
                        tracker.accumulate(&info);

                        // Commit batch when reaching BATCH_SIZE
                        if batch_count >= BATCH_SIZE {
                            db.commit_transaction()?;
                            in_transaction = false;
                        }

                        Some(info)
                    }
                    Err(e) => {
                        tracing::warn!(session_id = %session_id, error = %e, "Failed to write session");
                        None
                    }
                }
            }
            Err(e) => {
                tracing::warn!(session_id = %session_id, error = %e, "Failed to parse session");
                None
            }
        };

        tracker.increment();
        tracker.emit_if_ready(&mut on_progress, info);
    }

    // Commit any remaining batch
    if in_transaction {
        db.commit_transaction()?;
    }

    tracing::debug!(
        indexed,
        skipped,
        total,
        elapsed_ms = phase1_start.elapsed().as_millis(),
        "Incremental reindex complete"
    );

    // Prune sessions that no longer exist on disk
    match db.prune_deleted(&live_ids) {
        Ok(pruned) if pruned > 0 => {
            tracing::info!(pruned, "Pruned deleted sessions from index");
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to prune deleted sessions");
        }
        _ => {}
    }

    Ok((indexed, skipped))
}
