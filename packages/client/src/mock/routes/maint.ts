import type { MockRoutes } from "./route.js";

/** Commands from `maint.ts`. */
export const MAINT_ROUTES: MockRoutes = {
  reindex_sessions: (): [number, number] => [0, 0],
  reindex_sessions_full: (): [number, number] => [0, 0],
  rebuild_search_index: (): [number, number] => [0, 0],
  get_db_size: () => 44564480,
  get_session_count: () => 47,
  factory_reset: () => undefined,
  get_log_path: () => "~/.local/share/dev.tracepilot.app/logs",
  export_logs: () => "Exported 1 log file(s) to /tmp/tracepilot-logs.txt",
};
