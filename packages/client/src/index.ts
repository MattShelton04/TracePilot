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
        userMessage: "Please implement the login feature with OAuth support. We need GitHub and Google providers.",
        assistantMessages: ["I'll implement the login feature with OAuth support. Let me start by examining the current project structure and setting up the authentication module.\n\nFirst, I'll create the base auth module with JWT token handling, then add the OAuth provider integrations."],
        model: "claude-opus-4.6",
        toolCalls: [
          { toolName: "view", success: true, isComplete: true, durationMs: 120 },
          { toolName: "edit", success: true, isComplete: true, durationMs: 340 },
          { toolName: "powershell", success: false, isComplete: true, durationMs: 2100, error: "Test failed: expected 200 got 401" },
          { toolName: "edit", success: true, isComplete: true, durationMs: 280 },
          { toolName: "powershell", success: true, isComplete: true, durationMs: 1800 },
        ],
        durationMs: 154000,
        isComplete: true,
        timestamp: new Date(Date.now() - 86400000).toISOString(),
      },
      {
        turnIndex: 1,
        userMessage: "Great work! Now add unit tests for the login module and make sure all edge cases are covered.",
        assistantMessages: ["I'll write comprehensive unit tests for the login module. Let me cover the main flows and edge cases including expired tokens, invalid credentials, and rate limiting."],
        model: "claude-opus-4.6",
        toolCalls: [
          { toolName: "view", success: true, isComplete: true, durationMs: 90 },
          { toolName: "create", success: true, isComplete: true, durationMs: 450 },
          { toolName: "powershell", success: true, isComplete: true, durationMs: 3200 },
        ],
        durationMs: 72000,
        isComplete: true,
        timestamp: new Date(Date.now() - 82800000).toISOString(),
      },
      {
        turnIndex: 2,
        userMessage: "Can you also add the session refresh endpoint?",
        assistantMessages: ["Adding the session refresh endpoint now. This will handle token rotation with sliding window expiry."],
        model: "gpt-5.4",
        toolCalls: [
          { toolName: "edit", success: true, isComplete: true, durationMs: 310 },
        ],
        durationMs: 28000,
        isComplete: false,
        timestamp: new Date(Date.now() - 79200000).toISOString(),
      },
    ] satisfies ConversationTurn[],
    get_session_events: {
      events: [
        { eventType: "session.start", timestamp: new Date(Date.now() - 86400000).toISOString(), id: "evt-001", data: {} },
        { eventType: "user.message", timestamp: new Date(Date.now() - 86399000).toISOString(), id: "evt-002", data: {} },
        { eventType: "assistant.turn_start", timestamp: new Date(Date.now() - 86398000).toISOString(), id: "evt-003", data: {} },
        { eventType: "tool.execution_start", timestamp: new Date(Date.now() - 86397000).toISOString(), id: "evt-004", data: {} },
        { eventType: "tool.execution_complete", timestamp: new Date(Date.now() - 86396000).toISOString(), id: "evt-005", data: {} },
        { eventType: "assistant.message", timestamp: new Date(Date.now() - 86395000).toISOString(), id: "evt-006", data: {} },
        { eventType: "tool.execution_start", timestamp: new Date(Date.now() - 86394000).toISOString(), id: "evt-007", data: {} },
        { eventType: "tool.execution_complete", timestamp: new Date(Date.now() - 86393000).toISOString(), id: "evt-008", data: {} },
        { eventType: "assistant.turn_end", timestamp: new Date(Date.now() - 86392000).toISOString(), id: "evt-009", data: {} },
        { eventType: "session.plan_changed", timestamp: new Date(Date.now() - 86391000).toISOString(), id: "evt-010", data: {} },
      ],
      totalCount: 2450,
      hasMore: true,
    } satisfies EventsResponse,
    get_session_todos: {
      todos: [
        { id: "user-auth", title: "Create user auth module", description: "Implement JWT-based authentication in src/auth/", status: "done", createdAt: "", updatedAt: "" },
        { id: "api-routes", title: "Add API routes", description: "Create REST endpoints for login, logout, refresh", status: "done", createdAt: "", updatedAt: "" },
        { id: "oauth-provider", title: "OAuth provider integration", description: "Add GitHub and Google OAuth providers", status: "in_progress", createdAt: "", updatedAt: "" },
        { id: "session-mgmt", title: "Session management", description: "Implement session storage and token refresh logic", status: "pending", createdAt: "", updatedAt: "" },
        { id: "integration-tests", title: "Write integration tests", description: "End-to-end tests for all auth flows", status: "blocked", createdAt: "", updatedAt: "" },
      ],
      deps: [
        { todoId: "api-routes", dependsOn: "user-auth" },
        { todoId: "session-mgmt", dependsOn: "oauth-provider" },
        { todoId: "integration-tests", dependsOn: "api-routes" },
        { todoId: "integration-tests", dependsOn: "session-mgmt" },
      ],
    } satisfies TodosResponse,
    get_session_checkpoints: [
      { number: 1, title: "Initial project scaffolding", filename: "001-initial-scaffolding.md" },
      { number: 2, title: "Auth module implementation", filename: "002-auth-module.md" },
      { number: 3, title: "Unit test coverage", filename: "003-unit-tests.md" },
    ] as CheckpointEntry[],
    get_shutdown_metrics: {
      shutdownType: "normal",
      totalPremiumRequests: 1.33,
      totalApiDurationMs: 154200,
      currentModel: "claude-opus-4.6",
      codeChanges: { linesAdded: 342, linesRemoved: 56, filesModified: ["src/auth/login.ts", "src/auth/oauth.ts", "src/auth/index.ts", "tests/auth.test.ts"] },
      modelMetrics: {
        "claude-opus-4.6": { requests: { count: 32, cost: 0.87 }, usage: { inputTokens: 892300, outputTokens: 45200, cacheReadTokens: 234000, cacheWriteTokens: 12000 } },
        "gpt-5.4": { requests: { count: 15, cost: 0.46 }, usage: { inputTokens: 234100, outputTokens: 23400, cacheReadTokens: 89000, cacheWriteTokens: 5600 } },
      },
    } as ShutdownMetrics,
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
