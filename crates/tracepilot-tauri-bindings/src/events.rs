//! Tauri IPC event name constants.
//!
//! Centralises event names emitted from Rust commands and listened to
//! on the TypeScript side.  Keep in sync with `packages/types/src/ipc-events.ts`.

/// Indexing lifecycle events (full index).
pub const INDEXING_STARTED: &str = "indexing-started";
pub const INDEXING_PROGRESS: &str = "indexing-progress";
pub const INDEXING_FINISHED: &str = "indexing-finished";

/// Copilot SDK IPC event (bridge event forwarding).
pub const SDK_BRIDGE_EVENT: &str = "sdk-bridge-event";
/// SDK connection state changed.
pub const SDK_CONNECTION_CHANGED: &str = "sdk-connection-changed";

/// Search-specific indexing events.
pub const SEARCH_INDEXING_STARTED: &str = "search-indexing-started";
pub const SEARCH_INDEXING_PROGRESS: &str = "search-indexing-progress";
pub const SEARCH_INDEXING_FINISHED: &str = "search-indexing-finished";
