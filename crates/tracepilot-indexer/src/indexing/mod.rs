//! Indexing orchestration: progress tracking, full/incremental reindex,
//! and Phase 2 search content indexing.

use std::path::PathBuf;

mod batches;
mod handoff;
mod inventory;
mod pipeline;
mod search_prepare;

pub mod progress;
pub mod reindex;
pub mod scope;
pub mod search;

pub use handoff::{SearchHandoff, write_search_handoff};
pub use progress::{IndexingProgress, SearchIndexingProgress, SourceProgress};
pub use reindex::{
    ensure_complete_inventory, reindex_all, reindex_all_scoped, reindex_all_with_progress,
    reindex_all_with_rich_progress, reindex_incremental, reindex_incremental_covered,
    reindex_incremental_scoped, reindex_incremental_with_progress,
    reindex_incremental_with_rich_progress, reindex_incremental_with_search,
};
pub use scope::{IndexScope, SourceGenerations};
pub use search::{
    rebuild_search_content, rebuild_search_content_covered, rebuild_search_content_scoped,
    reindex_search_content, reindex_search_content_covered, reindex_search_content_scoped,
};

/// What an incremental pass did, and whether it covered everything: every
/// source of its scope was discovered and every session was indexed or
/// found fresh. A pass that is not complete may have left work for a later
/// one (a session whose write failed, a source it could not list).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PassCoverage {
    pub indexed: usize,
    pub skipped: usize,
    pub complete: bool,
}

impl PassCoverage {
    fn new(
        scope: &IndexScope,
        discovered: usize,
        total: usize,
        indexed: usize,
        skipped: usize,
    ) -> Self {
        Self {
            indexed,
            skipped,
            complete: discovered == scope.registry().providers().len()
                && indexed + skipped == total,
        }
    }

    /// Every one of `indexed` sessions written, and nothing else to cover.
    fn covered(indexed: usize) -> Self {
        Self {
            indexed,
            skipped: 0,
            complete: true,
        }
    }

    fn incomplete(indexed: usize, skipped: usize) -> Self {
        Self {
            indexed,
            skipped,
            complete: false,
        }
    }
}

/// Default path for the TracePilot index database.
pub fn default_index_db_path() -> PathBuf {
    tracepilot_core::paths::default_index_db_path()
}
