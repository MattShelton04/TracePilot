import type { BridgeStatus, DetectedUiServer } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const defaultStatus: BridgeStatus = {
  state: "connected",
  sdkAvailable: true,
  enabledByPreference: true,
  cliVersion: "1.0.0",
  protocolVersion: 1,
  activeSessions: 0,
  error: null,
  connectionMode: "stdio",
};

vi.mock("@tracepilot/client", () => ({
  sdkCliStatus: vi.fn(async () => defaultStatus),
  sdkConnect: vi.fn(async () => defaultStatus),
  sdkDetectUiServer: vi.fn(async () => [] as DetectedUiServer[]),
  sdkDisconnect: vi.fn(async () => {}),
  sdkGetAuthStatus: vi.fn(async () => null),
  sdkGetQuota: vi.fn(async () => null),
  sdkHydrate: vi.fn(async () => ({
    status: defaultStatus,
    sessions: [],
    metrics: { eventsForwarded: 0, eventsDroppedDueToLag: 0, lagOccurrences: 0 },
    sessionStates: [],
    registrySessions: [],
    recovery: [],
  })),
  sdkLaunchUiServer: vi.fn(async () => 42),
  sdkListModels: vi.fn(async () => []),
  sdkListSessions: vi.fn(async () => []),
  sdkStatus: vi.fn(async () => defaultStatus),
  sdkStopUiServer: vi.fn(async () => {}),
}));

import * as client from "@tracepilot/client";
import { createConnectionSlice } from "../connection";
import { hydratedBridgeState } from "./connection.fixtures";

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

  it("connect treats DisabledByPreference as disconnected (not an error)", async () => {
    (client.sdkConnect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Copilot SDK bridge is disabled by user preference"),
    );
    const slice = createConnectionSlice(makeDeps());
    const ok = await slice.connect({});
    expect(ok).toBe(false);
    expect(slice.connectionState.value).toBe("disconnected");
    expect(slice.lastError.value).toBeNull();
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

  it("hydrate applies backend status and tracked sessions without connecting", async () => {
    (client.sdkHydrate as ReturnType<typeof vi.fn>).mockResolvedValueOnce(hydratedBridgeState);
    const slice = createConnectionSlice(makeDeps());
    const status = await slice.hydrate();
    expect(status?.state).toBe("connected");
    expect(slice.isConnected.value).toBe(true);
    expect(slice.sessions.value).toEqual([
      { sessionId: "tracked-1", isActive: true },
      { sessionId: "tracked-2", isActive: false },
    ]);
    expect(slice.activeSessions.value).toBe(1);
    expect(slice.sessionStatesById.value["tracked-1"]?.assistantText).toBe("ready");
    expect(slice.registrySessions.value).toHaveLength(1);
    expect(slice.recoveryDecisions.value[0]?.shouldAutoResume).toBe(false);
    expect(slice.bridgeMetrics.value?.eventsForwarded).toBe(2);
    expect(client.sdkConnect).not.toHaveBeenCalled();
  });

  it("applySessionState keeps simultaneous SDK sessions isolated", () => {
    const slice = createConnectionSlice(makeDeps());

    slice.applySessionState({
      sessionId: "sdk-A",
      status: "running",
      currentTurnId: "turn-A",
      assistantText: "alpha",
      reasoningText: "",
      tools: [],
      usage: null,
      pendingPermission: null,
      pendingUserInput: null,
      lastEventId: "evt-A1",
      lastEventType: "assistant.message_delta",
      lastEventTimestamp: "2026-04-27T00:00:00Z",
      lastError: null,
      reducerWarnings: [],
    });
    slice.applySessionState({
      sessionId: "sdk-B",
      status: "waiting_for_input",
      currentTurnId: "turn-B",
      assistantText: "bravo",
      reasoningText: "",
      tools: [],
      usage: null,
      pendingPermission: null,
      pendingUserInput: {
        requestId: "input-B",
        kind: "ask_user",
        summary: "Need input",
        payload: null,
        requestedAt: "2026-04-27T00:00:01Z",
      },
      lastEventId: "evt-B1",
      lastEventType: "ask_user.requested",
      lastEventTimestamp: "2026-04-27T00:00:01Z",
      lastError: null,
      reducerWarnings: [],
    });
    slice.applySessionState({
      sessionId: "sdk-A",
      status: "idle",
      currentTurnId: "turn-A",
      assistantText: "alpha done",
      reasoningText: "",
      tools: [],
      usage: null,
      pendingPermission: null,
      pendingUserInput: null,
      lastEventId: "evt-A2",
      lastEventType: "session.idle",
      lastEventTimestamp: "2026-04-27T00:00:02Z",
      lastError: null,
      reducerWarnings: [],
    });

    expect(slice.sessionStatesById.value["sdk-A"]?.status).toBe("idle");
    expect(slice.sessionStatesById.value["sdk-A"]?.assistantText).toBe("alpha done");
    expect(slice.sessionStatesById.value["sdk-B"]?.status).toBe("waiting_for_input");
    expect(slice.sessionStatesById.value["sdk-B"]?.assistantText).toBe("bravo");
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

  it("stopUiServer stops by PID and refreshes detected servers", async () => {
    (client.sdkDetectUiServer as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const slice = createConnectionSlice(makeDeps());
    const ok = await slice.stopUiServer(42);
    expect(ok).toBe(true);
    expect(client.sdkStopUiServer).toHaveBeenCalledWith(42);
    expect(slice.stoppingServerPid.value).toBeNull();
    expect(slice.detectedServers.value).toEqual([]);
  });

  it("applyStatus maps all BridgeStatus fields including connectionMode", () => {
    const slice = createConnectionSlice(makeDeps());
    slice.applyStatus({
      state: "connecting",
      sdkAvailable: false,
      enabledByPreference: true,
      cliVersion: "2.0.0",
      protocolVersion: 2,
      activeSessions: 3,
      error: "warn",
      connectionMode: "tcp",
    });
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
