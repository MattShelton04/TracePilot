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
  sdkDetectUiServer,
  sdkDisconnect,
  sdkGetAuthStatus,
  sdkGetForegroundSession,
  sdkGetQuota,
  sdkLaunchUiServer,
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
  DetectedUiServer,
} from "@tracepilot/types";
import { IPC_EVENTS } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref, shallowRef, watch } from "vue";
import { safeListen } from "@/utils/tauriEvents";
import { logInfo, logWarn } from "@/utils/logger";
import { usePreferencesStore } from "@/stores/preferences";

const MAX_EVENTS = 500;
const SDK_SETTINGS_KEY = "tracepilot:sdk-settings";

interface SdkSettings {
  cliUrl: string;
  logLevel: string;
}

function loadSdkSettings(): SdkSettings {
  try {
    const raw = localStorage.getItem(SDK_SETTINGS_KEY);
    if (raw) return { cliUrl: "", logLevel: "info", ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { cliUrl: "", logLevel: "info" };
}

function saveSdkSettings(settings: SdkSettings) {
  localStorage.setItem(SDK_SETTINGS_KEY, JSON.stringify(settings));
}

export const useSdkStore = defineStore("sdk", () => {
  // ─── Persisted settings ─────────────────────────────────────────
  const savedSettings = loadSdkSettings();
  const savedCliUrl = ref(savedSettings.cliUrl);
  const savedLogLevel = ref(savedSettings.logLevel);

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

  // UI server detection
  const detectedServers = ref<DetectedUiServer[]>([]);
  const detecting = ref(false);
  /** Message shown after detection: "Found N server(s)" or "No servers found" */
  const lastDetectMessage = ref<string | null>(null);
  /** True while launching a UI server process */
  const launching = ref(false);

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

  async function connect(config: BridgeConnectConfig = {}): Promise<boolean> {
    connecting.value = true;
    lastError.value = null;
    // Redact sensitive fields before logging
    const safeConfig = { ...config, githubToken: config.githubToken ? "<redacted>" : undefined };
    logInfo("[sdk] Connecting...", safeConfig);
    try {
      const status = await sdkConnect(config);
      applyStatus(status);
      logInfo("[sdk] Connect result:", status.state, "sdk_available:", status.sdkAvailable);
      // Hydrate ancillary data after successful connection
      if (status.state === "connected") {
        await hydrateAfterConnect();
        return true;
      }
      return false;
    } catch (e) {
      lastError.value = toErrorMessage(e);
      connectionState.value = "error";
      logWarn("[sdk] Connect failed:", e);
      return false;
    } finally {
      connecting.value = false;
    }
  }

  /** Fetch CLI version info from the connected SDK. */
  async function fetchVersionInfo() {
    try {
      const status = await sdkCliStatus();
      cliVersion.value = status.cliVersion ?? null;
      protocolVersion.value = status.protocolVersion ?? null;
    } catch (e) {
      logWarn("[sdk] Failed to fetch CLI version:", e);
    }
  }

  /** Fetch sessions, models, and auth after connecting. Quota skipped (not all CLI versions support it). */
  async function hydrateAfterConnect() {
    logInfo("[sdk] Hydrating: fetching auth, models, sessions, version...");
    await Promise.all([
      fetchAuthStatus(),
      fetchModels(),
      fetchSessions(),
      fetchVersionInfo(),
    ]);
    logInfo("[sdk] Hydration complete: auth=", authStatus.value?.isAuthenticated, "models=", models.value.length, "sessions=", sessions.value.length, "cli=", cliVersion.value);
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
  async function resumeSession(sessionId: string, workingDirectory?: string, model?: string): Promise<BridgeSessionInfo | null> {
    logInfo("[sdk] Resuming session:", sessionId, "cwd:", workingDirectory ?? "(none)", "model:", model ?? "(none)");
    try {
      const session = await sdkResumeSession(sessionId, workingDirectory, model);
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
      logInfo("[sdk] setSessionModel:", { sessionId, model, reasoningEffort });
      await sdkSetSessionModel(sessionId, model, reasoningEffort);
      logInfo("[sdk] setSessionModel succeeded — optimistically updating to:", model);
      sessions.value = sessions.value.map((s) =>
        s.sessionId === sessionId ? { ...s, model } : s,
      );
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

  // Disconnect when browser window unloads (app close / refresh)
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      if (connectionState.value === "connected") {
        sdkDisconnect().catch(() => {});
      }
    });
  }

  // Auto-connect when copilotSdk feature is enabled
  const prefs = usePreferencesStore();
  async function autoConnect() {
    if (prefs.isFeatureEnabled("copilotSdk") && connectionState.value === "disconnected" && !connecting.value) {
      logInfo("[sdk] Auto-connecting (copilotSdk feature enabled)...");
      await connect({
        cliUrl: savedCliUrl.value || undefined,
        logLevel: savedLogLevel.value || undefined,
      });
    }
  }

  function updateSettings(newCliUrl: string, newLogLevel: string) {
    savedCliUrl.value = newCliUrl;
    savedLogLevel.value = newLogLevel;
    saveSdkSettings({ cliUrl: newCliUrl, logLevel: newLogLevel });
  }

  /** Detect running `copilot --ui-server` instances and return their addresses. */
  async function detectUiServer(): Promise<DetectedUiServer[]> {
    detecting.value = true;
    lastDetectMessage.value = null;
    try {
      const servers = await sdkDetectUiServer();
      detectedServers.value = servers;
      if (servers.length === 0) {
        lastDetectMessage.value = "No running Copilot servers found. Launch one or start copilot --ui-server manually.";
      } else {
        lastDetectMessage.value = `Found ${servers.length} server${servers.length !== 1 ? "s" : ""}`;
      }
      logInfo("[sdk] Detected UI servers:", servers.length, servers.map(s => s.address));
      return servers;
    } catch (e) {
      logWarn("[sdk] UI server detection failed:", e);
      detectedServers.value = [];
      lastDetectMessage.value = "Detection failed — " + toErrorMessage(e);
      return [];
    } finally {
      detecting.value = false;
    }
  }

  /** Detect a UI server and auto-connect to the first one found. */
  async function detectAndConnect(): Promise<boolean> {
    // If already connected, disconnect first so we can reconnect to TCP
    if (connectionState.value === "connected") {
      await disconnect();
    }
    const servers = await detectUiServer();
    if (servers.length === 0) return false;
    // Use the first detected server
    const server = servers[0];
    logInfo("[sdk] Auto-connecting to detected UI server:", server.address);
    updateSettings(server.address, savedLogLevel.value);
    await connect({ cliUrl: server.address, logLevel: savedLogLevel.value || undefined });
    return connectionState.value === "connected";
  }

  /** Switch to a specific server address (disconnect first if needed). */
  async function connectToServer(address: string): Promise<boolean> {
    if (connectionState.value === "connected") {
      await disconnect();
    }
    updateSettings(address, savedLogLevel.value);
    await connect({ cliUrl: address, logLevel: savedLogLevel.value || undefined });
    return connectionState.value === "connected";
  }

  /** Launch a new `copilot --ui-server` terminal and optionally auto-detect after a delay. */
  async function launchUiServer(workingDir?: string): Promise<number | null> {
    launching.value = true;
    try {
      const pid = await sdkLaunchUiServer(workingDir);
      logInfo("[sdk] Launched UI server, PID:", pid);
      // Give the server a moment to start, then auto-detect
      setTimeout(async () => {
        await detectUiServer();
        launching.value = false;
      }, 3000);
      return pid;
    } catch (e) {
      lastError.value = toErrorMessage(e);
      logWarn("[sdk] Failed to launch UI server:", e);
      launching.value = false;
      return null;
    }
  }

  // Attempt auto-connect on store initialization (deferred to next tick so preferences are loaded)
  setTimeout(() => autoConnect(), 500);

  // Disconnect SDK when the feature toggle is turned off
  watch(
    () => prefs.isFeatureEnabled("copilotSdk"),
    (enabled) => {
      if (!enabled && connectionState.value !== "disconnected") {
        logInfo("[sdk] Feature toggle disabled — disconnecting SDK bridge");
        disconnect();
      }
    },
  );

  // ─── Public API ───────────────────────────────────────────────────

  return {
    // Persisted settings
    savedCliUrl,
    savedLogLevel,
    updateSettings,

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
    detectedServers,
    detecting,
    lastDetectMessage,
    launching,

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
    detectUiServer,
    detectAndConnect,
    connectToServer,
    launchUiServer,
    cleanup,
  };
});
