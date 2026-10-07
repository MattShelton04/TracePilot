//! Indexing orchestration: progress tracking, full/incremental reindex,
//! and Phase 2 search content indexing.

use std::path::PathBuf;

mod batches;
mod inventory;
mod search_prepare;

pub mod progress;
pub mod reindex;
pub mod scope;
pub mod search;

pub use progress::{IndexingProgress, SearchIndexingProgress, SourceProgress};
pub use reindex::{
    ensure_complete_inventory, reindex_all, reindex_all_scoped, reindex_all_with_progress,
    reindex_all_with_rich_progress, reindex_incremental, reindex_incremental_scoped,
    reindex_incremental_with_progress, reindex_incremental_with_rich_progress,
};
pub use scope::{IndexScope, SourceGenerations};
pub use search::{
    rebuild_search_content, rebuild_search_content_scoped, reindex_search_content,
    reindex_search_content_scoped,
};

/// Default path for the TracePilot index database.
pub fn default_index_db_path() -> PathBuf {
    tracepilot_core::paths::default_index_db_path()
}
