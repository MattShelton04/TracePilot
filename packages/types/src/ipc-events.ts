/**
 * Tauri IPC event name constants.
 *
 * Centralises event names emitted from Rust commands and listened to
 * on the TypeScript side.  Keep in sync with
 * `crates/tracepilot-tauri-bindings/src/events.rs`.
 */
export const IPC_EVENTS = {
  INDEXING_STARTED: "indexing-started",
  INDEXING_PROGRESS: "indexing-progress",
  INDEXING_FINISHED: "indexing-finished",
  SEARCH_INDEXING_STARTED: "search-indexing-started",
  SEARCH_INDEXING_PROGRESS: "search-indexing-progress",
  SEARCH_INDEXING_FINISHED: "search-indexing-finished",
  SDK_BRIDGE_EVENT: "sdk-bridge-event",
  SDK_CONNECTION_CHANGED: "sdk-connection-changed",
} as const;
