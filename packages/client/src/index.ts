import type {
  SessionListItem,
  SessionDetail,
  ConversationTurn,
  EventsResponse,
  TodosResponse,
  CheckpointEntry,
  ShutdownMetrics,
  SessionHealth,
  AnalyticsData,
  ToolAnalysisData,
  CodeImpactData,
  HealthScoringData,
  ExportConfig,
  ExportResult,
} from "@tracepilot/types";

import {
  MOCK_SESSIONS,
  getMockSessionDetail,
  MOCK_TURNS,
  MOCK_EVENTS,
  MOCK_TODOS,
  MOCK_CHECKPOINTS,
  MOCK_SHUTDOWN_METRICS,
  MOCK_ANALYTICS,
  MOCK_TOOL_ANALYSIS,
  MOCK_CODE_IMPACT,
  MOCK_HEALTH_SCORING,
  MOCK_EXPORT_RESULT,
} from "./mock/index.js";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(`plugin:tracepilot|${cmd}`, args);
  }
  console.warn(`[TracePilot] Not in Tauri — returning mock data for "${cmd}"`);
  return getMockData<T>(cmd, args);
}

function getMockData<T>(cmd: string, args?: Record<string, unknown>): T {
  const mockSessionId = typeof args?.sessionId === "string" ? args.sessionId : "mock-id";

  // Mock search filters the session list
  const searchQuery = typeof args?.query === "string" ? args.query.toLowerCase() : "";

  const mocks: Record<string, unknown> = {
    list_sessions: MOCK_SESSIONS,
    get_session_detail: getMockSessionDetail(mockSessionId),
    get_session_turns: MOCK_TURNS,
    get_session_events: MOCK_EVENTS,
    get_session_todos: MOCK_TODOS,
    get_session_checkpoints: MOCK_CHECKPOINTS,
    get_shutdown_metrics: MOCK_SHUTDOWN_METRICS,
    search_sessions: searchQuery
      ? MOCK_SESSIONS.filter(s =>
          [s.summary, s.repository, s.branch, s.id].some(
            f => f?.toLowerCase().includes(searchQuery)
          )
        )
      : MOCK_SESSIONS,
    reindex_sessions: 0,
  };
  const data = mocks[cmd];
  if (data === undefined) {
    throw new Error(`[STUB] No mock data for command: ${cmd}`);
  }
  return data as T;
}

export async function listSessions(
  options?: { limit?: number; repo?: string; branch?: string }
): Promise<SessionListItem[]> {
  return invoke<SessionListItem[]>("list_sessions", options ? {
    limit: options.limit,
    repo: options.repo,
    branch: options.branch,
  } : undefined);
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  return invoke<SessionDetail>("get_session_detail", { sessionId });
}

export async function getSessionTurns(sessionId: string): Promise<ConversationTurn[]> {
  return invoke<ConversationTurn[]>("get_session_turns", { sessionId });
}

export async function getSessionEvents(
  sessionId: string,
  offset?: number,
  limit?: number
): Promise<EventsResponse> {
  return invoke<EventsResponse>("get_session_events", { sessionId, offset, limit });
}

export async function getSessionTodos(sessionId: string): Promise<TodosResponse> {
  return invoke<TodosResponse>("get_session_todos", { sessionId });
}

export async function getSessionCheckpoints(sessionId: string): Promise<CheckpointEntry[]> {
  return invoke<CheckpointEntry[]>("get_session_checkpoints", { sessionId });
}

export async function getShutdownMetrics(sessionId: string): Promise<ShutdownMetrics | null> {
  return invoke<ShutdownMetrics | null>("get_shutdown_metrics", { sessionId });
}

export async function searchSessions(query: string): Promise<SessionListItem[]> {
  return invoke<SessionListItem[]>("search_sessions", { query });
}

export async function reindexSessions(): Promise<number> {
  return invoke<number>("reindex_sessions");
}

/**
 * Get aggregated analytics data across all sessions.
 * // STUB: Currently returns mock data. Replace with real Tauri IPC command
 * // STUB: when the analytics backend API is implemented (Phase 6+).
 */
export async function getAnalytics(): Promise<AnalyticsData> {
  // STUB: No Tauri command exists yet for analytics.
  // STUB: When implemented, this should call: invoke('plugin:tracepilot|get_analytics')
  return MOCK_ANALYTICS;
}

/**
 * Get tool usage analysis data across all sessions.
 * // STUB: Currently returns mock data. Replace with real Tauri IPC command
 * // STUB: when the tool analysis backend API is implemented (Phase 6+).
 */
export async function getToolAnalysis(): Promise<ToolAnalysisData> {
  // STUB: No Tauri command exists yet for tool analysis.
  // STUB: When implemented, this should call: invoke('plugin:tracepilot|get_tool_analysis')
  return MOCK_TOOL_ANALYSIS;
}

/**
 * Get code impact analysis data across all sessions.
 * // STUB: Currently returns mock data. Replace with real Tauri IPC command
 * // STUB: when the code impact backend API is implemented (Phase 6+).
 */
export async function getCodeImpact(): Promise<CodeImpactData> {
  // STUB: No Tauri command exists yet for code impact.
  // STUB: When implemented, this should call: invoke('plugin:tracepilot|get_code_impact')
  return MOCK_CODE_IMPACT;
}

/**
 * Get health scoring data across all sessions.
 * // STUB: Currently returns mock data. Replace with real Tauri IPC command
 * // STUB: when the health scoring backend API is implemented (Phase 6+).
 */
export async function getHealthScores(): Promise<HealthScoringData> {
  // STUB: No Tauri command exists yet for health scores.
  // STUB: When implemented, this should call: invoke('plugin:tracepilot|get_health_scores')
  return MOCK_HEALTH_SCORING;
}

/**
 * Export one or more sessions in the specified format.
 * // STUB: Currently returns mock data. Replace with real Tauri IPC command
 * // STUB: when the export backend API is implemented (Phase 6+).
 */
export async function exportSession(_config: ExportConfig): Promise<ExportResult> {
  // STUB: No Tauri command exists yet for export.
  // STUB: When implemented, this should call: invoke('plugin:tracepilot|export_session', { config })
  return MOCK_EXPORT_RESULT;
}

export type { SessionHealth };
