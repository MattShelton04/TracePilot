//! tracepilot-indexer: Maintain a local index database for fast session search.
//!
//! Creates and incrementally updates `~/.copilot/tracepilot/index.db` with:
//! - Session metadata from workspace.yaml
//! - Shutdown metrics
//! - FTS5 full-text search over summaries and messages

use std::path::{Path, PathBuf};

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
#[tracing::instrument(skip_all)]
pub fn reindex_all_with_rich_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(&IndexingProgress),
) -> Result<usize> {
    let sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;

    let live_ids: std::collections::HashSet<String> =
        sessions.iter().map(|s| s.id.clone()).collect();

    let total = sessions.len();
    let mut running_tokens: u64 = 0;
    let mut running_events: u64 = 0;
    let mut seen_repos = std::collections::HashSet::new();

    db.begin_transaction()?;
    let mut indexed = 0;
    for (i, session) in sessions.iter().enumerate() {
        let info = match db.upsert_session(&session.path) {
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
                tracing::warn!(session_id = %session.id, error = %e, "Failed to index session");
                None
            }
        };
        on_progress(&IndexingProgress {
            current: i + 1,
            total,
            session_info: info,
            running_tokens,
            running_events,
            running_repos: seen_repos.len(),
        });
    }
    db.commit_transaction()?;

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
#[tracing::instrument(skip_all)]
pub fn reindex_incremental_with_rich_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(&IndexingProgress),
) -> Result<(usize, usize)> {
    let phase1_start = std::time::Instant::now();
    let sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
    let discover_elapsed = phase1_start.elapsed();
    let db = index_db::IndexDb::open_or_create(index_db_path)?;
    let db_open_elapsed = phase1_start.elapsed() - discover_elapsed;
    tracing::debug!(
        sessions = sessions.len(),
        discover_ms = discover_elapsed.as_millis(),
        db_open_ms = db_open_elapsed.as_millis(),
        "Phase 1: discovered sessions and opened DB"
    );

    let live_ids: std::collections::HashSet<String> =
        sessions.iter().map(|s| s.id.clone()).collect();

    let total = sessions.len();
    let mut indexed = 0;
    let mut skipped = 0;
    let mut running_tokens: u64 = 0;
    let mut running_events: u64 = 0;
    let mut seen_repos = std::collections::HashSet::new();

    // Batch size for transaction grouping — amortizes WAL fsyncs while keeping
    // lock duration reasonable for concurrent readers.
    const BATCH_SIZE: usize = 100;
    let mut batch_count = 0;
    let mut in_transaction = false;

    for (i, session) in sessions.iter().enumerate() {
        let info = if db.needs_reindex(&session.id, &session.path) {
            // Start a new batch transaction if needed
            if !in_transaction {
                db.begin_transaction()?;
                in_transaction = true;
                batch_count = 0;
            }

            match db.upsert_session(&session.path) {
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
                    tracing::warn!(session_id = %session.id, error = %e, "Failed to index session");
                    None
                }
            }
        } else {
            skipped += 1;
            None
        };
        on_progress(&IndexingProgress {
            current: i + 1,
            total,
            session_info: info,
            running_tokens,
            running_events,
            running_repos: seen_repos.len(),
        });
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
        "Phase 1 complete"
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
/// Parses events OUTSIDE transactions, writes INSIDE (brief lock per session).
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
    let mut indexed = 0;
    let mut skipped = 0;

    for (i, session) in sessions.iter().enumerate() {
        // Check cancellation at session boundaries
        if is_cancelled() {
            tracing::info!(indexed, skipped, "Search indexing cancelled");
            return Ok((indexed, skipped));
        }

        if !db.needs_search_reindex(&session.id, &session.path) {
            skipped += 1;
        } else {
            let session_start = std::time::Instant::now();
            // Parse OUTSIDE transaction (CPU-bound, no DB lock)
            let events_path = session.path.join("events.jsonl");
            let content_rows = if events_path.exists() {
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
                            "Failed to parse events for search indexing — skipping (preserving existing index)"
                        );
                        None
                    }
                }
            } else {
                Some(Vec::new())
            };

            // Only write if parsing succeeded — don't wipe existing index on transient errors
            if let Some(ref rows) = content_rows {
                match db.upsert_search_content(&session.id, rows) {
                    Ok(_) => {
                        indexed += 1;
                        let elapsed = session_start.elapsed();
                        if elapsed.as_millis() > 100 {
                            tracing::debug!(
                                session_id = %session.id,
                                rows = rows.len(),
                                elapsed_ms = elapsed.as_millis(),
                                "Phase 2: slow session indexing"
                            );
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            session_id = %session.id,
                            error = %e,
                            "Failed to write search content"
                        );
                    }
                }
            }
        }

        // Throttle progress events (every 5 sessions)
        if (i + 1) % 5 == 0 || i + 1 == total {
            on_progress(&SearchIndexingProgress {
                current: i + 1,
                total,
            });
        }
    }

    // Optimize after bulk writes
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
