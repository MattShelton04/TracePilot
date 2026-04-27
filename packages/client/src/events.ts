/**
 * Tauri IPC event name constants.
 *
 * Centralises event names emitted from Rust commands and listened to
 * on the TypeScript side.  Keep in sync with
 * `crates/tracepilot-tauri-bindings/src/events.rs`.
 *
 * Lives alongside `IPC_COMMANDS` (see `./commands.ts`) so that both
 * halves of the IPC wire-protocol surface have a single source of
 * truth in `@tracepilot/client`.
 */
export const IPC_EVENTS = {
  INDEXING_STARTED: "indexing-started",
  INDEXING_PROGRESS: "indexing-progress",
  INDEXING_FINISHED: "indexing-finished",
  SEARCH_INDEXING_STARTED: "search-indexing-started",
  SEARCH_INDEXING_PROGRESS: "search-indexing-progress",
  SEARCH_INDEXING_FINISHED: "search-indexing-finished",
  SDK_BRIDGE_EVENT: "sdk-bridge-event",
  SDK_SESSION_STATE_CHANGED: "sdk-session-state-changed",
  SDK_CONNECTION_CHANGED: "sdk-connection-changed",
} as const;

export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];
