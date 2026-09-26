import type { BridgeSessionInfo, LiveSessionHost } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const clientMocks = vi.hoisted(() => ({
  sdkLiveHosts: vi.fn(async (_ids: string[]): Promise<LiveSessionHost[]> => []),
  sdkAttachSession: vi.fn(
    async (sessionId: string): Promise<BridgeSessionInfo> => ({
      sessionId,
      model: null,
      workingDirectory: null,
      mode: null,
      isActive: true,
      resumeError: null,
      isRemote: true,
    }),
  ),
}));

vi.mock("@tracepilot/client", () => clientMocks);
vi.mock("@/utils/logger", () => ({ logInfo: vi.fn(), logWarn: vi.fn() }));

import { createLiveHostsSlice } from "../liveHosts";

function host(overrides: Partial<LiveSessionHost> = {}): LiveSessionHost {
  return {
    sessionId: "s1",
    state: "attachable",
    pid: 100,
    address: "127.0.0.1:5000",
    attached: false,
    ...overrides,
  };
}

function remoteSession(sessionId: string): BridgeSessionInfo {
  return {
    sessionId,
    model: null,
    workingDirectory: null,
    mode: null,
    isActive: true,
    resumeError: null,
    isRemote: true,
  };
}

function setup() {
  const sessions = ref<BridgeSessionInfo[]>([]);
  const lastError = ref<string | null>(null);
  const deps = {
    sessions,
    lastError,
    upsertSession: vi.fn((s: BridgeSessionInfo) => {
      sessions.value = [...sessions.value.filter((x) => x.sessionId !== s.sessionId), s];
    }),
    markSessionInactive: vi.fn((id: string) => {
      sessions.value = sessions.value.map((s) =>
        s.sessionId === id ? { ...s, isActive: false } : s,
      );
    }),
    clearLiveTurn: vi.fn(),
  };
  return { deps, slice: createLiveHostsSlice(deps) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createLiveHostsSlice", () => {
  it("skips the IPC call for an empty id list", async () => {
    const { slice } = setup();
    expect(await slice.refreshLiveHosts([])).toEqual([]);
    expect(clientMocks.sdkLiveHosts).not.toHaveBeenCalled();
  });

  it("stores hosting state by session id", async () => {
    clientMocks.sdkLiveHosts.mockResolvedValueOnce([
      host(),
      host({ sessionId: "s2", state: "running", address: null }),
    ]);
    const { slice } = setup();
    await slice.refreshLiveHosts(["s1", "s2"]);
    expect(slice.liveHostsById.value.s1.state).toBe("attachable");
    expect(slice.liveHostsById.value.s2.state).toBe("running");
  });

  it("marks a session inactive when the backend dropped its attachment", async () => {
    const { deps, slice } = setup();
    deps.sessions.value = [remoteSession("s1")];
    expect(slice.isAttached("s1")).toBe(true);
    clientMocks.sdkLiveHosts.mockResolvedValueOnce([
      host({ state: "idle", pid: null, address: null }),
    ]);
    await slice.refreshLiveHosts(["s1"]);
    expect(deps.markSessionInactive).toHaveBeenCalledWith("s1");
    expect(deps.clearLiveTurn).toHaveBeenCalledWith("s1");
    expect(slice.isAttached("s1")).toBe(false);
  });

  it("keeps an attachment the backend still reports", async () => {
    const { deps, slice } = setup();
    deps.sessions.value = [remoteSession("s1")];
    clientMocks.sdkLiveHosts.mockResolvedValueOnce([host({ attached: true })]);
    await slice.refreshLiveHosts(["s1"]);
    expect(deps.markSessionInactive).not.toHaveBeenCalled();
  });

  it("returns an empty list when the lookup fails", async () => {
    clientMocks.sdkLiveHosts.mockRejectedValueOnce(new Error("boom"));
    const { slice } = setup();
    expect(await slice.refreshLiveHosts(["s1"])).toEqual([]);
  });

  it("coalesces concurrent attaches and records the session", async () => {
    const { deps, slice } = setup();
    slice.liveHostsById.value = { s1: host() };
    const [a, b] = await Promise.all([slice.attachSession("s1"), slice.attachSession("s1")]);
    expect(a).toBe(b);
    expect(clientMocks.sdkAttachSession).toHaveBeenCalledTimes(1);
    expect(deps.upsertSession).toHaveBeenCalledTimes(1);
    expect(slice.liveHostsById.value.s1.attached).toBe(true);
    expect(slice.isAttached("s1")).toBe(true);
  });

  it("surfaces attach errors through lastError", async () => {
    clientMocks.sdkAttachSession.mockRejectedValueOnce(new Error("not attachable"));
    const { deps, slice } = setup();
    expect(await slice.attachSession("s1")).toBeNull();
    expect(deps.lastError.value).toContain("not attachable");
  });
});
