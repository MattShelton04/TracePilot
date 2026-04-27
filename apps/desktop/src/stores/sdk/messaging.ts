/**
 * SDK messaging / session-steering slice.
 *
 * Owns per-session steering actions (send message, abort, resume, create,
 * destroy, unlink, set-mode, set-model, foreground selection) plus a
 * global `sendingMessage` flag (TODO: make per-session). Does **not** trigger
 * `session.resume` implicitly — resumption remains an explicit opt-in (see
 * repo memory on SDK session steering pitfalls).
 */

import {
  sdkAbortSession,
  sdkCreateSession,
  sdkDestroySession,
  sdkGetForegroundSession,
  sdkResumeSession,
  sdkSendMessage,
  sdkSetForegroundSession,
  sdkSetSessionMode,
  sdkSetSessionModel,
  sdkUnlinkSession,
} from "@tracepilot/client";
import type {
  BridgeEvent,
  BridgeMessagePayload,
  BridgeSessionConfig,
  BridgeSessionInfo,
  BridgeSessionMode,
} from "@tracepilot/types";
import { runMutation, toErrorMessage } from "@tracepilot/ui";
import { computed, type Ref, ref } from "vue";
import { logInfo, logWarn } from "@/utils/logger";

export interface MessagingDeps {
  sessions: Ref<BridgeSessionInfo[]>;
  activeSessions: Ref<number>;
  lastError: Ref<string | null>;
  recentEvents: Ref<BridgeEvent[]>;
}

export function createMessagingSlice(deps: MessagingDeps) {
  const { sessions, activeSessions, lastError, recentEvents } = deps;

  /**
   * Per-session "sending" tracking. A session is in `sendingByIds` from the
   * moment `sendMessage` is called until the IPC promise settles. Multiple
   * sessions can be sending concurrently — keying by sessionId prevents one
   * busy session from disabling steering UI in unrelated sessions/popouts.
   */
  const sendingByIds = ref<Set<string>>(new Set());
  /** Backward-compat: true if ANY session is currently sending. */
  const sendingMessage = computed(() => sendingByIds.value.size > 0);
  function isSending(sessionId: string | null | undefined): boolean {
    return !!sessionId && sendingByIds.value.has(sessionId);
  }
  function markSending(sessionId: string, on: boolean) {
    const next = new Set(sendingByIds.value);
    if (on) next.add(sessionId);
    else next.delete(sessionId);
    sendingByIds.value = next;
  }

  const foregroundSessionId = ref<string | null>(null);

  const foregroundSession = computed(
    () => sessions.value.find((s) => s.sessionId === foregroundSessionId.value) ?? null,
  );

  const sessionEvents = computed(() => {
    return (sessionId: string) => recentEvents.value.filter((e) => e.sessionId === sessionId);
  });

  function activeSessionCount(nextSessions = sessions.value): number {
    return nextSessions.filter((s) => s.isActive).length;
  }

  function upsertSession(session: BridgeSessionInfo) {
    const idx = sessions.value.findIndex((s) => s.sessionId === session.sessionId);
    const next = [...sessions.value];
    if (idx >= 0) {
      next[idx] = session;
    } else {
      next.push(session);
    }
    sessions.value = next;
    activeSessions.value = activeSessionCount(next);
  }

  function markSessionInactive(sessionId: string) {
    const next = sessions.value.map((s) =>
      s.sessionId === sessionId ? { ...s, isActive: false } : s,
    );
    sessions.value = next;
    activeSessions.value = activeSessionCount(next);
  }

  async function createSession(config: BridgeSessionConfig): Promise<BridgeSessionInfo | null> {
    return runMutation(lastError, async () => {
      const session = await sdkCreateSession(config);
      upsertSession(session);
      return session;
    });
  }

  async function resumeSession(
    sessionId: string,
    workingDirectory?: string,
    model?: string,
  ): Promise<BridgeSessionInfo | null> {
    logInfo(
      "[sdk] Resuming session:",
      sessionId,
      "cwd:",
      workingDirectory ?? "(none)",
      "model:",
      model ?? "(none)",
    );
    try {
      const session = await sdkResumeSession(sessionId, workingDirectory, model);
      logInfo("[sdk] Resume result:", session);
      lastError.value = null;
      upsertSession(session);
      return session;
    } catch (e) {
      lastError.value = toErrorMessage(e);
      logWarn("[sdk] Resume failed:", e);
      return null;
    }
  }

  async function sendMessage(
    sessionId: string,
    payload: BridgeMessagePayload,
  ): Promise<string | null> {
    markSending(sessionId, true);
    logInfo(
      "[sdk] Sending message to session:",
      sessionId,
      "prompt:",
      payload.prompt?.slice(0, 50),
    );
    try {
      const turnId = await sdkSendMessage(sessionId, payload);
      logInfo("[sdk] Message sent, turnId:", turnId);
      lastError.value = null;
      return turnId;
    } catch (e) {
      lastError.value = toErrorMessage(e);
      logWarn("[sdk] Send message failed:", e);
      return null;
    } finally {
      markSending(sessionId, false);
    }
  }

  async function abortSession(sessionId: string) {
    await runMutation(lastError, () => sdkAbortSession(sessionId));
  }

  async function destroySession(sessionId: string) {
    logInfo("[sdk] Destroying session:", sessionId);
    try {
      await sdkDestroySession(sessionId);
      markSessionInactive(sessionId);
      lastError.value = null;
      logInfo("[sdk] Session destroyed:", sessionId);
    } catch (e) {
      lastError.value = toErrorMessage(e);
      logWarn("[sdk] Destroy failed:", e);
    }
  }

  async function unlinkSession(sessionId: string) {
    logInfo("[sdk] Unlinking session:", sessionId);
    try {
      await sdkUnlinkSession(sessionId);
      markSessionInactive(sessionId);
      lastError.value = null;
      logInfo("[sdk] Session unlinked:", sessionId);
    } catch (e) {
      lastError.value = toErrorMessage(e);
      logWarn("[sdk] Unlink failed:", e);
    }
  }

  async function setSessionMode(sessionId: string, mode: BridgeSessionMode) {
    await runMutation(lastError, async () => {
      await sdkSetSessionMode(sessionId, mode);
      sessions.value = sessions.value.map((s) => (s.sessionId === sessionId ? { ...s, mode } : s));
    });
  }

  async function setSessionModel(sessionId: string, model: string, reasoningEffort?: string) {
    try {
      logInfo("[sdk] setSessionModel:", { sessionId, model, reasoningEffort });
      await sdkSetSessionModel(sessionId, model, reasoningEffort);
      logInfo("[sdk] setSessionModel succeeded — optimistically updating to:", model);
      sessions.value = sessions.value.map((s) => (s.sessionId === sessionId ? { ...s, model } : s));
    } catch (e) {
      logWarn("[sdk] setSessionModel failed:", e);
      lastError.value = toErrorMessage(e);
    }
  }

  async function fetchForegroundSession() {
    try {
      foregroundSessionId.value = await sdkGetForegroundSession();
    } catch (e) {
      logWarn("[sdk] Failed to fetch foreground session", e);
    }
  }

  async function setForegroundSession(sessionId: string) {
    await runMutation(lastError, async () => {
      await sdkSetForegroundSession(sessionId);
      foregroundSessionId.value = sessionId;
    });
  }

  return {
    sendingMessage,
    sendingByIds,
    isSending,
    foregroundSessionId,
    foregroundSession,
    sessionEvents,
    createSession,
    resumeSession,
    sendMessage,
    abortSession,
    destroySession,
    unlinkSession,
    setSessionMode,
    setSessionModel,
    fetchForegroundSession,
    setForegroundSession,
  };
}

export type MessagingSlice = ReturnType<typeof createMessagingSlice>;
