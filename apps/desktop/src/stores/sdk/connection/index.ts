/**
 * SDK connection slice. Owns connection lifecycle (connect/disconnect,
 * status, UI server detect/launch) and caches hydrated after connect
 * (auth, quota, tracked sessions, models, recent events).
 *
 * IPC semantics preserved: `session.resume` is never implicitly invoked;
 * `isActive` gating lives with the explicit `resumeSession` (messaging slice).
 */

import type {
  BridgeAuthStatus,
  BridgeConnectionState,
  BridgeEvent,
  BridgeMetricsSnapshot,
  BridgeModelInfo,
  BridgeQuota,
  BridgeSessionInfo,
  DetectedUiServer,
  SessionLiveState,
} from "@tracepilot/types";
import { computed, ref, shallowRef } from "vue";
import type { ConnectionContext, ConnectionDeps } from "./context";
import { createLifecycleActions } from "./lifecycle";
import { applySessionState, applyStatus, createStatusHydrationActions } from "./statusHydration";
import { createUiServerActions } from "./uiServer";

export type { ConnectionDeps } from "./context";

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
  const sessionStatesById = shallowRef<Record<string, SessionLiveState>>({});
  const recentEvents = shallowRef<BridgeEvent[]>([]);
  const detectedServers = ref<DetectedUiServer[]>([]);
  const detecting = ref(false);
  const lastDetectMessage = ref<string | null>(null);
  const launching = ref(false);
  const stoppingServerPid = ref<number | null>(null);

  const isConnected = computed(() => connectionState.value === "connected");
  const isConnecting = computed(() => connecting.value || connectionState.value === "connecting");
  const hasError = computed(() => lastError.value !== null);
  const isTcpMode = computed(() => connectionMode.value === "tcp");
  const isStdioMode = computed(
    () => connectionMode.value === "stdio" || connectionMode.value === null,
  );

  const context: ConnectionContext = {
    deps,
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
    sessionStatesById,
    recentEvents,
    detectedServers,
    detecting,
    lastDetectMessage,
    launching,
    stoppingServerPid,
  };

  const statusHydration = createStatusHydrationActions(context);
  const lifecycle = createLifecycleActions(context, statusHydration.hydrateAfterConnect);
  const uiServer = createUiServerActions(context, lifecycle);

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
    sessionStatesById,
    recentEvents,
    detectedServers,
    detecting,
    lastDetectMessage,
    launching,
    stoppingServerPid,
    isConnected,
    isConnecting,
    hasError,
    isTcpMode,
    isStdioMode,
    applyStatus: (status: Parameters<typeof applyStatus>[1]) => applyStatus(context, status),
    applySessionState: (state: Parameters<typeof applySessionState>[1]) =>
      applySessionState(context, state),
    ...lifecycle,
    ...statusHydration,
    ...uiServer,
  };
}

export type ConnectionSlice = ReturnType<typeof createConnectionSlice>;
