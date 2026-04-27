import type { BridgeMetricsSnapshot, SessionLiveState } from "@tracepilot/types";
import { filterSdkStatesByScope } from "@/composables/alertWatcherScope";
import { dispatchAlert } from "@/composables/useAlertDispatcher";
import { useAlertWatcherStore } from "@/stores/alertWatcher";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";
import { useSessionsStore } from "@/stores/sessions";

type SdkStateAlertType =
  | "sdk-user-input-required"
  | "sdk-permission-required"
  | "sdk-session-error"
  | "sdk-session-idle";

function sdkRequestKey(
  sessionId: string,
  type: "sdk-user-input-required" | "sdk-permission-required",
  state: SessionLiveState,
): string {
  const pending =
    type === "sdk-user-input-required" ? state.pendingUserInput : state.pendingPermission;
  return [
    sessionId,
    type,
    pending?.requestId ??
      state.lastEventId ??
      state.currentTurnId ??
      pending?.requestedAt ??
      "unknown",
  ].join(":");
}

function sdkTransitionKey(sessionId: string, type: string, state: SessionLiveState): string {
  return [sessionId, type, state.lastEventId ?? state.lastEventTimestamp ?? state.status].join(":");
}

function fallbackSdkSessionLabel(state: SessionLiveState): string {
  return `SDK session ${state.sessionId.slice(0, 8)}`;
}

function getSessionSummary(sessionId: string): string | undefined {
  try {
    const match = useSessionsStore().sessions.find((session) => session.id === sessionId);
    const summary = match?.summary?.trim();
    return summary || undefined;
  } catch {
    return undefined;
  }
}

function refreshSessionListFromSdkState() {
  try {
    void useSessionsStore().refreshSessions();
  } catch {
    // Store may be unavailable in narrow unit-test contexts.
  }
}

function summarizeSdkSession(state: SessionLiveState): { label: string; summary?: string } {
  const summary = getSessionSummary(state.sessionId);
  return {
    label: summary ?? fallbackSdkSessionLabel(state),
    summary,
  };
}

function requestMatter(
  pending: SessionLiveState["pendingUserInput"] | SessionLiveState["pendingPermission"],
  fallback: string,
): string {
  const summary = pending?.summary?.trim();
  if (summary) return summary;
  const kind = pending?.kind?.trim();
  return kind ? `${fallback} (${kind})` : fallback;
}

function getTrackedSdkSessionIds(): Set<string> {
  try {
    return new Set(useSdkStore().sessions.map((session) => session.sessionId));
  } catch {
    return new Set();
  }
}

function dispatchSdkStateAlert(state: SessionLiveState, type: SdkStateAlertType) {
  const { label, summary } = summarizeSdkSession(state);
  const pending =
    type === "sdk-user-input-required" ? state.pendingUserInput : state.pendingPermission;

  if (type === "sdk-user-input-required") {
    dispatchAlert({
      type,
      sessionId: state.sessionId,
      sessionSummary: summary,
      title: label,
      body: `Input needed: ${requestMatter(pending, "Waiting for your response")}`,
      metadata: {
        source: "copilot-sdk",
        sessionLabel: label,
        requestSummary: pending?.summary,
        requestId: pending?.requestId,
        requestKind: pending?.kind,
      },
    });
    return;
  }

  if (type === "sdk-permission-required") {
    dispatchAlert({
      type,
      sessionId: state.sessionId,
      sessionSummary: summary,
      title: label,
      body: `Permission required: ${requestMatter(pending, "Waiting for approval")}`,
      metadata: {
        source: "copilot-sdk",
        sessionLabel: label,
        requestSummary: pending?.summary,
        requestId: pending?.requestId,
        requestKind: pending?.kind,
      },
    });
    return;
  }

  if (type === "sdk-session-error") {
    dispatchAlert({
      type,
      sessionId: state.sessionId,
      sessionSummary: summary,
      title: label,
      body: state.lastError ? `SDK error: ${state.lastError}` : "SDK session encountered an error",
      metadata: {
        source: "copilot-sdk",
        lastEventId: state.lastEventId,
        lastEventType: state.lastEventType,
      },
    });
    return;
  }

  dispatchAlert({
    type,
    sessionId: state.sessionId,
    sessionSummary: summary,
    title: label,
    body: "SDK session is idle",
    metadata: {
      source: "copilot-sdk",
      lastEventId: state.lastEventId,
      lastEventType: state.lastEventType,
    },
  });
}

export function checkSdkSessionStateAlerts(
  statesById: Record<string, SessionLiveState>,
  options: { baselineOnly?: boolean } = {},
) {
  const prefs = usePreferencesStore();
  const store = useAlertWatcherStore();
  const trackedIds = getTrackedSdkSessionIds();
  const allStates = Object.values(statesById).filter((state) => trackedIds.has(state.sessionId));
  store.pruneSdkEntries(new Set(allStates.map((state) => state.sessionId)));
  const states = filterSdkStatesByScope(allStates);

  for (const state of states) {
    const previousStatus = store.getLastSdkStatus(state.sessionId);

    if (options.baselineOnly) {
      if (state.status === "waiting_for_input") {
        store.markSdkStateAlerted(sdkRequestKey(state.sessionId, "sdk-user-input-required", state));
      }
      if (state.status === "waiting_for_permission") {
        store.markSdkStateAlerted(sdkRequestKey(state.sessionId, "sdk-permission-required", state));
      }
      if (state.status === "error") {
        store.markSdkStateAlerted(sdkTransitionKey(state.sessionId, "sdk-session-error", state));
      }
      if (state.status === "idle") {
        store.markSdkStateAlerted(sdkTransitionKey(state.sessionId, "sdk-session-idle", state));
      }
      store.setLastSdkStatus(state.sessionId, state.status);
      continue;
    }

    if (state.status === "idle" && previousStatus !== null && previousStatus !== "idle") {
      refreshSessionListFromSdkState();
    }

    if (
      prefs.alertsEnabled &&
      prefs.alertsOnAskUser &&
      state.status === "waiting_for_input" &&
      state.pendingUserInput
    ) {
      const key = sdkRequestKey(state.sessionId, "sdk-user-input-required", state);
      if (!store.hasAlertedSdkState(key)) {
        store.markSdkStateAlerted(key);
        dispatchSdkStateAlert(state, "sdk-user-input-required");
      }
    }

    if (
      prefs.alertsEnabled &&
      prefs.alertsOnAskUser &&
      state.status === "waiting_for_permission" &&
      state.pendingPermission
    ) {
      const key = sdkRequestKey(state.sessionId, "sdk-permission-required", state);
      if (!store.hasAlertedSdkState(key)) {
        store.markSdkStateAlerted(key);
        dispatchSdkStateAlert(state, "sdk-permission-required");
      }
    }

    if (
      prefs.alertsEnabled &&
      prefs.alertsOnSessionError &&
      state.status === "error" &&
      state.lastError
    ) {
      const key = sdkTransitionKey(state.sessionId, "sdk-session-error", state);
      if (!store.hasAlertedSdkState(key)) {
        store.markSdkStateAlerted(key);
        dispatchSdkStateAlert(state, "sdk-session-error");
      }
    }

    if (
      prefs.alertsEnabled &&
      prefs.alertsOnSessionEnd &&
      state.status === "idle" &&
      previousStatus !== null &&
      previousStatus !== "idle"
    ) {
      const key = sdkTransitionKey(state.sessionId, "sdk-session-idle", state);
      if (!store.hasAlertedSdkState(key)) {
        store.markSdkStateAlerted(key);
        dispatchSdkStateAlert(state, "sdk-session-idle");
      }
    }

    store.setLastSdkStatus(state.sessionId, state.status);
  }
}

export function checkSdkBridgeMetricsAlerts(metrics: BridgeMetricsSnapshot | null) {
  if (!metrics) return;
  const prefs = usePreferencesStore();
  if (!prefs.alertsEnabled || !prefs.alertsOnSessionError) return;
  if (metrics.eventsDroppedDueToLag <= 0 && metrics.lagOccurrences <= 0) return;

  const store = useAlertWatcherStore();
  const key = `sdk-bridge:sdk-event-lag:${metrics.eventsDroppedDueToLag}:${metrics.lagOccurrences}`;
  if (store.hasAlertedSdkState(key)) return;
  store.markSdkStateAlerted(key);

  dispatchAlert({
    type: "sdk-event-lag",
    sessionId: "sdk-bridge",
    sessionSummary: "Copilot SDK bridge",
    title: "SDK Event Lag Detected",
    body: `Copilot SDK bridge reported ${metrics.lagOccurrences} lag occurrence${
      metrics.lagOccurrences === 1 ? "" : "s"
    } and ${metrics.eventsDroppedDueToLag} dropped event${metrics.eventsDroppedDueToLag === 1 ? "" : "s"}`,
    metadata: {
      source: "copilot-sdk",
      eventsForwarded: metrics.eventsForwarded,
      eventsDroppedDueToLag: metrics.eventsDroppedDueToLag,
      lagOccurrences: metrics.lagOccurrences,
    },
  });
}
