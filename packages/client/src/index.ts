// TracePilot client — wraps Tauri invoke calls for type-safe frontend usage.
// Framework-agnostic: works with Vue, React, or any JS context.

import type { SessionListItem, ConversationTurn, SessionHealth } from "@tracepilot/types";

/**
 * Check if we're running inside a Tauri webview.
 */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Invoke a Tauri command. Falls back to mock data in non-Tauri environments.
 */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(`plugin:tracepilot|${cmd}`, args);
  }
  // Dev mode: return mock data so the UI is usable outside Tauri
  console.warn(`[TracePilot] Not in Tauri — returning mock data for "${cmd}"`);
  return getMockData<T>(cmd);
}

/** Mock data for development outside Tauri. */
function getMockData<T>(cmd: string): T {
  const mocks: Record<string, unknown> = {
    list_sessions: [
      {
        id: "c86fe369-c858-4d91-81da-203c5e276e33",
        summary: "Implemented login feature",
        repository: "example/project",
        branch: "main",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        summary: "Fixed CSS layout issues",
        repository: "example/frontend",
        branch: "feat/responsive",
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 3600000).toISOString(),
      },
    ] satisfies SessionListItem[],
    get_session_turns: [] as ConversationTurn[],
    get_session_health: { score: 0.85, flags: [] } as SessionHealth,
  };
  return (mocks[cmd] ?? []) as T;
}

/** Fetch all sessions. */
export async function listSessions(): Promise<SessionListItem[]> {
  return invoke<SessionListItem[]>("list_sessions");
}

/** Fetch conversation turns for a session. */
export async function getSessionTurns(sessionId: string): Promise<ConversationTurn[]> {
  return invoke<ConversationTurn[]>("get_session_turns", { sessionId });
}

/** Fetch health assessment for a session. */
export async function getSessionHealth(sessionId: string): Promise<SessionHealth> {
  return invoke<SessionHealth>("get_session_health", { sessionId });
}
