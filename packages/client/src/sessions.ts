import type {
  CheckpointEntry,
  ContextTimelineResponse,
  EventsResponse,
  FreshnessResponse,
  PromptCacheResponse,
  SessionDbTable,
  SessionDetail,
  SessionFileListing,
  SessionFileSearchResponse,
  SessionImagePreview,
  SessionIncident,
  SessionListItem,
  SessionPlan,
  SessionSectionsInfo,
  ShutdownMetrics,
  TodosResponse,
  TurnActivityResponse,
  TurnsResponse,
} from "@tracepilot/types";

import type { FileCheckpoint, FileVersionContent } from "./generated/bindings.js";
import { invoke } from "./internal/core.js";
import { toRustOptional } from "./internal/optional.js";

export async function listSessions(options?: {
  limit?: number;
  repo?: string;
  branch?: string;
  hideEmpty?: boolean;
}): Promise<SessionListItem[]> {
  return invoke<SessionListItem[]>(
    "list_sessions",
    options
      ? {
          limit: options.limit,
          repo: options.repo,
          branch: options.branch,
          hideEmpty: options.hideEmpty,
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

/** When each turn started, without the turns' content. */
export async function getSessionTurnActivity(sessionId: string): Promise<TurnActivityResponse> {
  return invoke<TurnActivityResponse>("get_session_turn_activity", { sessionId });
}

export async function getSessionContextTimeline(
  sessionId: string,
): Promise<ContextTimelineResponse> {
  return invoke<ContextTimelineResponse>("get_session_context_timeline", { sessionId });
}

/** Prompt-cache idle windows, predicted expiries and prefix changes. */
export async function getSessionPromptCache(sessionId: string): Promise<PromptCacheResponse> {
  return invoke<PromptCacheResponse>("get_session_prompt_cache", { sessionId });
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

/** Read-only rewind points of the files the session changed; empty when none. */
export async function getSessionFileHistory(sessionId: string): Promise<FileCheckpoint[]> {
  return invoke<FileCheckpoint[]>("get_session_file_history", { sessionId });
}

/** One backed-up file version from the session's file history, read on request. */
export async function getSessionFileVersion(
  sessionId: string,
  backup: string,
): Promise<FileVersionContent> {
  return invoke<FileVersionContent>("get_session_file_version", { sessionId, backup });
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

/** List the session's browsable files and the directory their paths are relative to. */
export async function sessionListFiles(sessionId: string): Promise<SessionFileListing> {
  return invoke<SessionFileListing>("session_list_files", { sessionId });
}

/** Read the text content of a file at `relativePath` inside the session directory. */
export async function sessionReadFile(
  sessionId: string,
  relativePath: string,
  full = false,
): Promise<string> {
  return invoke<string>("session_read_file", { sessionId, relativePath, full });
}

/** Read a bounded, sanitized raster preview from the session directory. */
export async function sessionReadImagePreview(
  sessionId: string,
  relativePath: string,
): Promise<SessionImagePreview> {
  return invoke<SessionImagePreview>("session_read_image_preview", { sessionId, relativePath });
}

/** Read all user tables from a SQLite database inside the session directory. */
export async function sessionReadSqlite(
  sessionId: string,
  relativePath: string,
): Promise<SessionDbTable[]> {
  return invoke<SessionDbTable[]>("session_read_sqlite", { sessionId, relativePath });
}

/** Search readable files in one session using a bounded literal search. */
export async function sessionSearchFiles(
  sessionId: string,
  query: string,
): Promise<SessionFileSearchResponse> {
  return invoke<SessionFileSearchResponse>("session_search_files", { sessionId, query });
}
