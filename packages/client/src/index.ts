import type {
  SessionListItem,
  SessionDetail,
  ConversationTurn,
  EventsResponse,
  TodosResponse,
  CheckpointEntry,
  ShutdownMetrics,
  SessionHealth,
} from "@tracepilot/types";

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
  const mocks: Record<string, unknown> = {
    list_sessions: [
      {
        id: "c86fe369-c858-4d91-81da-203c5e276e33",
        summary: "Implemented login feature with OAuth",
        repository: "example/project",
        branch: "main",
        hostType: "cli",
        eventCount: 2450,
        turnCount: 12,
        currentModel: "claude-opus-4.6",
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        summary: "Fixed CSS layout issues",
        repository: "example/frontend",
        branch: "feat/responsive",
        hostType: "cli",
        eventCount: 890,
        turnCount: 5,
        currentModel: "gpt-5.4",
        createdAt: new Date(Date.now() - 172800000).toISOString(),
        updatedAt: new Date(Date.now() - 7200000).toISOString(),
      },
      {
        id: "deadbeef-1234-5678-9abc-def012345678",
        summary: "Set up CI/CD pipeline with GitHub Actions",
        repository: "example/infra",
        branch: "devops/ci",
        hostType: "cli",
        eventCount: 4200,
        turnCount: 22,
        currentModel: "claude-sonnet-4.5",
        createdAt: new Date(Date.now() - 604800000).toISOString(),
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ] satisfies SessionListItem[],
    get_session_detail: {
      id: mockSessionId,
      summary: "Mock session detail",
      repository: "example/project",
      branch: "main",
      cwd: "/home/user/project",
      hostType: "cli",
      eventCount: 2450,
      turnCount: 12,
      hasPlan: true,
      hasCheckpoints: true,
      checkpointCount: 3,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      updatedAt: new Date(Date.now() - 3600000).toISOString(),
    } satisfies SessionDetail,
    get_session_turns: [
      {
        turnIndex: 0,
        userMessage: "Please implement the login feature",
        assistantMessages: ["I'll implement the login feature with OAuth support..."],
        model: "claude-opus-4.6",
        toolCalls: [
          { toolName: "view", success: true, isComplete: true },
          { toolName: "edit", success: true, isComplete: true },
        ],
        durationMs: 15000,
        isComplete: true,
        timestamp: new Date(Date.now() - 86400000).toISOString(),
      },
    ] satisfies ConversationTurn[],
    get_session_events: {
      events: [
        { eventType: "session.start", timestamp: new Date().toISOString(), data: {} },
        { eventType: "user.message", timestamp: new Date().toISOString(), data: { content: "Hello" } },
      ],
      totalCount: 2,
      hasMore: false,
    } satisfies EventsResponse,
    get_session_todos: { todos: [], deps: [] } satisfies TodosResponse,
    get_session_checkpoints: [] as CheckpointEntry[],
    get_shutdown_metrics: null,
    search_sessions: [] as SessionListItem[],
    reindex_sessions: 0,
  };
  return (mocks[cmd] ?? null) as T;
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

export type { SessionHealth };
