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

vi.mock("@tracepilot/client", () => ({
  IPC_EVENTS: {
    SDK_BRIDGE_EVENT: "sdk://event",
    SDK_CONNECTION_CHANGED: "sdk://status",
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
  useWindowRole: () => ({ isMain: () => true }),
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
  });

  it("does not register beforeunload disconnect lifecycle", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    useSdkStore();
    expect(addEventListener).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });
});
