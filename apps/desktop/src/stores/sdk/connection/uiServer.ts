import { sdkDetectUiServer, sdkLaunchUiServer, sdkStopUiServer } from "@tracepilot/client";
import type { DetectedUiServer } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { logInfo, logWarn } from "@/utils/logger";
import type { ConnectionContext } from "./context";

export interface UiServerLifecycleActions {
  connect: (config?: { cliUrl?: string; logLevel?: string }) => Promise<boolean>;
  disconnect: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

export function createUiServerActions(
  context: ConnectionContext,
  lifecycle: UiServerLifecycleActions,
) {
  async function detectUiServer(): Promise<DetectedUiServer[]> {
    context.detecting.value = true;
    context.lastDetectMessage.value = null;
    try {
      const servers = await sdkDetectUiServer();
      context.detectedServers.value = servers;
      if (servers.length === 0) {
        context.lastDetectMessage.value =
          "No running Copilot servers found. Launch one or start copilot --ui-server manually.";
      } else {
        context.lastDetectMessage.value = `Found ${servers.length} server${servers.length !== 1 ? "s" : ""}`;
      }
      logInfo(
        "[sdk] Detected UI servers:",
        servers.length,
        servers.map((s) => s.address),
      );
      return servers;
    } catch (e) {
      logWarn("[sdk] UI server detection failed:", e);
      context.detectedServers.value = [];
      context.lastDetectMessage.value = `Detection failed — ${toErrorMessage(e)}`;
      return [];
    } finally {
      context.detecting.value = false;
    }
  }

  async function detectAndConnect(): Promise<boolean> {
    if (context.connectionState.value === "connected") {
      await lifecycle.disconnect();
    }
    const servers = await detectUiServer();
    if (servers.length === 0) return false;
    const server = servers[0];
    logInfo("[sdk] Auto-connecting to detected UI server:", server.address);
    context.deps.updateSettings(server.address, context.deps.savedLogLevel.value);
    await lifecycle.connect({
      cliUrl: server.address,
      logLevel: context.deps.savedLogLevel.value || undefined,
    });
    return context.connectionState.value === "connected";
  }

  async function connectToServer(address: string): Promise<boolean> {
    if (context.connectionState.value === "connected") {
      await lifecycle.disconnect();
    }
    context.deps.updateSettings(address, context.deps.savedLogLevel.value);
    await lifecycle.connect({
      cliUrl: address,
      logLevel: context.deps.savedLogLevel.value || undefined,
    });
    return context.connectionState.value === "connected";
  }

  async function launchUiServer(workingDir?: string): Promise<number | null> {
    context.launching.value = true;
    try {
      const pid = await sdkLaunchUiServer(workingDir);
      logInfo("[sdk] Launched UI server, PID:", pid);
      setTimeout(async () => {
        await detectUiServer();
        context.launching.value = false;
      }, 3000);
      return pid;
    } catch (e) {
      context.lastError.value = toErrorMessage(e);
      logWarn("[sdk] Failed to launch UI server:", e);
      context.launching.value = false;
      return null;
    }
  }

  async function stopUiServer(pid: number): Promise<boolean> {
    context.stoppingServerPid.value = pid;
    try {
      await sdkStopUiServer(pid);
      context.detectedServers.value = context.detectedServers.value.filter(
        (server) => server.pid !== pid,
      );
      if (context.connectionState.value === "connected") {
        await lifecycle.refreshStatus();
      }
      return true;
    } catch (e) {
      context.lastError.value = toErrorMessage(e);
      logWarn("[sdk] Failed to stop UI server:", e);
      return false;
    } finally {
      context.stoppingServerPid.value = null;
      await detectUiServer();
    }
  }

  return {
    detectUiServer,
    detectAndConnect,
    connectToServer,
    launchUiServer,
    stopUiServer,
  };
}
