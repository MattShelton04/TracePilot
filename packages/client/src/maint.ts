import { invoke } from "./internal/core.js";
import { isTauri } from "./invoke.js";

// ── Maintenance / Index / Diagnostics ─────────────────────────

/** Returns [updated, total] session counts. */
export async function reindexSessions(): Promise<[number, number]> {
  return invoke<[number, number]>("reindex_sessions");
}

/** Delete the index DB and rebuild all analytics from scratch. Returns [rebuilt, total]. */
export async function reindexSessionsFull(): Promise<[number, number]> {
  return invoke<[number, number]>("reindex_sessions_full");
}

/** Rebuild the search index from scratch. Returns [indexed, total]. */
export async function rebuildSearchIndex(): Promise<[number, number]> {
  return invoke<[number, number]>("rebuild_search_index");
}

/** Get the index database file size in bytes. */
export async function getDbSize(): Promise<number> {
  if (!isTauri()) return 44_564_480; // ~42.5 MB mock
  return invoke<number>("get_db_size");
}

/** Get the number of indexed sessions. */
export async function getSessionCount(): Promise<number> {
  if (!isTauri()) return 47;
  return invoke<number>("get_session_count");
}

/** Factory reset: delete config, index DB, and all app data. */
export async function factoryReset(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("factory_reset");
}

// ── Logging Commands ──────────────────────────────────────────

/** Get the application log directory path. */
export async function getLogPath(): Promise<string> {
  return invoke<string>("get_log_path");
}

/** Export all log files to a single destination file. */
export async function exportLogs(destination: string): Promise<string> {
  return invoke<string>("export_logs", { destination });
}
