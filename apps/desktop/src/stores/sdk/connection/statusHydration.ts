import {
  sdkCliStatus,
  sdkGetAuthStatus,
  sdkGetQuota,
  sdkHydrate,
  sdkListModels,
  sdkListSessions,
} from "@tracepilot/client";
import type { BridgeSessionInfo, BridgeStatus, SessionLiveState } from "@tracepilot/types";
import { logInfo, logWarn } from "@/utils/logger";
import type { ConnectionContext } from "./context";

export function applyStatus(context: ConnectionContext, status: BridgeStatus) {
  context.connectionState.value = status.state;
  context.sdkAvailable.value = status.sdkAvailable;
  context.cliVersion.value = status.cliVersion ?? null;
  context.protocolVersion.value = status.protocolVersion ?? null;
  context.activeSessions.value = status.activeSessions;
  context.lastError.value = status.error ?? null;
  context.connectionMode.value = status.connectionMode ?? null;
}

export function countActiveSessions(nextSessions: BridgeSessionInfo[]): number {
  return nextSessions.filter((session) => session.isActive).length;
}

export function applySessionState(context: ConnectionContext, state: SessionLiveState) {
  context.sessionStatesById.value = {
    ...context.sessionStatesById.value,
    [state.sessionId]: state,
  };
}

export function createStatusHydrationActions(context: ConnectionContext) {
  async function fetchVersionInfo() {
    try {
      const status = await sdkCliStatus();
      context.cliVersion.value = status.cliVersion ?? null;
      context.protocolVersion.value = status.protocolVersion ?? null;
    } catch (e) {
      logWarn("[sdk] Failed to fetch CLI version:", e);
    }
  }

  async function fetchAuthStatus() {
    try {
      context.authStatus.value = await sdkGetAuthStatus();
    } catch (e) {
      logWarn("[sdk] Failed to fetch auth status", e);
    }
  }

  async function fetchQuota() {
    try {
      context.quota.value = await sdkGetQuota();
    } catch {
      context.quota.value = null;
    }
  }

  async function fetchSessions() {
    try {
      context.sessions.value = await sdkListSessions();
      context.activeSessions.value = countActiveSessions(context.sessions.value);
      logInfo(
        "[sdk] Tracked sessions fetched:",
        context.sessions.value.length,
        "tracked,",
        context.sessions.value.filter((s) => s.isActive).length,
        "active",
      );
    } catch (e) {
      logWarn("[sdk] Failed to fetch sessions", e);
    }
  }

  async function fetchModels() {
    try {
      context.models.value = await sdkListModels();
    } catch (e) {
      logWarn("[sdk] Failed to fetch models", e);
    }
  }

  async function hydrateAfterConnect() {
    logInfo("[sdk] Hydrating: fetching auth, models, sessions, version...");
    await Promise.all([fetchAuthStatus(), fetchModels(), fetchSessions(), fetchVersionInfo()]);
    logInfo(
      "[sdk] Hydration complete: auth=",
      context.authStatus.value?.isAuthenticated,
      "models=",
      context.models.value.length,
      "sessions=",
      context.sessions.value.length,
      "cli=",
      context.cliVersion.value,
    );
  }

  async function hydrate(): Promise<BridgeStatus | null> {
    try {
      const snapshot = await sdkHydrate();
      applyStatus(context, snapshot.status);
      context.sessions.value = snapshot.sessions;
      context.sessionStatesById.value = Object.fromEntries(
        (snapshot.sessionStates ?? []).map((state) => [state.sessionId, state]),
      );
      context.activeSessions.value = countActiveSessions(snapshot.sessions);
      context.bridgeMetrics.value = snapshot.metrics;
      return snapshot.status;
    } catch (e) {
      logWarn("[sdk] Failed to hydrate bridge state", e);
      return null;
    }
  }

  return {
    fetchVersionInfo,
    fetchAuthStatus,
    fetchQuota,
    fetchSessions,
    fetchModels,
    hydrateAfterConnect,
    hydrate,
  };
}
