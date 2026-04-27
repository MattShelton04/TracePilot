/**
 * SDK Bridge Pinia Store
 *
 * Manages connection to the Copilot SDK bridge, exposes real-time events,
 * and provides actions for session steering (send message, set mode/model, abort).
 *
 * Feature-gated: only activates when `copilotSdk` feature flag is enabled.
 *
 * Composed from pure slice factories in `stores/sdk/`:
 *   - `connection.ts`  connection lifecycle + hydrated caches
 *   - `messaging.ts`   per-session steering actions
 *   - `settings.ts`    persisted `cliUrl` / `logLevel`
 *
 * IPC semantics preserved: `session.resume` is never implicitly invoked, the
 * `isActive` gate on sessions is only set by the explicit `resumeSession`
 * action, and `resolvedSessionId` (owned by `useSdkSteering`) is unaffected.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import { IPC_EVENTS } from "@tracepilot/client";
import type { BridgeEvent, BridgeStatus, SessionLiveState } from "@tracepilot/types";
import { defineStore } from "pinia";
import { watch } from "vue";
import { useWindowRole } from "@/composables/useWindowRole";
import { MAX_SDK_EVENTS } from "@/config/tuning";
import { usePreferencesStore } from "@/stores/preferences";
import { createConnectionSlice } from "@/stores/sdk/connection";
import { createMessagingSlice } from "@/stores/sdk/messaging";
import { createSettingsSlice } from "@/stores/sdk/settings";
import { logInfo, logWarn } from "@/utils/logger";
import { safeListen } from "@/utils/tauriEvents";

export const useSdkStore = defineStore("sdk", () => {
  const settings = createSettingsSlice();
  const messagingRefs = { foregroundSessionIdResetter: null as null | (() => void) };

  const connection = createConnectionSlice({
    savedCliUrl: settings.savedCliUrl,
    savedLogLevel: settings.savedLogLevel,
    updateSettings: settings.updateSettings,
    onDisconnect: () => messagingRefs.foregroundSessionIdResetter?.(),
  });

  const messaging = createMessagingSlice({
    sessions: connection.sessions,
    activeSessions: connection.activeSessions,
    lastError: connection.lastError,
    recentEvents: connection.recentEvents,
  });
  messagingRefs.foregroundSessionIdResetter = () => {
    messaging.foregroundSessionId.value = null;
  };

  // ─── Event Listeners ──────────────────────────────────────────────
  let listenersInitialized = false;
  const unlisteners: UnlistenFn[] = [];

  async function initEventListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    try {
      unlisteners.push(
        await safeListen<BridgeEvent>(IPC_EVENTS.SDK_BRIDGE_EVENT, (event) => {
          // Live-streaming deltas only render in TCP mode. Stdio sends only the
          // final `assistant.message`, so accumulating it would duplicate the
          // persisted turn (placeholder + final render at the same time).
          if (connection.isTcpMode.value) {
            messaging.applyBridgeEvent(event.payload);
          }
          const current = connection.recentEvents.value;
          const next = [...current, event.payload];
          connection.recentEvents.value =
            next.length > MAX_SDK_EVENTS ? next.slice(-MAX_SDK_EVENTS) : next;
        }),
        await safeListen<BridgeStatus>(IPC_EVENTS.SDK_CONNECTION_CHANGED, (event) => {
          connection.applyStatus(event.payload);
        }),
        await safeListen<SessionLiveState>(IPC_EVENTS.SDK_SESSION_STATE_CHANGED, (event) => {
          connection.applySessionState(event.payload);
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

  initEventListeners();

  const { isMain } = useWindowRole();

  // Auto-connect when copilotSdk feature is enabled
  const prefs = usePreferencesStore();
  async function autoConnect() {
    const hydratedStatus = await connection.hydrate();
    if (hydratedStatus?.state === "connected") {
      logInfo("[sdk] Backend bridge already connected; using hydrated state");
      return;
    }
    if (
      prefs.isFeatureEnabled("copilotSdk") &&
      connection.connectionState.value === "disconnected" &&
      !connection.connecting.value
    ) {
      logInfo("[sdk] Auto-connecting (copilotSdk feature enabled)...");
      await connection.connect({
        cliUrl: settings.savedCliUrl.value || undefined,
        logLevel: settings.savedLogLevel.value || undefined,
      });
    }
  }

  if (isMain()) {
    setTimeout(() => autoConnect(), 500);
  } else {
    // Child/popout windows: don't connect a second bridge, but DO hydrate
    // the in-memory snapshot from the backend so steering UI (sessions,
    // live state, models) renders immediately. After this, broadcast
    // events keep the snapshot up to date.
    setTimeout(() => {
      connection.hydrate().catch(() => {
        /* best-effort — events will still flow once the bridge connects */
      });
    }, 100);
  }

  async function disconnect() {
    if (!isMain()) {
      logInfo("[sdk] Ignoring disconnect request from non-main window");
      return;
    }
    await connection.disconnect();
  }

  // Disconnect SDK when the feature toggle is turned off.
  watch(
    () => prefs.isFeatureEnabled("copilotSdk"),
    (enabled) => {
      if (isMain() && !enabled && connection.connectionState.value !== "disconnected") {
        logInfo("[sdk] Feature toggle disabled — disconnecting SDK bridge");
        disconnect();
      }
    },
  );

  // ─── Public API ───────────────────────────────────────────────────
  return {
    // Persisted settings
    savedCliUrl: settings.savedCliUrl,
    savedLogLevel: settings.savedLogLevel,
    updateSettings: settings.updateSettings,

    // State (connection)
    connectionState: connection.connectionState,
    sdkAvailable: connection.sdkAvailable,
    cliVersion: connection.cliVersion,
    protocolVersion: connection.protocolVersion,
    activeSessions: connection.activeSessions,
    lastError: connection.lastError,
    connecting: connection.connecting,
    connectionMode: connection.connectionMode,
    authStatus: connection.authStatus,
    quota: connection.quota,
    sessions: connection.sessions,
    models: connection.models,
    bridgeMetrics: connection.bridgeMetrics,
    sessionStatesById: connection.sessionStatesById,
    recentEvents: connection.recentEvents,
    detectedServers: connection.detectedServers,
    detecting: connection.detecting,
    lastDetectMessage: connection.lastDetectMessage,
    launching: connection.launching,
    stoppingServerPid: connection.stoppingServerPid,

    // State (messaging)
    foregroundSessionId: messaging.foregroundSessionId,
    sendingMessage: messaging.sendingMessage,
    sendingByIds: messaging.sendingByIds,
    liveTurnsBySessionId: messaging.liveTurnsBySessionId,
    isSending: messaging.isSending,

    // Computed
    isConnected: connection.isConnected,
    isConnecting: connection.isConnecting,
    hasError: connection.hasError,
    isTcpMode: connection.isTcpMode,
    isStdioMode: connection.isStdioMode,
    foregroundSession: messaging.foregroundSession,
    sessionEvents: messaging.sessionEvents,

    // Actions (connection)
    connect: connection.connect,
    disconnect,
    autoConnect,
    hydrate: connection.hydrate,
    refreshStatus: connection.refreshStatus,
    checkCliStatus: connection.checkCliStatus,
    fetchAuthStatus: connection.fetchAuthStatus,
    fetchQuota: connection.fetchQuota,
    fetchSessions: connection.fetchSessions,
    fetchModels: connection.fetchModels,
    detectUiServer: connection.detectUiServer,
    detectAndConnect: connection.detectAndConnect,
    connectToServer: connection.connectToServer,
    launchUiServer: connection.launchUiServer,
    stopUiServer: connection.stopUiServer,

    // Actions (messaging)
    createSession: messaging.createSession,
    resumeSession: messaging.resumeSession,
    sendMessage: messaging.sendMessage,
    clearLiveTurn: messaging.clearLiveTurn,
    abortSession: messaging.abortSession,
    destroySession: messaging.destroySession,
    unlinkSession: messaging.unlinkSession,
    setSessionMode: messaging.setSessionMode,
    setSessionModel: messaging.setSessionModel,
    fetchForegroundSession: messaging.fetchForegroundSession,
    setForegroundSession: messaging.setForegroundSession,

    cleanup,
  };
});
