/**
 * SDK messaging / session-steering slice.
 *
 * Owns per-session steering actions (send message, abort, resume, create,
 * destroy, unlink, set-mode, set-model, foreground selection) plus the
 * `sendingMessage` flag. Does **not** trigger `session.resume` implicitly —
 * resumption remains an explicit opt-in (see repo memory on SDK session
 * steering pitfalls).
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

  const sendingMessage = ref(false);
  const foregroundSessionId = ref<string | null>(null);

  const foregroundSession = computed(
    () => sessions.value.find((s) => s.sessionId === foregroundSessionId.value) ?? null,
  );

  const sessionEvents = computed(() => {
    return (sessionId: string) => recentEvents.value.filter((e) => e.sessionId === sessionId);
  });

  async function createSession(config: BridgeSessionConfig): Promise<BridgeSessionInfo | null> {
    return runMutation(lastError, async () => {
      const session = await sdkCreateSession(config);
      sessions.value = [...sessions.value, session];
      activeSessions.value = sessions.value.length;
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
      const idx = sessions.value.findIndex((s) => s.sessionId === session.sessionId);
      if (idx >= 0) {
        const updated = [...sessions.value];
        updated[idx] = session;
        sessions.value = updated;
      } else {
        sessions.value = [...sessions.value, session];
      }
      if (session.sessionId !== sessionId) {
        const origIdx = sessions.value.findIndex((s) => s.sessionId === sessionId);
        if (origIdx >= 0) {
          const updated = [...sessions.value];
          updated[origIdx] = { ...updated[origIdx], isActive: true };
          sessions.value = updated;
        }
      }
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
    sendingMessage.value = true;
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
      sendingMessage.value = false;
    }
  }

  async function abortSession(sessionId: string) {
    await runMutation(lastError, () => sdkAbortSession(sessionId));
  }

  async function destroySession(sessionId: string) {
    logInfo("[sdk] Destroying session:", sessionId);
    try {
      await sdkDestroySession(sessionId);
      sessions.value = sessions.value.map((s) =>
        s.sessionId === sessionId ? { ...s, isActive: false } : s,
      );
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
