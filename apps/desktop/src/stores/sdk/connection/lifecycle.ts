import { sdkCliStatus, sdkConnect, sdkDisconnect, sdkStatus } from "@tracepilot/client";
import type { BridgeConnectConfig } from "@tracepilot/types";
import { runMutation, toErrorMessage } from "@tracepilot/ui";
import { logInfo, logWarn } from "@/utils/logger";
import type { ConnectionContext } from "./context";
import { applyStatus } from "./statusHydration";

function isDisabledByPreferenceError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return msg.toLowerCase().includes("disabled by user preference");
}

export function createLifecycleActions(
  context: ConnectionContext,
  hydrateAfterConnect: () => Promise<void>,
) {
  async function connect(config: BridgeConnectConfig = {}): Promise<boolean> {
    context.connecting.value = true;
    context.lastError.value = null;
    const safeConfig = { ...config, githubToken: config.githubToken ? "<redacted>" : undefined };
    logInfo("[sdk] Connecting...", safeConfig);
    try {
      const status = await sdkConnect(config);
      applyStatus(context, status);
      logInfo("[sdk] Connect result:", status.state, "sdk_available:", status.sdkAvailable);
      if (status.state === "connected") {
        await hydrateAfterConnect();
        return true;
      }
      return false;
    } catch (e) {
      const msg = toErrorMessage(e);
      if (isDisabledByPreferenceError(msg)) {
        context.lastError.value = null;
        context.connectionState.value = "disconnected";
        logInfo("[sdk] Connect skipped — disabled by user preference");
        return false;
      }
      context.lastError.value = msg;
      context.connectionState.value = "error";
      logWarn("[sdk] Connect failed:", e);
      return false;
    } finally {
      context.connecting.value = false;
    }
  }

  async function disconnect() {
    await runMutation(context.lastError, async () => {
      await sdkDisconnect();
      context.connectionState.value = "disconnected";
      context.connectionMode.value = null;
      context.sessions.value = [];
      context.sessionStatesById.value = {};
      context.bridgeMetrics.value = null;
      context.deps.onDisconnect?.();
      context.activeSessions.value = 0;
    });
  }

  async function refreshStatus() {
    try {
      applyStatus(context, await sdkStatus());
    } catch (e) {
      logWarn("[sdk] Failed to refresh status", e);
    }
  }

  async function checkCliStatus() {
    try {
      applyStatus(context, await sdkCliStatus());
    } catch (e) {
      logWarn("[sdk] Failed to check CLI status", e);
    }
  }

  return {
    connect,
    disconnect,
    refreshStatus,
    checkCliStatus,
  };
}
