//! tracepilot-indexer: Maintain a local index database for fast session search.
//!
//! Creates and incrementally updates the configured TracePilot index database with:
//! - Session metadata from workspace.yaml
//! - Shutdown metrics
//! - FTS5 full-text search over summaries and messages

pub mod error;
pub mod index_db;
pub mod indexing;

pub use error::{IndexerError, Result};

pub use index_db::SessionIndexInfo;
pub use index_db::search_reader::sanitize_fts_query;
pub use index_db::{SearchFacets, SearchFilters, SearchResult, SearchStats};

pub use indexing::{
    IndexingProgress, SearchIndexingProgress, default_index_db_path, rebuild_search_content,
    reindex_all, reindex_all_with_progress, reindex_all_with_rich_progress, reindex_incremental,
    reindex_incremental_with_progress, reindex_incremental_with_rich_progress,
    reindex_search_content,
};
