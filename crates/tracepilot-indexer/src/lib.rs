//! tracepilot-indexer: Maintain a local index database for fast session search.
//!
//! Creates and incrementally updates `~/.copilot/tracepilot/index.db` with:
//! - Session metadata from workspace.yaml
//! - Shutdown metrics
//! - FTS5 full-text search over summaries and messages

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rayon::prelude::*;

/// Minimum interval between progress events to avoid flooding IPC.
const PROGRESS_THROTTLE: Duration = Duration::from_millis(80);

pub mod error;
pub mod index_db;

pub use error::{IndexerError, Result};

pub use index_db::SessionIndexInfo;
pub use index_db::{SearchFacets, SearchFilters, SearchResult, SearchStats};
pub use index_db::search_reader::sanitize_fts_query;

/// Accumulated progress info emitted per session during indexing.
#[derive(Debug, Clone)]
pub struct IndexingProgress {
    pub current: usize,
    pub total: usize,
    /// Info about the session just processed (None if indexing failed for this session).
    pub session_info: Option<SessionIndexInfo>,
    /// Running totals across all successfully indexed sessions so far.
    pub running_tokens: u64,
    pub running_events: u64,
    pub running_repos: usize,
}

/// Default path for the TracePilot index database.
pub fn default_index_db_path() -> PathBuf {
    tracepilot_core::utils::home_dir()
        .join(".copilot")
        .join("tracepilot")
        .join("index.db")
}

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

    let live_ids: std::collections::HashSet<String> =
        sessions.iter().map(|s| s.id.clone()).collect();

    let total = sessions.len();

    // Emit initial progress so UI loading screen initializes immediately
    on_progress(&IndexingProgress {
        current: 0,
        total,
        session_info: None,
        running_tokens: 0,
        running_events: 0,
        running_repos: 0,
    });

    // Phase 1: Parse all sessions in parallel (file I/O + JSON, no DB access)
    let prepared: Vec<_> = sessions
        .par_iter()
        .map(|session| {
            let result = index_db::session_writer::prepare_session_data(&session.path);
            (session.id.clone(), result)
        })
        .collect();

    // Phase 2: Write results to DB sequentially with throttled progress
    let mut running_tokens: u64 = 0;
    let mut running_events: u64 = 0;
    let mut seen_repos = std::collections::HashSet::new();
    let mut indexed = 0;
    let mut last_progress = Instant::now();

    db.begin_transaction()?;
    for (i, (session_id, parse_result)) in prepared.into_iter().enumerate() {
        let info = match parse_result {
            Ok(data) => match db.write_prepared_session(&data) {
                Ok(info) => {
                    indexed += 1;
                    running_tokens += info.total_tokens;
                    running_events += info.event_count as u64;
                    if let Some(ref repo) = info.repository {
                        seen_repos.insert(repo.clone());
                    }
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

        // Throttle IPC progress events: emit at most every PROGRESS_THROTTLE,
        // but always emit the final event so the UI reaches 100%.
        let is_last = i + 1 == total;
        if is_last || last_progress.elapsed() >= PROGRESS_THROTTLE {
            on_progress(&IndexingProgress {
                current: i + 1,
                total,
                session_info: info,
                running_tokens,
                running_events,
                running_repos: seen_repos.len(),
            });
            last_progress = Instant::now();
        }
    }
    db.commit_transaction()?;

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

    let live_ids: std::collections::HashSet<String> =
        sessions.iter().map(|s| s.id.clone()).collect();

    let total = sessions.len();
    let mut running_tokens: u64 = 0;
    let mut running_events: u64 = 0;
    let mut seen_repos = std::collections::HashSet::new();

    // Step 1: Check staleness (sequential DB reads), emit throttled progress for skipped
    let mut stale_sessions = Vec::new();
    let mut skipped = 0;
    let mut last_progress = Instant::now();
    for session in &sessions {
        if db.needs_reindex(&session.id, &session.path) {
            stale_sessions.push(session);
        } else {
            skipped += 1;
            if last_progress.elapsed() >= PROGRESS_THROTTLE {
                on_progress(&IndexingProgress {
                    current: skipped + stale_sessions.len(),
                    total,
                    session_info: None,
                    running_tokens,
                    running_events,
                    running_repos: seen_repos.len(),
                });
                last_progress = Instant::now();
            }
        }
    }

    // If nothing needs reindex, emit a final progress event so the UI reaches 100%
    if stale_sessions.is_empty() && total > 0 {
        on_progress(&IndexingProgress {
            current: total,
            total,
            session_info: None,
            running_tokens,
            running_events,
            running_repos: seen_repos.len(),
        });
    }

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

    for (i, (session_id, parse_result)) in prepared.into_iter().enumerate() {
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
                        running_tokens += info.total_tokens;
                        running_events += info.event_count as u64;
                        if let Some(ref repo) = info.repository {
                            seen_repos.insert(repo.clone());
                        }

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

        // Throttle progress — always emit the final event
        let is_last = skipped + i + 1 == total;
        if is_last || last_progress.elapsed() >= PROGRESS_THROTTLE {
            on_progress(&IndexingProgress {
                current: skipped + i + 1,
                total,
                session_info: info,
                running_tokens,
                running_events,
                running_repos: seen_repos.len(),
            });
            last_progress = Instant::now();
        }
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

/// Progress info for search content indexing (Phase 2).
#[derive(Debug, Clone)]
pub struct SearchIndexingProgress {
    pub current: usize,
    pub total: usize,
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
    tracing::debug!(sessions = sessions.len(), "Phase 2: starting search content indexing");

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
        on_progress(&SearchIndexingProgress { current: total, total });
        return Ok((0, skipped));
    }

    // Step 2: Parse events + extract search content in parallel (no DB access)
    let prepared: Vec<_> = to_index
        .par_iter()
        .map(|session| {
            let events_path = session.path.join("events.jsonl");
            let content = if events_path.exists() {
                match tracepilot_core::parsing::events::parse_typed_events(&events_path) {
                    Ok(parsed) => {
                        Some(index_db::search_writer::extract_search_content(
                            &session.id,
                            &parsed.events,
                        ))
                    }
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

        let bulk_count = bulk_data.len();
        match db.bulk_write_search_content(&bulk_data) {
            Ok(rows) => {
                indexed = bulk_count;
                tracing::debug!(
                    sessions = bulk_count,
                    rows,
                    "Phase 2: bulk write complete"
                );
            }
            Err(e) => {
                tracing::error!(error = %e, "Phase 2: bulk write failed, falling back to per-session");
                // Fall back to per-session writes
                for (session_id, rows) in &bulk_data {
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
        on_progress(&SearchIndexingProgress { current: total, total });
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

    // Let SQLite optimize statistics if it deems necessary
    let _ = db.conn.execute_batch("PRAGMA optimize");

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
    let _ = db.conn.execute_batch("VACUUM;");
    drop(db);

    reindex_search_content(session_state_dir, index_db_path, on_progress, is_cancelled)
}
