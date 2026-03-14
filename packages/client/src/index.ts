// TracePilot client — wraps Tauri invoke calls for type-safe frontend usage.

import type { SessionListItem, ConversationTurn, SessionHealth } from "@tracepilot/types";

/**
 * Check if we're running inside a Tauri webview.
 */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

/**
 * Invoke a Tauri command. Falls back to a stub in non-Tauri environments.
 */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    // Dynamic import to avoid bundling @tauri-apps/api in non-Tauri builds
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(`plugin:tracepilot|${cmd}`, args);
  }
  throw new Error(`TracePilot client: not running in Tauri (tried to call "${cmd}")`);
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
