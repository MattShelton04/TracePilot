/** Copilot SDK bridge client IPC wrappers. */

import type {
  BridgeAuthStatus,
  BridgeConnectConfig,
  BridgeHydrationSnapshot,
  BridgeMessagePayload,
  BridgeMetricsSnapshot,
  BridgeModelInfo,
  BridgeQuota,
  BridgeSessionConfig,
  BridgeSessionInfo,
  BridgeSessionMode,
  BridgeStatus,
  DetectedUiServer,
  SdkRecoveryDecision,
  SdkRegistryRecord,
  SessionLiveState,
} from "@tracepilot/types";
import { createInvoke } from "./invoke.js";

const invoke = createInvoke("SDK");

// ─── Connection ───────────────────────────────────────────────────

export async function sdkConnect(config: BridgeConnectConfig): Promise<BridgeStatus> {
  return invoke<BridgeStatus>("sdk_connect", { config });
}

export async function sdkDisconnect(): Promise<void> {
  return invoke<void>("sdk_disconnect");
}

export async function sdkStatus(): Promise<BridgeStatus> {
  return invoke<BridgeStatus>("sdk_status");
}

export async function sdkHydrate(): Promise<BridgeHydrationSnapshot> {
  return invoke<BridgeHydrationSnapshot>("sdk_hydrate");
}

export async function sdkGetSessionState(sessionId: string): Promise<SessionLiveState | null> {
  return invoke<SessionLiveState | null>("sdk_get_session_state", { sessionId });
}

export async function sdkListSessionStates(): Promise<SessionLiveState[]> {
  return invoke<SessionLiveState[]>("sdk_list_session_states");
}

export async function sdkCliStatus(): Promise<BridgeStatus> {
  return invoke<BridgeStatus>("sdk_cli_status");
}

// ─── Sessions ─────────────────────────────────────────────────────

export async function sdkCreateSession(config: BridgeSessionConfig): Promise<BridgeSessionInfo> {
  return invoke<BridgeSessionInfo>("sdk_create_session", { config });
}

export async function sdkResumeSession(
  sessionId: string,
  workingDirectory?: string,
  model?: string,
): Promise<BridgeSessionInfo> {
  return invoke<BridgeSessionInfo>("sdk_resume_session", {
    sessionId,
    workingDirectory: workingDirectory ?? null,
    model: model ?? null,
  });
}

export async function sdkSendMessage(
  sessionId: string,
  payload: BridgeMessagePayload,
): Promise<string> {
  return invoke<string>("sdk_send_message", { sessionId, payload });
}

export async function sdkAbortSession(sessionId: string): Promise<void> {
  return invoke<void>("sdk_abort_session", { sessionId });
}

export async function sdkDestroySession(sessionId: string): Promise<void> {
  return invoke<void>("sdk_destroy_session", { sessionId });
}

/** Unlink a session from the bridge without destroying it (no shutdown event written). */
export async function sdkUnlinkSession(sessionId: string): Promise<void> {
  return invoke<void>("sdk_unlink_session", { sessionId });
}

export async function sdkListRegistrySessions(): Promise<SdkRegistryRecord[]> {
  return invoke<SdkRegistryRecord[]>("sdk_list_registry_sessions");
}

export async function sdkRegistryRecovery(): Promise<SdkRecoveryDecision[]> {
  return invoke<SdkRecoveryDecision[]>("sdk_registry_recovery");
}

export async function sdkForgetRegistrySession(sessionId: string): Promise<boolean> {
  return invoke<boolean>("sdk_forget_registry_session", { sessionId });
}

export async function sdkPruneRegistry(olderThanDays = 30): Promise<number> {
  return invoke<number>("sdk_prune_registry", { olderThanDays });
}

export async function sdkSetSessionMode(sessionId: string, mode: BridgeSessionMode): Promise<void> {
  return invoke<void>("sdk_set_session_mode", { sessionId, mode });
}

export async function sdkSetSessionModel(
  sessionId: string,
  model: string,
  reasoningEffort?: string,
): Promise<void> {
  return invoke<void>("sdk_set_session_model", { sessionId, model, reasoningEffort });
}

export async function sdkListSessions(): Promise<BridgeSessionInfo[]> {
  return invoke<BridgeSessionInfo[]>("sdk_list_sessions");
}

export async function sdkGetForegroundSession(): Promise<string | null> {
  return invoke<string | null>("sdk_get_foreground_session");
}

export async function sdkSetForegroundSession(sessionId: string): Promise<void> {
  return invoke<void>("sdk_set_foreground_session", { sessionId });
}

// ─── Quota & Auth ─────────────────────────────────────────────────

export async function sdkGetQuota(): Promise<BridgeQuota> {
  return invoke<BridgeQuota>("sdk_get_quota");
}

export async function sdkGetAuthStatus(): Promise<BridgeAuthStatus> {
  return invoke<BridgeAuthStatus>("sdk_get_auth_status");
}

// ─── Models ───────────────────────────────────────────────────────

export async function sdkListModels(): Promise<BridgeModelInfo[]> {
  return invoke<BridgeModelInfo[]>("sdk_list_models");
}

// ─── UI Server Detection ──────────────────────────────────────────

/** Detect running `copilot --ui-server` processes on the local machine. */
export async function sdkDetectUiServer(): Promise<DetectedUiServer[]> {
  return invoke<DetectedUiServer[]>("sdk_detect_ui_server");
}

export async function sdkLaunchUiServer(workingDir?: string): Promise<number> {
  return invoke<number>("sdk_launch_ui_server", { workingDir: workingDir ?? null });
}

// ─── Observability ────────────────────────────────────────────────

/**
 * Snapshot of bridge broadcast-channel counters (events forwarded, dropped
 * due to lag, lag occurrences). Cheap to poll. See Phase 1A.6.
 */
export async function sdkBridgeMetrics(): Promise<BridgeMetricsSnapshot> {
  return invoke<BridgeMetricsSnapshot>("sdk_bridge_metrics");
}
