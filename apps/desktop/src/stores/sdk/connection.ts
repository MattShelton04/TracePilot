/**
 * SDK connection slice. Owns connection lifecycle (connect/disconnect,
 * status, UI server detect/launch) and caches hydrated after connect
 * (auth, quota, sessions, models, recent events).
 *
 * IPC semantics preserved: `session.resume` is never implicitly invoked;
 * `isActive` gating lives with the explicit `resumeSession` (messaging slice).
 */

import {
  sdkCliStatus,
  sdkConnect,
  sdkDetectUiServer,
  sdkDisconnect,
  sdkGetAuthStatus,
  sdkGetQuota,
  sdkHydrate,
  sdkLaunchUiServer,
  sdkListModels,
  sdkListSessions,
  sdkStatus,
} from "@tracepilot/client";
import type {
  BridgeAuthStatus,
  BridgeConnectConfig,
  BridgeConnectionState,
  BridgeEvent,
  BridgeMetricsSnapshot,
  BridgeModelInfo,
  BridgeQuota,
  BridgeSessionInfo,
  BridgeStatus,
  DetectedUiServer,
} from "@tracepilot/types";
import { runMutation, toErrorMessage } from "@tracepilot/ui";
import { computed, ref, shallowRef } from "vue";
import { logInfo, logWarn } from "@/utils/logger";

export interface ConnectionDeps {
  savedCliUrl: { value: string };
  savedLogLevel: { value: string };
  updateSettings: (cliUrl: string, logLevel: string) => void;
  /** Extra teardown invoked inside `disconnect`'s `runMutation` (after `sdkDisconnect`). */
  onDisconnect?: () => void;
}

export function createConnectionSlice(deps: ConnectionDeps) {
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
  const bridgeMetrics = ref<BridgeMetricsSnapshot | null>(null);
  const recentEvents = shallowRef<BridgeEvent[]>([]);
  const detectedServers = ref<DetectedUiServer[]>([]);
  const detecting = ref(false);
  const lastDetectMessage = ref<string | null>(null);
  const launching = ref(false);

  const isConnected = computed(() => connectionState.value === "connected");
  const isConnecting = computed(() => connecting.value || connectionState.value === "connecting");
  const hasError = computed(() => lastError.value !== null);
  const isTcpMode = computed(() => connectionMode.value === "tcp");
  const isStdioMode = computed(
    () => connectionMode.value === "stdio" || connectionMode.value === null,
  );

  function applyStatus(status: BridgeStatus) {
    connectionState.value = status.state;
    sdkAvailable.value = status.sdkAvailable;
    cliVersion.value = status.cliVersion ?? null;
    protocolVersion.value = status.protocolVersion ?? null;
    activeSessions.value = status.activeSessions;
    lastError.value = status.error ?? null;
    connectionMode.value = status.connectionMode ?? null;
  }

  async function fetchVersionInfo() {
    try {
      const status = await sdkCliStatus();
      cliVersion.value = status.cliVersion ?? null;
      protocolVersion.value = status.protocolVersion ?? null;
    } catch (e) {
      logWarn("[sdk] Failed to fetch CLI version:", e);
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
      quota.value = null;
    }
  }

  async function fetchSessions() {
    try {
      sessions.value = await sdkListSessions();
      logInfo(
        "[sdk] Sessions fetched:",
        sessions.value.length,
        "total,",
        sessions.value.filter((s) => s.isActive).length,
        "active",
      );
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

  async function hydrateAfterConnect() {
    logInfo("[sdk] Hydrating: fetching auth, models, sessions, version...");
    await Promise.all([fetchAuthStatus(), fetchModels(), fetchSessions(), fetchVersionInfo()]);
    logInfo(
      "[sdk] Hydration complete: auth=",
      authStatus.value?.isAuthenticated,
      "models=",
      models.value.length,
      "sessions=",
      sessions.value.length,
      "cli=",
      cliVersion.value,
    );
  }

  async function hydrate(): Promise<BridgeStatus | null> {
    try {
      const snapshot = await sdkHydrate();
      applyStatus(snapshot.status);
      sessions.value = snapshot.sessions;
      activeSessions.value = snapshot.sessions.length;
      bridgeMetrics.value = snapshot.metrics;
      return snapshot.status;
    } catch (e) {
      logWarn("[sdk] Failed to hydrate bridge state", e);
      return null;
    }
  }

  async function connect(config: BridgeConnectConfig = {}): Promise<boolean> {
    connecting.value = true;
    lastError.value = null;
    const safeConfig = { ...config, githubToken: config.githubToken ? "<redacted>" : undefined };
    logInfo("[sdk] Connecting...", safeConfig);
    try {
      const status = await sdkConnect(config);
      applyStatus(status);
      logInfo("[sdk] Connect result:", status.state, "sdk_available:", status.sdkAvailable);
      if (status.state === "connected") {
        await hydrateAfterConnect();
        return true;
      }
      return false;
    } catch (e) {
      const msg = toErrorMessage(e);
      if (isDisabledByPreferenceError(msg)) {
        // Expected state when the user has toggled the SDK off — not an error.
        // Leave connectionState as `disconnected` and don't surface a red banner.
        lastError.value = null;
        connectionState.value = "disconnected";
        logInfo("[sdk] Connect skipped — disabled by user preference");
        return false;
      }
      lastError.value = msg;
      connectionState.value = "error";
      logWarn("[sdk] Connect failed:", e);
      return false;
    } finally {
      connecting.value = false;
    }
  }

  function isDisabledByPreferenceError(msg: string | null | undefined): boolean {
    if (!msg) return false;
    return msg.toLowerCase().includes("disabled by user preference");
  }

  async function disconnect() {
    await runMutation(lastError, async () => {
      await sdkDisconnect();
      connectionState.value = "disconnected";
      connectionMode.value = null;
      sessions.value = [];
      bridgeMetrics.value = null;
      deps.onDisconnect?.();
      activeSessions.value = 0;
    });
  }

  async function refreshStatus() {
    try {
      applyStatus(await sdkStatus());
    } catch (e) {
      logWarn("[sdk] Failed to refresh status", e);
    }
  }

  async function checkCliStatus() {
    try {
      applyStatus(await sdkCliStatus());
    } catch (e) {
      logWarn("[sdk] Failed to check CLI status", e);
    }
  }

  async function detectUiServer(): Promise<DetectedUiServer[]> {
    detecting.value = true;
    lastDetectMessage.value = null;
    try {
      const servers = await sdkDetectUiServer();
      detectedServers.value = servers;
      if (servers.length === 0) {
        lastDetectMessage.value =
          "No running Copilot servers found. Launch one or start copilot --ui-server manually.";
      } else {
        lastDetectMessage.value = `Found ${servers.length} server${servers.length !== 1 ? "s" : ""}`;
      }
      logInfo(
        "[sdk] Detected UI servers:",
        servers.length,
        servers.map((s) => s.address),
      );
      return servers;
    } catch (e) {
      logWarn("[sdk] UI server detection failed:", e);
      detectedServers.value = [];
      lastDetectMessage.value = `Detection failed — ${toErrorMessage(e)}`;
      return [];
    } finally {
      detecting.value = false;
    }
  }

  async function detectAndConnect(): Promise<boolean> {
    if (connectionState.value === "connected") {
      await disconnect();
    }
    const servers = await detectUiServer();
    if (servers.length === 0) return false;
    const server = servers[0];
    logInfo("[sdk] Auto-connecting to detected UI server:", server.address);
    deps.updateSettings(server.address, deps.savedLogLevel.value);
    await connect({ cliUrl: server.address, logLevel: deps.savedLogLevel.value || undefined });
    return connectionState.value === "connected";
  }

  async function connectToServer(address: string): Promise<boolean> {
    if (connectionState.value === "connected") {
      await disconnect();
    }
    deps.updateSettings(address, deps.savedLogLevel.value);
    await connect({ cliUrl: address, logLevel: deps.savedLogLevel.value || undefined });
    return connectionState.value === "connected";
  }

  async function launchUiServer(workingDir?: string): Promise<number | null> {
    launching.value = true;
    try {
      const pid = await sdkLaunchUiServer(workingDir);
      logInfo("[sdk] Launched UI server, PID:", pid);
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

  return {
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
    bridgeMetrics,
    recentEvents,
    detectedServers,
    detecting,
    lastDetectMessage,
    launching,
    isConnected,
    isConnecting,
    hasError,
    isTcpMode,
    isStdioMode,
    applyStatus,
    connect,
    disconnect,
    refreshStatus,
    checkCliStatus,
    fetchAuthStatus,
    fetchQuota,
    fetchSessions,
    fetchModels,
    fetchVersionInfo,
    hydrateAfterConnect,
    hydrate,
    detectUiServer,
    detectAndConnect,
    connectToServer,
    launchUiServer,
  };
}

export type ConnectionSlice = ReturnType<typeof createConnectionSlice>;
