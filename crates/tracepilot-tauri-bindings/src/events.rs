//! Tauri IPC event name constants.
//!
//! Centralises event names emitted from Rust commands and listened to
//! on the TypeScript side.  Keep in sync with `packages/types/src/ipc-events.ts`.

/// Indexing lifecycle events (full index).
pub const INDEXING_STARTED: &str = "indexing-started";
pub const INDEXING_PROGRESS: &str = "indexing-progress";
pub const INDEXING_FINISHED: &str = "indexing-finished";

/// Search-specific indexing events.
pub const SEARCH_INDEXING_STARTED: &str = "search-indexing-started";
pub const SEARCH_INDEXING_PROGRESS: &str = "search-indexing-progress";
pub const SEARCH_INDEXING_FINISHED: &str = "search-indexing-finished";
