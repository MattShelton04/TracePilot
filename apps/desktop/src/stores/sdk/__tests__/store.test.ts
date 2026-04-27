import type { BridgeStatus } from "@tracepilot/types";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connectedStatus: BridgeStatus = {
  state: "connected",
  sdkAvailable: true,
  enabledByPreference: true,
  cliVersion: null,
  protocolVersion: null,
  activeSessions: 1,
  error: null,
  connectionMode: "stdio",
};

const windowRoleMock = vi.hoisted(() => ({
  isMain: true,
}));

vi.mock("@tracepilot/client", () => ({
  IPC_EVENTS: {
    SDK_BRIDGE_EVENT: "sdk://event",
    SDK_CONNECTION_CHANGED: "sdk://status",
    SDK_SESSION_STATE_CHANGED: "sdk://session-state",
  },
  sdkConnect: vi.fn(async () => connectedStatus),
  sdkCliStatus: vi.fn(async () => connectedStatus),
  sdkCreateSession: vi.fn(async () => ({ sessionId: "new-1", isActive: true })),
  sdkDetectUiServer: vi.fn(async () => []),
  sdkDisconnect: vi.fn(async () => {}),
  sdkGetAuthStatus: vi.fn(async () => null),
  sdkGetForegroundSession: vi.fn(async () => null),
  sdkGetQuota: vi.fn(async () => null),
  sdkHydrate: vi.fn(async () => ({
    status: connectedStatus,
    sessions: [{ sessionId: "tracked-1", isActive: true }],
    metrics: { eventsForwarded: 0, eventsDroppedDueToLag: 0, lagOccurrences: 0 },
    sessionStates: [
      {
        sessionId: "tracked-1",
        status: "running",
        currentTurnId: null,
        assistantText: "hello",
        reasoningText: "",
        tools: [],
        usage: null,
        pendingPermission: null,
        pendingUserInput: null,
        lastEventId: "evt-1",
        lastEventType: "assistant.message_delta",
        lastEventTimestamp: "2026-04-27T00:00:00Z",
        lastError: null,
        reducerWarnings: [],
      },
    ],
    registrySessions: [],
    recovery: [],
  })),
  sdkLaunchUiServer: vi.fn(async () => 42),
  sdkListModels: vi.fn(async () => []),
  sdkListSessions: vi.fn(async () => []),
  sdkResumeSession: vi.fn(async (sessionId: string) => ({ sessionId, isActive: true })),
  sdkSendMessage: vi.fn(async () => "turn-1"),
  sdkSetForegroundSession: vi.fn(async () => {}),
  sdkSetSessionMode: vi.fn(async () => {}),
  sdkSetSessionModel: vi.fn(async () => {}),
  sdkStatus: vi.fn(async () => connectedStatus),
  sdkAbortSession: vi.fn(async () => {}),
  sdkDestroySession: vi.fn(async () => {}),
  sdkUnlinkSession: vi.fn(async () => {}),
}));

vi.mock("@/composables/useWindowRole", () => ({
  useWindowRole: () => ({ isMain: () => windowRoleMock.isMain }),
}));

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ isFeatureEnabled: () => true }),
}));

vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn(async () => () => {}),
}));

vi.mock("@/utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

import * as client from "@tracepilot/client";
import { useSdkStore } from "../../sdk";

describe("useSdkStore lifecycle hydration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    windowRoleMock.isMain = true;
    setActivePinia(createPinia());
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrates an existing backend connection on startup without reconnecting", async () => {
    const store = useSdkStore();
    await vi.runAllTimersAsync();
    expect(client.sdkHydrate).toHaveBeenCalled();
    expect(client.sdkConnect).not.toHaveBeenCalled();
    expect(store.connectionState).toBe("connected");
    expect(store.sessions).toEqual([{ sessionId: "tracked-1", isActive: true }]);
    expect(store.sessionStatesById["tracked-1"]?.assistantText).toBe("hello");
  });

  it("updates sessionStatesById from compact state-change events", async () => {
    const listeners = new Map<string, (event: { payload: unknown }) => void>();
    const tauriEvents = await import("@/utils/tauriEvents");
    (tauriEvents.safeListen as ReturnType<typeof vi.fn>).mockImplementation(
      async (name: string, handler: (event: { payload: unknown }) => void) => {
        listeners.set(name, handler);
        return () => {};
      },
    );

    const store = useSdkStore();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    listeners.get("sdk://session-state")?.({
      payload: {
        sessionId: "live-2",
        status: "idle",
        currentTurnId: "turn-2",
        assistantText: "done",
        reasoningText: "",
        tools: [],
        usage: null,
        pendingPermission: null,
        pendingUserInput: null,
        lastEventId: "evt-2",
        lastEventType: "session.idle",
        lastEventTimestamp: "2026-04-27T00:00:01Z",
        lastError: null,
        reducerWarnings: [],
      },
    });

    expect(store.sessionStatesById["live-2"]?.status).toBe("idle");
  });

  it("does not register beforeunload disconnect lifecycle", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    useSdkStore();
    expect(addEventListener).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("ignores explicit disconnect requests from non-main windows", async () => {
    windowRoleMock.isMain = false;
    const store = useSdkStore();
    await store.disconnect();
    expect(client.sdkDisconnect).not.toHaveBeenCalled();
  });
});
