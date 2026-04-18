import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type { BridgeStatus, DetectedUiServer } from "@tracepilot/types";

const defaultStatus: BridgeStatus = {
  state: "connected",
  sdkAvailable: true,
  cliVersion: "1.0.0",
  protocolVersion: 1,
  activeSessions: 0,
  error: null,
  connectionMode: "stdio",
} as unknown as BridgeStatus;

vi.mock("@tracepilot/client", () => ({
  sdkCliStatus: vi.fn(async () => defaultStatus),
  sdkConnect: vi.fn(async () => defaultStatus),
  sdkDetectUiServer: vi.fn(async () => [] as DetectedUiServer[]),
  sdkDisconnect: vi.fn(async () => {}),
  sdkGetAuthStatus: vi.fn(async () => null),
  sdkGetQuota: vi.fn(async () => null),
  sdkLaunchUiServer: vi.fn(async () => 42),
  sdkListModels: vi.fn(async () => []),
  sdkListSessions: vi.fn(async () => []),
  sdkStatus: vi.fn(async () => defaultStatus),
}));

import * as client from "@tracepilot/client";
import { createConnectionSlice } from "../connection";

function makeDeps() {
  const savedCliUrl = ref("");
  const savedLogLevel = ref("info");
  const updateSettings = vi.fn((u: string, l: string) => {
    savedCliUrl.value = u;
    savedLogLevel.value = l;
  });
  const onDisconnect = vi.fn();
  return { savedCliUrl, savedLogLevel, updateSettings, onDisconnect };
}

describe("createConnectionSlice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connect applies status and hydrates caches on success", async () => {
    const slice = createConnectionSlice(makeDeps());
    const ok = await slice.connect({});
    expect(ok).toBe(true);
    expect(slice.isConnected.value).toBe(true);
    expect(slice.cliVersion.value).toBe("1.0.0");
    expect(slice.isStdioMode.value).toBe(true);
    expect(slice.isTcpMode.value).toBe(false);
    expect(client.sdkListSessions).toHaveBeenCalled();
    expect(client.sdkListModels).toHaveBeenCalled();
  });

  it("connect sets lastError and error state when sdkConnect throws", async () => {
    (client.sdkConnect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("nope"));
    const slice = createConnectionSlice(makeDeps());
    const ok = await slice.connect({});
    expect(ok).toBe(false);
    expect(slice.connectionState.value).toBe("error");
    expect(slice.lastError.value).toBe("nope");
    expect(slice.connecting.value).toBe(false);
  });

  it("disconnect resets sessions/mode and fires onDisconnect hook atomically", async () => {
    const deps = makeDeps();
    const slice = createConnectionSlice(deps);
    slice.connectionState.value = "connected";
    slice.connectionMode.value = "tcp";
    slice.sessions.value = [{ sessionId: "s1", isActive: true }] as never;
    slice.activeSessions.value = 1;
    await slice.disconnect();
    expect(slice.connectionState.value).toBe("disconnected");
    expect(slice.connectionMode.value).toBeNull();
    expect(slice.sessions.value).toHaveLength(0);
    expect(slice.activeSessions.value).toBe(0);
    expect(deps.onDisconnect).toHaveBeenCalledOnce();
  });

  it("detectAndConnect returns false when no servers found", async () => {
    (client.sdkDetectUiServer as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const slice = createConnectionSlice(makeDeps());
    const ok = await slice.detectAndConnect();
    expect(ok).toBe(false);
    expect(slice.lastDetectMessage.value).toMatch(/No running Copilot servers/);
  });

  it("detectAndConnect picks the first detected server and stores its address via updateSettings", async () => {
    const servers = [{ address: "tcp://a:1" }, { address: "tcp://b:2" }] as DetectedUiServer[];
    (client.sdkDetectUiServer as ReturnType<typeof vi.fn>).mockResolvedValueOnce(servers);
    const deps = makeDeps();
    const slice = createConnectionSlice(deps);
    await slice.detectAndConnect();
    expect(deps.updateSettings).toHaveBeenCalledWith("tcp://a:1", "info");
    expect(client.sdkConnect).toHaveBeenCalledWith({ cliUrl: "tcp://a:1", logLevel: "info" });
  });

  it("applyStatus maps all BridgeStatus fields including connectionMode", () => {
    const slice = createConnectionSlice(makeDeps());
    slice.applyStatus({
      state: "connecting",
      sdkAvailable: false,
      cliVersion: "2.0.0",
      protocolVersion: 2,
      activeSessions: 3,
      error: "warn",
      connectionMode: "tcp",
    } as unknown as BridgeStatus);
    expect(slice.connectionState.value).toBe("connecting");
    expect(slice.sdkAvailable.value).toBe(false);
    expect(slice.cliVersion.value).toBe("2.0.0");
    expect(slice.protocolVersion.value).toBe(2);
    expect(slice.activeSessions.value).toBe(3);
    expect(slice.lastError.value).toBe("warn");
    expect(slice.connectionMode.value).toBe("tcp");
    expect(slice.isTcpMode.value).toBe(true);
  });
});
