//! tracepilot-indexer: Maintain a local index database for fast session search.
//!
//! Creates and incrementally updates `~/.copilot/tracepilot/index.db` with:
//! - Session metadata from workspace.yaml
//! - Shutdown metrics
//! - FTS5 full-text search over summaries and messages

use anyhow::Result;
use std::path::{Path, PathBuf};

pub mod index_db;

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
    let sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;

    let live_ids: std::collections::HashSet<String> =
        sessions.iter().map(|s| s.id.clone()).collect();

    let mut indexed = 0;
    for session in &sessions {
        if let Err(e) = db.upsert_session(&session.path) {
            tracing::warn!(session_id = %session.id, error = %e, "Failed to index session");
        } else {
            indexed += 1;
        }
    }

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

/// Reindex only sessions whose workspace.yaml mtime changed.
pub fn reindex_incremental(
    session_state_dir: &Path,
    index_db_path: &Path,
) -> Result<(usize, usize)> {
    let sessions = tracepilot_core::session::discovery::discover_sessions(session_state_dir)?;
    let db = index_db::IndexDb::open_or_create(index_db_path)?;

    let mut indexed = 0;
    let mut skipped = 0;
    for session in &sessions {
        if db.needs_reindex(&session.id, &session.path) {
            if let Err(e) = db.upsert_session(&session.path) {
                tracing::warn!(session_id = %session.id, error = %e, "Failed to index session");
            } else {
                indexed += 1;
            }
        } else {
            skipped += 1;
        }
    }

    Ok((indexed, skipped))
}
