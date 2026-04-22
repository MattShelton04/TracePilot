//! Indexing orchestration: progress tracking, full/incremental reindex,
//! and Phase 2 search content indexing.

use std::path::PathBuf;

pub mod progress;
pub mod reindex;
pub mod search;

pub use progress::{IndexingProgress, SearchIndexingProgress};
pub use reindex::{
    reindex_all, reindex_all_with_progress, reindex_all_with_rich_progress, reindex_incremental,
    reindex_incremental_with_progress, reindex_incremental_with_rich_progress,
};
pub use search::{rebuild_search_content, reindex_search_content};

/// Default path for the TracePilot index database.
pub fn default_index_db_path() -> PathBuf {
    tracepilot_core::utils::home_dir()
        .join(".copilot")
        .join("tracepilot")
        .join("index.db")
}
