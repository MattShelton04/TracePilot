/**
 * SDK Bridge Pinia Store
 *
 * Manages connection to the Copilot SDK bridge, exposes real-time events,
 * and provides actions for session steering (send message, set mode/model, abort).
 *
 * Feature-gated: only activates when `copilotSdk` feature flag is enabled.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  sdkAbortSession,
  sdkCliStatus,
  sdkConnect,
  sdkCreateSession,
  sdkDestroySession,
  sdkDisconnect,
  sdkGetAuthStatus,
  sdkGetForegroundSession,
  sdkGetQuota,
  sdkListModels,
  sdkListSessions,
  sdkResumeSession,
  sdkSendMessage,
  sdkSetForegroundSession,
  sdkSetSessionMode,
  sdkSetSessionModel,
  sdkStatus,
  sdkUnlinkSession,
} from "@tracepilot/client";
import type {
  BridgeAuthStatus,
  BridgeConnectionState,
  BridgeConnectConfig,
  BridgeEvent,
  BridgeMessagePayload,
  BridgeModelInfo,
  BridgeQuota,
  BridgeSessionConfig,
  BridgeSessionInfo,
  BridgeSessionMode,
  BridgeStatus,
} from "@tracepilot/types";
import { IPC_EVENTS } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { safeListen } from "@/utils/tauriEvents";
import { logInfo, logWarn } from "@/utils/logger";
import { usePreferencesStore } from "@/stores/preferences";

const MAX_EVENTS = 500;

export const useSdkStore = defineStore("sdk", () => {
  // ─── State ────────────────────────────────────────────────────────

  const connectionState = ref<BridgeConnectionState>("disconnected");
  const sdkAvailable = ref(false);
  const cliVersion = ref<string | null>(null);
  const protocolVersion = ref<number | null>(null);
  const activeSessions = ref(0);
  const lastError = ref<string | null>(null);
  const connecting = ref(false);
  /** "stdio" (private subprocess) or "tcp" (connected to --ui-server). */
  const connectionMode = ref<string | null>(null);

  const authStatus = ref<BridgeAuthStatus | null>(null);
  const quota = ref<BridgeQuota | null>(null);
  const sessions = ref<BridgeSessionInfo[]>([]);
  const models = ref<BridgeModelInfo[]>([]);
  const foregroundSessionId = ref<string | null>(null);

  // Circular buffer of recent bridge events (per-session keyed by sessionId)
  const recentEvents = shallowRef<BridgeEvent[]>([]);

  // Steering state
  const sendingMessage = ref(false);

  // ─── Computed ─────────────────────────────────────────────────────

  const isConnected = computed(() => connectionState.value === "connected");
  const isConnecting = computed(() => connecting.value || connectionState.value === "connecting");
  const hasError = computed(() => lastError.value !== null);
  const isTcpMode = computed(() => connectionMode.value === "tcp");
  const isStdioMode = computed(() => connectionMode.value === "stdio" || connectionMode.value === null);

  const foregroundSession = computed(() =>
    sessions.value.find((s) => s.sessionId === foregroundSessionId.value) ?? null,
  );

  const sessionEvents = computed(() => {
    return (sessionId: string) =>
      recentEvents.value.filter((e) => e.sessionId === sessionId);
  });

  // ─── Actions ──────────────────────────────────────────────────────

  function applyStatus(status: BridgeStatus) {
    connectionState.value = status.state;
    sdkAvailable.value = status.sdkAvailable;
    cliVersion.value = status.cliVersion ?? null;
    protocolVersion.value = status.protocolVersion ?? null;
    activeSessions.value = status.activeSessions;
    lastError.value = status.error ?? null;
    connectionMode.value = status.connectionMode ?? null;
  }

  async function connect(config: BridgeConnectConfig = {}) {
    connecting.value = true;
    lastError.value = null;
    logInfo("[sdk] Connecting...", config);
    try {
      const status = await sdkConnect(config);
      applyStatus(status);
      logInfo("[sdk] Connect result:", status.state, "sdk_available:", status.sdkAvailable);
      // Hydrate ancillary data after successful connection
      if (status.state === "connected") {
        await hydrateAfterConnect();
      }
    } catch (e) {
      lastError.value = toErrorMessage(e);
      connectionState.value = "error";
      logWarn("[sdk] Connect failed:", e);
    } finally {
      connecting.value = false;
    }
  }

  /** Fetch sessions, models, and auth after connecting. Quota skipped (not all CLI versions support it). */
  async function hydrateAfterConnect() {
    logInfo("[sdk] Hydrating: fetching auth, models, sessions...");
    await Promise.all([
      fetchAuthStatus(),
      fetchModels(),
      fetchSessions(),
    ]);
    logInfo("[sdk] Hydration complete: auth=", authStatus.value?.isAuthenticated, "models=", models.value.length, "sessions=", sessions.value.length);
  }

  async function disconnect() {
    try {
      await sdkDisconnect();
      connectionState.value = "disconnected";
      connectionMode.value = null;
      sessions.value = [];
      foregroundSessionId.value = null;
      activeSessions.value = 0;
    } catch (e) {
      lastError.value = toErrorMessage(e);
    }
  }

  async function refreshStatus() {
    try {
      const status = await sdkStatus();
      applyStatus(status);
    } catch (e) {
      logWarn("[sdk] Failed to refresh status", e);
    }
  }

  async function checkCliStatus() {
    try {
      const status = await sdkCliStatus();
      applyStatus(status);
    } catch (e) {
      logWarn("[sdk] Failed to check CLI status", e);
    }
  }

  async function fetchAuthStatus() {
    try {
      authStatus.value = await sdkGetAuthStatus();
    } catch (e) {
      logWarn("[sdk] Failed to fetch auth status", e);
    }
  }

  async function fetchQuota() {
    try {
      quota.value = await sdkGetQuota();
    } catch {
      // Silently ignore — many CLI versions don't support account.get_quota
      quota.value = null;
    }
  }

  async function fetchSessions() {
    try {
      sessions.value = await sdkListSessions();
      logInfo("[sdk] Sessions fetched:", sessions.value.length, "total,", sessions.value.filter(s => s.isActive).length, "active");
    } catch (e) {
      logWarn("[sdk] Failed to fetch sessions", e);
    }
  }

  async function fetchModels() {
    try {
      models.value = await sdkListModels();
    } catch (e) {
      logWarn("[sdk] Failed to fetch models", e);
    }
  }

  async function createSession(config: BridgeSessionConfig): Promise<BridgeSessionInfo | null> {
    try {
      const session = await sdkCreateSession(config);
      sessions.value = [...sessions.value, session];
      activeSessions.value = sessions.value.length;
      return session;
    } catch (e) {
      lastError.value = toErrorMessage(e);
      return null;
    }
  }

  /** Resume an existing session for steering (e.g. from --ui-server). */
  async function resumeSession(sessionId: string): Promise<BridgeSessionInfo | null> {
    logInfo("[sdk] Resuming session:", sessionId);
    try {
      const session = await sdkResumeSession(sessionId);
      logInfo("[sdk] Resume result:", session);
      lastError.value = null; // Clear any stale errors on success
      // Update existing entry or add new one
      const idx = sessions.value.findIndex((s) => s.sessionId === session.sessionId);
      if (idx >= 0) {
        // Replace with updated info (isActive = true after resume)
        const updated = [...sessions.value];
        updated[idx] = session;
        sessions.value = updated;
      } else {
        sessions.value = [...sessions.value, session];
      }
      // Also update if the returned ID matches the input (common case)
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

  async function sendMessage(sessionId: string, payload: BridgeMessagePayload): Promise<string | null> {
    sendingMessage.value = true;
    logInfo("[sdk] Sending message to session:", sessionId, "prompt:", payload.prompt?.slice(0, 50));
    try {
      const turnId = await sdkSendMessage(sessionId, payload);
      logInfo("[sdk] Message sent, turnId:", turnId);
      lastError.value = null; // Clear any stale errors on success
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
    try {
      await sdkAbortSession(sessionId);
    } catch (e) {
      lastError.value = toErrorMessage(e);
    }
  }

  async function destroySession(sessionId: string) {
    logInfo("[sdk] Destroying session:", sessionId);
    try {
      await sdkDestroySession(sessionId);
      // Remove from local list or mark inactive
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

  /** Unlink a session without destroying it — no shutdown event written. */
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
    try {
      await sdkSetSessionMode(sessionId, mode);
      // Optimistic update
      sessions.value = sessions.value.map((s) =>
        s.sessionId === sessionId ? { ...s, mode } : s,
      );
    } catch (e) {
      lastError.value = toErrorMessage(e);
    }
  }

  async function setSessionModel(sessionId: string, model: string, reasoningEffort?: string) {
    try {
      await sdkSetSessionModel(sessionId, model, reasoningEffort);
      sessions.value = sessions.value.map((s) =>
        s.sessionId === sessionId ? { ...s, model } : s,
      );
    } catch (e) {
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
    try {
      await sdkSetForegroundSession(sessionId);
      foregroundSessionId.value = sessionId;
    } catch (e) {
      lastError.value = toErrorMessage(e);
    }
  }

  // ─── Event Listeners ──────────────────────────────────────────────

  let listenersInitialized = false;
  const unlisteners: UnlistenFn[] = [];

  async function initEventListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    try {
      unlisteners.push(
        await safeListen<BridgeEvent>(IPC_EVENTS.SDK_BRIDGE_EVENT, (event) => {
          const current = recentEvents.value;
          const next = [...current, event.payload];
          // Keep bounded
          recentEvents.value = next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        }),
        await safeListen<BridgeStatus>(IPC_EVENTS.SDK_CONNECTION_CHANGED, (event) => {
          applyStatus(event.payload);
        }),
      );
    } catch (e) {
      logWarn("[sdk] Failed to initialize event listeners (not in Tauri environment)", e);
    }
  }

  function cleanup() {
    for (const unlisten of unlisteners) unlisten();
    unlisteners.length = 0;
    listenersInitialized = false;
  }

  // Initialize listeners eagerly
  initEventListeners();

  // Auto-connect when copilotSdk feature is enabled
  async function autoConnect() {
    const prefs = usePreferencesStore();
    if (prefs.isFeatureEnabled("copilotSdk") && connectionState.value === "disconnected" && !connecting.value) {
      logInfo("[sdk] Auto-connecting (copilotSdk feature enabled)...");
      await connect({});
    }
  }

  // Attempt auto-connect on store initialization (deferred to next tick so preferences are loaded)
  setTimeout(() => autoConnect(), 500);

  // ─── Public API ───────────────────────────────────────────────────

  return {
    // State
    connectionState,
    sdkAvailable,
    cliVersion,
    protocolVersion,
    activeSessions,
    lastError,
    connecting,
    connectionMode,
    authStatus,
    quota,
    sessions,
    models,
    foregroundSessionId,
    recentEvents,
    sendingMessage,

    // Computed
    isConnected,
    isConnecting,
    hasError,
    isTcpMode,
    isStdioMode,
    foregroundSession,
    sessionEvents,

    // Actions
    connect,
    disconnect,
    autoConnect,
    refreshStatus,
    checkCliStatus,
    fetchAuthStatus,
    fetchQuota,
    fetchSessions,
    fetchModels,
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
    cleanup,
  };
});
