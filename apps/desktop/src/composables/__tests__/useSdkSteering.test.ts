import type { LiveSessionHost, SessionLiveState } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive, ref } from "vue";

// ─── Mocks ──────────────────────────────────────────────────────
const sdkMock = {
  isConnected: true,
  isConnecting: false,
  isTcpMode: false,
  connectionMode: "stdio" as const,
  connectionState: "connected" as const,
  sendingMessage: false,
  sendingByIds: new Set<string>(),
  isSending: vi.fn((_sid: string | null | undefined) => false),
  lastError: null as string | null,
  sessionStatesById: {} as Record<string, SessionLiveState>,
  sessions: [] as Array<{ sessionId: string; isActive: boolean; mode?: string; model?: string }>,
  models: [] as Array<{ id: string; name?: string }>,
  resumeSession: vi.fn(
    async (_sid: string, _cwd?: string, _model?: string) =>
      ({ sessionId: "resolved-123" }) as { sessionId: string } | null,
  ),
  sendMessage: vi.fn(async (_sid: string, _p: { prompt: string }) => "turn-1" as string | null),
  setSessionMode: vi.fn(async () => {}),
  abortSession: vi.fn(async () => {}),
  destroySession: vi.fn(async () => {}),
  connect: vi.fn(async () => {}),
  liveHostsById: {} as Record<string, LiveSessionHost>,
  refreshLiveHosts: vi.fn(async (_ids: string[]) => {}),
  attachSession: vi.fn(
    async (_sid: string) => ({ sessionId: "sess-A" }) as { sessionId: string } | null,
  ),
  unlinkSession: vi.fn(async (_sid: string) => {}),
};

vi.mock("@/stores/sdk", () => ({ useSdkStore: () => sdkMock }));

const prefsMock = {
  isFeatureEnabled: vi.fn((_: string) => true),
  liveAutoAttach: false,
};
vi.mock("@/stores/preferences", () => ({ usePreferencesStore: () => prefsMock }));

const detailMock = {
  turns: [] as Array<{ model?: string }>,
  refreshAll: vi.fn(async () => {}),
};
vi.mock("@/composables/useSessionDetailContext", () => ({
  useSessionDetailContext: () => detailMock,
}));

vi.mock("@/utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

// Import after mocks
import { LIVE_HOST_POLL_MS } from "../sdkSteering/liveHost";
import { SdkSteeringKey, useSdkSteering } from "../useSdkSteering";

function makeLiveState(
  sessionId: string,
  overrides: Partial<SessionLiveState> = {},
): SessionLiveState {
  return {
    sessionId,
    status: "running",
    currentTurnId: null,
    assistantText: "",
    reasoningText: "",
    tools: [],
    usage: null,
    pendingPermission: null,
    pendingUserInput: null,
    lastEventId: null,
    lastEventType: null,
    lastEventTimestamp: null,
    lastError: null,
    contextTokens: null,
    contextLimit: null,
    reducerWarnings: [],
    ...overrides,
  };
}

function mountHarness(
  sessionIdRef = ref<string | null>("sess-A"),
  sessionCwdRef = ref<string | undefined>(undefined),
  onMessageSent?: (t: string) => void,
) {
  const holder: { ctx: ReturnType<typeof useSdkSteering> | null } = { ctx: null };
  const Harness = defineComponent({
    setup() {
      const ctx = useSdkSteering({ sessionIdRef, sessionCwdRef, onMessageSent });
      holder.ctx = ctx;
      return () => h("div");
    },
  });
  const wrapper = mount(Harness);
  // Register provide so the key type is exercised.
  wrapper.vm.$options; // no-op reference
  void SdkSteeringKey;
  return {
    wrapper,
    sessionIdRef,
    sessionCwdRef,
    get ctx() {
      return holder.ctx!;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sdkMock.isConnected = true;
  sdkMock.isConnecting = false;
  sdkMock.isTcpMode = false;
  sdkMock.sendingMessage = false;
  sdkMock.isSending = vi.fn((_sid: string | null | undefined) => false);
  sdkMock.lastError = null;
  sdkMock.sessionStatesById = reactive<Record<string, SessionLiveState>>({});
  sdkMock.sessions = [];
  sdkMock.models = [];
  sdkMock.liveHostsById = reactive<Record<string, LiveSessionHost>>({});
  prefsMock.liveAutoAttach = false;
  detailMock.turns = [];
});

describe("useSdkSteering — linkSession (user-triggered resume)", () => {
  it("calls sdk.resumeSession and stores resolvedSessionId on success", async () => {
    const { ctx } = mountHarness();
    const ok = await ctx.linkSession();
    expect(ok).toBe(true);
    expect(sdkMock.resumeSession).toHaveBeenCalledWith("sess-A", undefined, undefined);
    expect(ctx.resolvedSessionId).toBe("resolved-123");
    expect(ctx.userLinked).toBe(true);
  });

  it("passes pendingModel through to resumeSession", async () => {
    const { ctx } = mountHarness();
    ctx.pendingModel = "gpt-4o";
    await ctx.linkSession();
    expect(sdkMock.resumeSession).toHaveBeenCalledWith("sess-A", undefined, "gpt-4o");
  });

  it("short-circuits when session already active (no resume call)", async () => {
    sdkMock.sessions = [{ sessionId: "sess-A", isActive: true }];
    const { ctx } = mountHarness();
    const ok = await ctx.linkSession();
    expect(ok).toBe(true);
    expect(sdkMock.resumeSession).not.toHaveBeenCalled();
    expect(ctx.resolvedSessionId).toBe("sess-A");
  });

  it("treats a bridge-tracked session as linked after navigation back", () => {
    sdkMock.sessions = [{ sessionId: "sess-A", isActive: true }];
    const { ctx } = mountHarness();
    expect(ctx.hasActiveSdkHandle).toBe(true);
    expect(ctx.isLinked).toBe(true);
    expect(sdkMock.resumeSession).not.toHaveBeenCalled();
  });

  it("surfaces friendly error when resume returns null", async () => {
    sdkMock.resumeSession.mockResolvedValueOnce(null);
    sdkMock.lastError = "Session file is corrupted at line 42";
    const { ctx } = mountHarness();
    const ok = await ctx.linkSession();
    expect(ok).toBe(false);
    expect(ctx.sessionError).toMatch(/Session schema mismatch/);
    expect(ctx.userLinked).toBe(false);
  });
});

describe("useSdkSteering — handleSend (user-triggered sendMessage)", () => {
  it("sends when linked and non-empty, clears prompt on success", async () => {
    sdkMock.sessions = [{ sessionId: "sess-A", isActive: true }];
    const onMessageSent = vi.fn();
    const { ctx } = mountHarness(ref("sess-A"), ref(undefined), onMessageSent);
    await ctx.linkSession();
    ctx.prompt = "please refactor";
    await ctx.handleSend();
    expect(sdkMock.sendMessage).toHaveBeenCalledWith("sess-A", { prompt: "please refactor" });
    expect(ctx.prompt).toBe("");
    expect(onMessageSent).toHaveBeenCalledWith("please refactor");
  });

  it("does NOT send when not linked", async () => {
    const { ctx } = mountHarness();
    ctx.prompt = "x";
    await ctx.handleSend();
    expect(sdkMock.sendMessage).not.toHaveBeenCalled();
  });

  it("records error status when sdk.sendMessage returns null with lastError", async () => {
    sdkMock.sessions = [{ sessionId: "sess-A", isActive: true }];
    const { ctx } = mountHarness();
    await ctx.linkSession();
    sdkMock.sendMessage.mockResolvedValueOnce(null);
    sdkMock.lastError = "not connected";
    ctx.prompt = "hi";
    await ctx.handleSend();
    expect(ctx.sentMessages[0]?.status).toBe("error");
    expect(ctx.sessionError).toMatch(/SDK is not connected/);
  });
});

describe("useSdkSteering — mode / abort / shutdown / connect", () => {
  it("handleModeChange forwards to sdk.setSessionMode when linked", async () => {
    sdkMock.sessions = [{ sessionId: "sess-A", isActive: true }];
    const { ctx } = mountHarness();
    await ctx.linkSession();
    await ctx.handleModeChange("plan");
    expect(sdkMock.setSessionMode).toHaveBeenCalledWith("sess-A", "plan");
  });

  it("handleModeChange renders -32601 unhandled-method error specifically", async () => {
    sdkMock.sessions = [{ sessionId: "sess-A", isActive: true }];
    const { ctx } = mountHarness();
    await ctx.linkSession();
    sdkMock.setSessionMode.mockImplementationOnce(async () => {
      sdkMock.lastError = "JSON-RPC error -32601 Unhandled method";
    });
    await ctx.handleModeChange("autopilot");
    expect(ctx.sessionError).toBe("Mode switching not supported by this CLI version.");
  });

  it("handleAbort forwards to sdk.abortSession when linked", async () => {
    sdkMock.sessions = [{ sessionId: "sess-A", isActive: true }];
    const { ctx } = mountHarness();
    await ctx.linkSession();
    await ctx.handleAbort();
    expect(sdkMock.abortSession).toHaveBeenCalledWith("sess-A");
  });

  it("handleShutdownSession calls destroySession and resets local state", async () => {
    sdkMock.sessions = [{ sessionId: "sess-A", isActive: true }];
    const { ctx } = mountHarness();
    await ctx.linkSession();
    await ctx.handleShutdownSession();
    expect(sdkMock.destroySession).toHaveBeenCalledWith("sess-A");
    expect(ctx.userLinked).toBe(false);
    expect(ctx.resolvedSessionId).toBeNull();
  });

  it("handleConnect forwards to sdk.connect", async () => {
    const { ctx } = mountHarness();
    await ctx.handleConnect();
    expect(sdkMock.connect).toHaveBeenCalledWith({});
  });
});

describe("useSdkSteering — sessionId watcher resets state (w1)", () => {
  it("switching sessionId clears userLinked / resolved / sent log / pending model / picker", async () => {
    const sid = ref<string | null>("sess-A");
    const { ctx } = mountHarness(sid);
    ctx.userLinked = true;
    ctx.userUnlinked = true;
    ctx.resolvedSessionId = "resolved-x";
    ctx.pendingModel = "gpt-4";
    ctx.showModelPicker = true;
    ctx.sentMessages = [{ id: 1, text: "x", timestamp: 0, status: "sent" }];
    sid.value = "sess-B";
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.userLinked).toBe(false);
    expect(ctx.userUnlinked).toBe(false);
    expect(ctx.resolvedSessionId).toBeNull();
    expect(ctx.pendingModel).toBeNull();
    expect(ctx.showModelPicker).toBe(false);
    expect(ctx.sentMessages.length).toBe(0);
  });
});

describe("useSdkSteering — unlink is pure state reset (no IPC)", () => {
  it("handleUnlinkSession does NOT call any IPC method", async () => {
    sdkMock.sessions = [{ sessionId: "sess-A", isActive: true }];
    const { ctx } = mountHarness();
    await ctx.linkSession();
    const before = {
      resume: sdkMock.resumeSession.mock.calls.length,
      destroy: sdkMock.destroySession.mock.calls.length,
      send: sdkMock.sendMessage.mock.calls.length,
    };
    ctx.handleUnlinkSession();
    expect(sdkMock.destroySession.mock.calls.length).toBe(before.destroy);
    expect(sdkMock.resumeSession.mock.calls.length).toBe(before.resume);
    expect(sdkMock.sendMessage.mock.calls.length).toBe(before.send);
    expect(ctx.userLinked).toBe(false);
    expect(ctx.userUnlinked).toBe(true);
    expect(ctx.isLinked).toBe(false);
  });
});

describe("useSdkSteering — live state selection", () => {
  it("exposes the compact live state for the current SDK session", () => {
    sdkMock.sessionStatesById["sess-A"] = makeLiveState("sess-A", {
      currentTurnId: "turn-live",
      assistantText: "live assistant delta",
      reasoningText: "live reasoning delta",
      lastEventId: "evt-live",
      lastEventType: "assistant.message_delta",
      lastEventTimestamp: "2026-04-27T00:00:00Z",
    });
    const { ctx } = mountHarness(ref("sess-A"));
    expect(ctx.liveState?.assistantText).toBe("live assistant delta");
    expect(ctx.liveState?.reasoningText).toBe("live reasoning delta");
  });

  it("keeps two steering panels bound to their own live states as each session changes", async () => {
    sdkMock.sessionStatesById["sess-A"] = makeLiveState("sess-A", {
      assistantText: "alpha",
    });
    sdkMock.sessionStatesById["sess-B"] = makeLiveState("sess-B", {
      assistantText: "bravo",
    });

    const panelA = mountHarness(ref("sess-A"));
    const panelB = mountHarness(ref("sess-B"));

    expect(panelA.ctx.liveState?.assistantText).toBe("alpha");
    expect(panelB.ctx.liveState?.assistantText).toBe("bravo");

    sdkMock.sessionStatesById["sess-A"] = makeLiveState("sess-A", {
      status: "idle",
      assistantText: "alpha done",
    });
    sdkMock.sessionStatesById["sess-B"] = makeLiveState("sess-B", {
      status: "waiting_for_permission",
      assistantText: "bravo waiting",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(panelA.ctx.liveState?.status).toBe("idle");
    expect(panelA.ctx.liveState?.assistantText).toBe("alpha done");
    expect(panelB.ctx.liveState?.status).toBe("waiting_for_permission");
    expect(panelB.ctx.liveState?.assistantText).toBe("bravo waiting");
  });
});

describe("useSdkSteering — live attach", () => {
  function attachableHost(sessionId = "sess-A"): LiveSessionHost {
    return { sessionId, state: "attachable", pid: 42, address: "127.0.0.1:5000", attached: false };
  }

  it("linkSession attaches to an attachable terminal instead of resuming", async () => {
    sdkMock.liveHostsById["sess-A"] = attachableHost();
    const { ctx } = mountHarness();
    const ok = await ctx.linkSession();
    expect(ok).toBe(true);
    expect(sdkMock.attachSession).toHaveBeenCalledWith("sess-A");
    expect(sdkMock.resumeSession).not.toHaveBeenCalled();
    expect(ctx.userLinked).toBe(true);
  });

  it("surfaces a friendly error when attach fails", async () => {
    sdkMock.liveHostsById["sess-A"] = attachableHost();
    sdkMock.attachSession.mockResolvedValueOnce(null);
    sdkMock.lastError = "host went away";
    const { ctx } = mountHarness();
    expect(await ctx.attachLive()).toBe(false);
    expect(ctx.sessionError).toBeTruthy();
    expect(ctx.attaching).toBe(false);
  });

  it("auto-attaches once when the preference is on", async () => {
    prefsMock.liveAutoAttach = true;
    sdkMock.refreshLiveHosts.mockImplementation(async () => {
      sdkMock.liveHostsById["sess-A"] = attachableHost();
    });
    const { wrapper } = mountHarness();
    await new Promise((r) => setTimeout(r, 0));
    expect(sdkMock.attachSession).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    sdkMock.refreshLiveHosts.mockImplementation(async () => {});
  });

  it("auto-attaches again only when a new terminal hosts the session", async () => {
    vi.useFakeTimers();
    prefsMock.liveAutoAttach = true;
    let host = attachableHost();
    sdkMock.attachSession.mockResolvedValueOnce(null).mockResolvedValueOnce(null); // attach fails
    sdkMock.refreshLiveHosts.mockImplementation(async () => {
      sdkMock.liveHostsById["sess-A"] = host;
    });
    const { wrapper } = mountHarness();
    await vi.advanceTimersByTimeAsync(LIVE_HOST_POLL_MS * 2);
    expect(sdkMock.attachSession).toHaveBeenCalledTimes(1);

    host = { ...attachableHost(), pid: 77, address: "127.0.0.1:6000" }; // terminal restarted
    await vi.advanceTimersByTimeAsync(LIVE_HOST_POLL_MS);
    expect(sdkMock.attachSession).toHaveBeenCalledTimes(2);

    wrapper.unmount();
    vi.useRealTimers();
    sdkMock.refreshLiveHosts.mockImplementation(async () => {});
  });

  it("does not auto-attach when the preference is off", async () => {
    sdkMock.refreshLiveHosts.mockImplementation(async () => {
      sdkMock.liveHostsById["sess-A"] = attachableHost();
    });
    const { wrapper } = mountHarness();
    await new Promise((r) => setTimeout(r, 0));
    expect(sdkMock.refreshLiveHosts).toHaveBeenCalledWith(["sess-A"]);
    expect(sdkMock.attachSession).not.toHaveBeenCalled();
    wrapper.unmount();
    sdkMock.refreshLiveHosts.mockImplementation(async () => {});
  });

  it("handleDetach unlinks, blocks auto-attach and re-checks the host", async () => {
    sdkMock.liveHostsById["sess-A"] = attachableHost();
    const { ctx } = mountHarness();
    await ctx.attachLive();
    await ctx.handleDetach();
    expect(sdkMock.unlinkSession).toHaveBeenCalledWith("sess-A");
    expect(ctx.userLinked).toBe(false);
    expect(ctx.userUnlinked).toBe(true);
    expect(sdkMock.refreshLiveHosts).toHaveBeenLastCalledWith(["sess-A"]);
  });
});

describe("useSdkSteering — inline errors for live sessions", () => {
  it("does not show main-bridge errors on a live attachment", async () => {
    sdkMock.liveHostsById["sess-A"] = {
      sessionId: "sess-A",
      state: "attachable",
      pid: 1,
      address: "127.0.0.1:5000",
      attached: true,
    };
    sdkMock.sessions = [{ sessionId: "sess-A", isActive: true, isRemote: true } as never];
    const { ctx } = mountHarness();
    await ctx.attachLive();
    sdkMock.lastError = "Connection failed: refused";
    expect(ctx.isLive).toBe(true);
    expect(ctx.inlineError).toBeNull();
  });

  it("still shows main-bridge errors when steering through the bridge", () => {
    sdkMock.lastError = "Connection failed: refused";
    const { ctx } = mountHarness();
    expect(ctx.inlineError).toBe("Connection failed: refused");
  });
});
