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
import type { Ref, ShallowRef } from "vue";

export interface ConnectionDeps {
  savedCliUrl: { value: string };
  savedLogLevel: { value: string };
  updateSettings: (cliUrl: string, logLevel: string) => void;
  /** Extra teardown invoked inside `disconnect`'s `runMutation` (after `sdkDisconnect`). */
  onDisconnect?: () => void;
}

export interface ConnectionContext {
  deps: ConnectionDeps;
  connectionState: Ref<BridgeConnectionState>;
  sdkAvailable: Ref<boolean>;
  cliVersion: Ref<string | null>;
  protocolVersion: Ref<number | null>;
  activeSessions: Ref<number>;
  lastError: Ref<string | null>;
  connecting: Ref<boolean>;
  connectionMode: Ref<string | null>;
  authStatus: Ref<BridgeAuthStatus | null>;
  quota: Ref<BridgeQuota | null>;
  sessions: Ref<BridgeSessionInfo[]>;
  models: Ref<BridgeModelInfo[]>;
  bridgeMetrics: Ref<BridgeMetricsSnapshot | null>;
  sessionStatesById: ShallowRef<Record<string, SessionLiveState>>;
  recentEvents: ShallowRef<BridgeEvent[]>;
  detectedServers: Ref<DetectedUiServer[]>;
  detecting: Ref<boolean>;
  lastDetectMessage: Ref<string | null>;
  launching: Ref<boolean>;
  stoppingServerPid: Ref<number | null>;
}
