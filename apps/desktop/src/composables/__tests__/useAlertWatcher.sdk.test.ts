import { setupPinia } from "@tracepilot/test-utils";
import type { SessionLiveState } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAlertWatcherStore } from "@/stores/alertWatcher";

const mocks = vi.hoisted(() => ({
  dispatchAlert: vi.fn(),
  prefs: {
    alertsEnabled: true,
    alertsScope: "monitored" as "monitored" | "all",
    alertsOnAskUser: true,
    alertsOnSessionEnd: true,
    alertsOnSessionError: true,
  },
}));

vi.mock("@tracepilot/client", () => ({
  getSessionTurns: vi.fn(),
}));

vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepilot/ui")>();
  return {
    ...actual,
    useVisibilityGatedPoll: () => ({
      start: vi.fn(),
      stop: vi.fn(),
    }),
  };
});

vi.mock("@/composables/useAlertDispatcher", () => ({
  dispatchAlert: mocks.dispatchAlert,
}));

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => mocks.prefs,
}));

vi.mock("@/stores/sessionTabs", () => ({
  useSessionTabsStore: () => ({
    tabs: [],
    popupSessionIds: [],
  }),
}));

vi.mock("@/stores/sdk", () => ({
  useSdkStore: () => ({
    foregroundSessionId: null,
    sessionStatesById: {},
    bridgeMetrics: null,
  }),
}));

import { checkSdkBridgeMetricsAlerts, checkSdkSessionStateAlerts } from "../alertWatcherSdk";

function makeState(overrides: Partial<SessionLiveState> = {}): SessionLiveState {
  return {
    sessionId: "sdk-1",
    status: "running",
    currentTurnId: null,
    assistantText: "",
    reasoningText: "",
    tools: [],
    usage: null,
    pendingPermission: null,
    pendingUserInput: null,
    lastEventId: "evt-1",
    lastEventType: "session.running",
    lastEventTimestamp: "2026-04-27T00:00:00Z",
    lastError: null,
    reducerWarnings: [],
    ...overrides,
  };
}

describe("SDK alert watcher", () => {
  beforeEach(() => {
    setupPinia();
    mocks.dispatchAlert.mockReset();
    mocks.prefs.alertsEnabled = true;
    mocks.prefs.alertsScope = "monitored";
    mocks.prefs.alertsOnAskUser = true;
    mocks.prefs.alertsOnSessionEnd = true;
    mocks.prefs.alertsOnSessionError = true;
    useAlertWatcherStore().setCapturedRoute({ params: { id: "sdk-1" } } as never);
  });

  it("emits a user-input alert on waiting_for_input", () => {
    checkSdkSessionStateAlerts({
      "sdk-1": makeState({
        status: "waiting_for_input",
        pendingUserInput: {
          requestId: "input-1",
          kind: "ask_user",
          summary: "Need guidance",
          payload: { redacted: true },
          requestedAt: "2026-04-27T00:00:01Z",
        },
      }),
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sdk-user-input-required",
        sessionId: "sdk-1",
        metadata: expect.objectContaining({ requestId: "input-1", requestKind: "ask_user" }),
      }),
    );
  });

  it("emits a permission alert on waiting_for_permission", () => {
    checkSdkSessionStateAlerts({
      "sdk-1": makeState({
        status: "waiting_for_permission",
        pendingPermission: {
          requestId: "perm-1",
          kind: "tool_permission",
          summary: "Approve tool",
          payload: { toolName: "shell" },
          requestedAt: "2026-04-27T00:00:01Z",
        },
      }),
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sdk-permission-required",
        sessionId: "sdk-1",
        metadata: expect.objectContaining({
          requestId: "perm-1",
          requestKind: "tool_permission",
        }),
      }),
    );
  });

  it("emits an error alert on SDK error", () => {
    checkSdkSessionStateAlerts({
      "sdk-1": makeState({
        status: "error",
        lastError: "bridge failed",
        lastEventId: "err-1",
        lastEventType: "session.error",
      }),
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sdk-session-error",
        sessionId: "sdk-1",
        body: expect.stringContaining("bridge failed"),
      }),
    );
  });

  it("emits an idle alert only after a non-idle status was observed", () => {
    checkSdkSessionStateAlerts({
      "sdk-1": makeState({ status: "running", lastEventId: "run-1" }),
    });
    checkSdkSessionStateAlerts({
      "sdk-1": makeState({
        status: "idle",
        lastEventId: "idle-1",
        lastEventType: "session.idle",
      }),
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sdk-session-idle",
        sessionId: "sdk-1",
      }),
    );
  });

  it("emits an event-lag alert from bridge metrics", () => {
    checkSdkBridgeMetricsAlerts({
      eventsForwarded: 10,
      eventsDroppedDueToLag: 2,
      lagOccurrences: 1,
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sdk-event-lag",
        sessionId: "sdk-bridge",
        metadata: expect.objectContaining({ eventsDroppedDueToLag: 2, lagOccurrences: 1 }),
      }),
    );
  });

  it("dedupes the same request id or event id across repeated state updates", () => {
    const waiting = makeState({
      status: "waiting_for_input",
      pendingUserInput: {
        requestId: "input-1",
        kind: "ask_user",
        summary: null,
        payload: null,
        requestedAt: "2026-04-27T00:00:01Z",
      },
    });

    checkSdkSessionStateAlerts({ "sdk-1": waiting });
    checkSdkSessionStateAlerts({ "sdk-1": waiting });
    checkSdkSessionStateAlerts({ "sdk-1": waiting }, { baselineOnly: true });

    expect(mocks.dispatchAlert).toHaveBeenCalledTimes(1);
  });

  it("does not dedupe SDK request alerts while the matching preference is disabled", () => {
    const waiting = makeState({
      status: "waiting_for_input",
      pendingUserInput: {
        requestId: "input-disabled",
        kind: "ask_user",
        summary: null,
        payload: null,
        requestedAt: "2026-04-27T00:00:01Z",
      },
    });

    mocks.prefs.alertsOnAskUser = false;
    checkSdkSessionStateAlerts({ "sdk-1": waiting });
    mocks.prefs.alertsOnAskUser = true;
    checkSdkSessionStateAlerts({ "sdk-1": waiting });

    expect(mocks.dispatchAlert).toHaveBeenCalledTimes(1);
  });

  it("checks multiple SDK states independently when alert scope is all sessions", () => {
    mocks.prefs.alertsScope = "all";

    checkSdkSessionStateAlerts({
      "sdk-1": makeState({
        sessionId: "sdk-1",
        status: "waiting_for_input",
        pendingUserInput: {
          requestId: "input-1",
          kind: "ask_user",
          summary: null,
          payload: null,
          requestedAt: "2026-04-27T00:00:01Z",
        },
      }),
      "sdk-2": makeState({
        sessionId: "sdk-2",
        status: "waiting_for_permission",
        pendingPermission: {
          requestId: "perm-2",
          kind: "tool_permission",
          summary: null,
          payload: null,
          requestedAt: "2026-04-27T00:00:02Z",
        },
      }),
    });

    expect(mocks.dispatchAlert).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sdk-user-input-required", sessionId: "sdk-1" }),
    );
    expect(mocks.dispatchAlert).toHaveBeenCalledWith(
      expect.objectContaining({ type: "sdk-permission-required", sessionId: "sdk-2" }),
    );
    expect(mocks.dispatchAlert).toHaveBeenCalledTimes(2);
  });

  it("does not alert for unrelated non-monitored or unknown state", () => {
    checkSdkSessionStateAlerts({
      "sdk-2": makeState({
        sessionId: "sdk-2",
        status: "unknown",
        pendingUserInput: {
          requestId: "input-2",
          kind: "ask_user",
          summary: null,
          payload: null,
          requestedAt: "2026-04-27T00:00:01Z",
        },
      }),
    });

    expect(mocks.dispatchAlert).not.toHaveBeenCalled();
  });
});
