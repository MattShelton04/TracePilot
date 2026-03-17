//! tracepilot-indexer: Maintain a local index database for fast session search.
//!
//! Creates and incrementally updates `~/.copilot/tracepilot/index.db` with:
//! - Session metadata from workspace.yaml
//! - Shutdown metrics
//! - FTS5 full-text search over summaries and messages

use anyhow::Result;
use std::path::{Path, PathBuf};

pub mod index_db;

pub use index_db::SessionIndexInfo;

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
    let home = if cfg!(windows) {
        std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\default".to_string())
    } else {
        std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string())
    };
    PathBuf::from(home)
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
pub fn reindex_incremental_with_rich_progress(
    session_state_dir: &Path,
    index_db_path: &Path,
    mut on_progress: impl FnMut(&IndexingProgress),
) -> Result<(usize, usize)> {
    let sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;

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
