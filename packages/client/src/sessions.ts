import type {
  CheckpointEntry,
  EventsResponse,
  FreshnessResponse,
  SessionDbTable,
  SessionDetail,
  SessionFileEntry,
  SessionIncident,
  SessionListItem,
  SessionPlan,
  SessionSectionsInfo,
  ShutdownMetrics,
  TodosResponse,
  TurnsResponse,
} from "@tracepilot/types";

import { invoke } from "./internal/core.js";
import { toRustOptional } from "./internal/optional.js";

export async function listSessions(options?: {
  limit?: number;
  repo?: string;
  branch?: string;
  hideEmpty?: boolean;
  hideOrchestrator?: boolean;
}): Promise<SessionListItem[]> {
  return invoke<SessionListItem[]>(
    "list_sessions",
    options
      ? {
          limit: options.limit,
          repo: options.repo,
          branch: options.branch,
          hideEmpty: options.hideEmpty,
          hideOrchestrator: options.hideOrchestrator,
        }
      : undefined,
  );
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  return invoke<SessionDetail>("get_session_detail", { sessionId });
}

export async function getSessionIncidents(sessionId: string): Promise<SessionIncident[]> {
  return invoke<SessionIncident[]>("get_session_incidents", { sessionId });
}

export async function getSessionTurns(sessionId: string): Promise<TurnsResponse> {
  return invoke<TurnsResponse>("get_session_turns", { sessionId });
}

export async function checkSessionFreshness(sessionId: string): Promise<FreshnessResponse> {
  return invoke<FreshnessResponse>("check_session_freshness", { sessionId });
}

export async function getSessionEvents(
  sessionId: string,
  offset?: number,
  limit?: number,
  eventType?: string,
): Promise<EventsResponse> {
  return invoke<EventsResponse>("get_session_events", {
    sessionId,
    offset,
    limit,
    eventType: toRustOptional(eventType),
  });
}

export async function getSessionTodos(sessionId: string): Promise<TodosResponse> {
  return invoke<TodosResponse>("get_session_todos", { sessionId });
}

export async function getSessionCheckpoints(sessionId: string): Promise<CheckpointEntry[]> {
  return invoke<CheckpointEntry[]>("get_session_checkpoints", { sessionId });
}

export async function getSessionPlan(sessionId: string): Promise<SessionPlan | null> {
  return invoke<SessionPlan | null>("get_session_plan", { sessionId });
}

export async function getShutdownMetrics(sessionId: string): Promise<ShutdownMetrics | null> {
  return invoke<ShutdownMetrics | null>("get_shutdown_metrics", { sessionId });
}

export async function searchSessions(query: string): Promise<SessionListItem[]> {
  return invoke<SessionListItem[]>("search_sessions", { query });
}

/** Discover which sections have data for a given session. */
export async function getSessionSections(sessionId: string): Promise<SessionSectionsInfo> {
  return invoke<SessionSectionsInfo>("get_session_sections", { sessionId });
}

/** Lazy-load the full result of a specific tool call. */
export async function getToolResult(
  sessionId: string,
  toolCallId: string,
): Promise<unknown | null> {
  return invoke<unknown | null>("get_tool_result", { sessionId, toolCallId });
}

/** Open a new terminal window running the configured CLI resume command. */
export async function resumeSessionInTerminal(
  sessionId: string,
  cliCommand?: string,
): Promise<void> {
  return invoke<void>("resume_session_in_terminal", { sessionId, cliCommand });
}

// ── Window management ──────────────────────────────────────────────

/**
 * Open a viewer window for a specific session.
 * If the window already exists, it will be focused instead.
 * Returns the window label (e.g. "viewer-abc12345").
 */
export async function openSessionWindow(sessionId: string, sessionName?: string): Promise<string> {
  return invoke<string>("open_session_window", {
    sessionId,
    sessionName: toRustOptional(sessionName),
  });
}

/**
 * Close a viewer window by its label.
 */
export async function closeSessionWindow(label: string): Promise<void> {
  return invoke<void>("close_session_window", { label });
}

// ── Session file browser ───────────────────────────────────────────

/** List all files and directories in the session's state directory. */
export async function sessionListFiles(sessionId: string): Promise<SessionFileEntry[]> {
  return invoke<SessionFileEntry[]>("session_list_files", { sessionId });
}

/** Read the text content of a file at `relativePath` inside the session directory. */
export async function sessionReadFile(sessionId: string, relativePath: string): Promise<string> {
  return invoke<string>("session_read_file", { sessionId, relativePath });
}

/** Read all user tables from a SQLite database inside the session directory. */
export async function sessionReadSqlite(
  sessionId: string,
  relativePath: string,
): Promise<SessionDbTable[]> {
  return invoke<SessionDbTable[]>("session_read_sqlite", { sessionId, relativePath });
}
