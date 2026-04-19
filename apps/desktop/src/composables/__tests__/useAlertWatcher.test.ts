/**
 * Integration tests for the useAlertWatcher composable.
 *
 * These tests drive the reactive watcher layer directly — the store is used
 * as-is (Pinia setup store), while the SDK store and dispatcher are mocked.
 * This gives us fast, reliable coverage of the critical paths that store-only
 * tests cannot reach:
 *
 *   - Seeding: pre-existing events must not produce alerts
 *   - Re-enable burst: disabling then re-enabling must not flood stale alerts
 *   - Reconnect regression: disconnect→$reset→reconnect must not re-alert
 *   - Ephemeral filtering: streaming fragments must be silently dropped
 *   - Scope filtering: "monitored" scope must suppress out-of-scope sessions
 *   - Null-ID uniqueness: two events with null id and same type/ts must each alert once
 *   - Cleanup: calling the returned cleanup function must stop the watcher
 */

import { setupPinia } from "@tracepilot/test-utils";
import { effectScope, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeEvent } from "@tracepilot/types";

// ─── Dispatcher mock ────────────────────────────────────────────
const dispatchAlertMock = vi.fn();
vi.mock("@/composables/useAlertDispatcher", () => ({
  dispatchAlert: (...args: unknown[]) => dispatchAlertMock(...args),
}));

// ─── Logger mock ────────────────────────────────────────────────
vi.mock("@/utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

// ─── SDK store mock ─────────────────────────────────────────────
// reactive() so Vue tracks property access inside watch() getters.
const sdkState = reactive({
  recentEvents: [] as BridgeEvent[],
  sessions: [] as Array<{ sessionId: string; workingDirectory?: string }>,
  connectionState: "connected" as "connected" | "disconnected",
});

vi.mock("@/stores/sdk", () => ({
  useSdkStore: () => sdkState,
}));

// ─── Preferences mock ───────────────────────────────────────────
const prefsState = reactive({
  alertsEnabled: true,
  alertsOnAskUser: true,
  alertsOnSessionError: true,
  alertsScope: "all" as "all" | "monitored",
});

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => prefsState,
}));

// ─── Sessions / tabs mocks (minimal) ────────────────────────────
const sessionsState = reactive({ sessions: [] as Array<{ id: string; summary?: string }> });
vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => sessionsState,
}));

const tabsState = reactive({ tabs: [] as Array<{ sessionId: string }>, popupSessionIds: [] as string[] });
vi.mock("@/stores/sessionTabs", () => ({
  useSessionTabsStore: () => tabsState,
}));

// ─── Fake router ────────────────────────────────────────────────
function makeRouter(sessionId?: string) {
  return {
    currentRoute: { value: { params: sessionId ? { id: sessionId } : {} } },
  };
}

// ─── Import under test (after mocks) ────────────────────────────
import { useAlertWatcher } from "../useAlertWatcher";

// ─── Event factory ──────────────────────────────────────────────
let _seq = 0;
function makeEvent(overrides: Partial<BridgeEvent> = {}): BridgeEvent {
  return {
    sessionId: "session-abc",
    eventType: "session.idle",
    timestamp: "2024-01-01T00:00:00Z",
    id: `evt-${++_seq}`,
    parentId: null,
    ephemeral: false,
    data: null,
    ...overrides,
  };
}

describe("useAlertWatcher", () => {
  beforeEach(() => {
    setupPinia();
    dispatchAlertMock.mockClear();
    _seq = 0;

    // Reset reactive state to defaults
    sdkState.recentEvents = [];
    sdkState.sessions = [];
    sdkState.connectionState = "connected";

    prefsState.alertsEnabled = true;
    prefsState.alertsOnAskUser = true;
    prefsState.alertsOnSessionError = true;
    prefsState.alertsScope = "all";

    sessionsState.sessions = [];
    tabsState.tabs = [];
    tabsState.popupSessionIds = [];
  });

  // ── Seeding ─────────────────────────────────────────────────────

  describe("seeding", () => {
    it("does not alert for events already buffered at init", async () => {
      const existing = makeEvent({ id: "existing-idle" });
      sdkState.recentEvents = [existing];

      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));
      await nextTick();

      // Simulate new event arriving (watcher fires)
      const newEvent = makeEvent({ id: "new-idle" });
      sdkState.recentEvents = [...sdkState.recentEvents, newEvent];
      await nextTick();

      // Only the new event should alert
      expect(dispatchAlertMock).toHaveBeenCalledTimes(1);
      expect(dispatchAlertMock).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-abc" }));

      scope.stop();
    });

    it("does not alert when the watcher fires with only pre-seeded events", async () => {
      const existing = makeEvent({ id: "pre-existing" });
      sdkState.recentEvents = [existing];

      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      // Force the watcher to fire by appending the same array (new reference)
      sdkState.recentEvents = [...sdkState.recentEvents];
      await nextTick();

      expect(dispatchAlertMock).not.toHaveBeenCalled();
      scope.stop();
    });
  });

  // ── Basic dispatch ───────────────────────────────────────────────

  describe("dispatch", () => {
    it("fires ask-user alert on session.idle", async () => {
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      sdkState.recentEvents = [makeEvent({ eventType: "session.idle" })];
      await nextTick();

      expect(dispatchAlertMock).toHaveBeenCalledOnce();
      expect(dispatchAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ask-user", title: "Agent Waiting" }),
      );
      scope.stop();
    });

    it("fires ask-user alert on userInput.request with question text", async () => {
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      sdkState.recentEvents = [
        makeEvent({
          eventType: "userInput.request",
          data: { invocationId: "1", question: "Allow file access?", choices: null, allowFreeform: true },
        }),
      ];
      await nextTick();

      expect(dispatchAlertMock).toHaveBeenCalledOnce();
      expect(dispatchAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ask-user", title: "Input Required", body: expect.stringContaining("Allow file access?") }),
      );
      scope.stop();
    });

    it("fires ask-user alert with fallback body when userInput.request has no question", async () => {
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      sdkState.recentEvents = [makeEvent({ eventType: "userInput.request", data: null })];
      await nextTick();

      expect(dispatchAlertMock).toHaveBeenCalledOnce();
      expect(dispatchAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ask-user", title: "Input Required", body: expect.stringContaining("Your response is needed") }),
      );
      scope.stop();
    });

    it("does not fire ask-user alert on userInput.request when alertsOnAskUser is disabled", async () => {
      prefsState.alertsOnAskUser = false;
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      sdkState.recentEvents = [makeEvent({ eventType: "userInput.request", data: { question: "Allow?" } })];
      await nextTick();

      expect(dispatchAlertMock).not.toHaveBeenCalled();
      scope.stop();
    });

    it("fires session-error alert on session.error", async () => {
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      sdkState.recentEvents = [makeEvent({ eventType: "session.error" })];
      await nextTick();

      expect(dispatchAlertMock).toHaveBeenCalledOnce();
      expect(dispatchAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "session-error", title: "Session Error" }),
      );
      scope.stop();
    });

    it("does not fire when alertsOnAskUser is disabled", async () => {
      prefsState.alertsOnAskUser = false;
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      sdkState.recentEvents = [makeEvent({ eventType: "session.idle" })];
      await nextTick();

      expect(dispatchAlertMock).not.toHaveBeenCalled();
      scope.stop();
    });

    it("does not fire when alertsOnSessionError is disabled", async () => {
      prefsState.alertsOnSessionError = false;
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      sdkState.recentEvents = [makeEvent({ eventType: "session.error" })];
      await nextTick();

      expect(dispatchAlertMock).not.toHaveBeenCalled();
      scope.stop();
    });

    it("deduplicates: same event ID fires only once across two watcher ticks", async () => {
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      const event = makeEvent();
      sdkState.recentEvents = [event];
      await nextTick();

      // Fire watcher again with the same event still in the buffer
      sdkState.recentEvents = [event, makeEvent({ id: "another" })];
      await nextTick();

      // First event should dispatch exactly once; second event dispatches once
      expect(dispatchAlertMock).toHaveBeenCalledTimes(2);
      scope.stop();
    });
  });

  // ── Re-enable burst prevention ───────────────────────────────────

  describe("re-enable burst prevention", () => {
    it("does not burst-alert on events that arrived while alerts were disabled", async () => {
      prefsState.alertsEnabled = false;
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      // Several events arrive while disabled
      sdkState.recentEvents = [
        makeEvent({ id: "e1" }),
        makeEvent({ id: "e2" }),
        makeEvent({ id: "e3" }),
      ];
      await nextTick();
      expect(dispatchAlertMock).not.toHaveBeenCalled();

      // Re-enable — subsequent new event should NOT carry over stale ones
      prefsState.alertsEnabled = true;
      const newEvent = makeEvent({ id: "e4" });
      sdkState.recentEvents = [...sdkState.recentEvents, newEvent];
      await nextTick();

      // Only the one new event should dispatch
      expect(dispatchAlertMock).toHaveBeenCalledTimes(1);
      scope.stop();
    });
  });

  // ── Reconnect regression ─────────────────────────────────────────

  describe("reconnect regression", () => {
    it("does not re-alert for pre-disconnect events after SDK reconnect", async () => {
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      // Events arrive and get dispatched
      sdkState.recentEvents = [makeEvent({ id: "pre-1" }), makeEvent({ id: "pre-2" })];
      await nextTick();
      expect(dispatchAlertMock).toHaveBeenCalledTimes(2);
      dispatchAlertMock.mockClear();

      // SDK disconnects — watcher resets dedup state but re-seeds the buffer
      sdkState.connectionState = "disconnected";
      await nextTick();

      // SDK reconnects and a single new event arrives
      sdkState.connectionState = "connected";
      const newEvent = makeEvent({ id: "post-reconnect" });
      sdkState.recentEvents = [...sdkState.recentEvents, newEvent];
      await nextTick();

      // Only the post-reconnect event should alert (pre-disconnect events re-seeded)
      expect(dispatchAlertMock).toHaveBeenCalledTimes(1);
      expect(dispatchAlertMock).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: newEvent.sessionId }),
      );
      scope.stop();
    });
  });

  // ── Ephemeral filtering ──────────────────────────────────────────

  describe("ephemeral events", () => {
    it("does not alert for ephemeral events", async () => {
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      sdkState.recentEvents = [makeEvent({ ephemeral: true, eventType: "session.idle" })];
      await nextTick();

      expect(dispatchAlertMock).not.toHaveBeenCalled();
      scope.stop();
    });
  });

  // ── Scope filtering ──────────────────────────────────────────────

  describe("scope filtering", () => {
    it("suppresses alerts for sessions not in tabs/route when scope is 'monitored'", async () => {
      prefsState.alertsScope = "monitored";
      tabsState.tabs = []; // session-abc is NOT monitored

      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      sdkState.recentEvents = [makeEvent({ sessionId: "session-abc" })];
      await nextTick();

      expect(dispatchAlertMock).not.toHaveBeenCalled();
      scope.stop();
    });

    it("allows alerts for sessions in tabs when scope is 'monitored'", async () => {
      prefsState.alertsScope = "monitored";
      tabsState.tabs = [{ sessionId: "session-abc" }];

      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      sdkState.recentEvents = [makeEvent({ sessionId: "session-abc" })];
      await nextTick();

      expect(dispatchAlertMock).toHaveBeenCalledOnce();
      scope.stop();
    });

    it("allows all sessions when scope is 'all'", async () => {
      prefsState.alertsScope = "all";
      tabsState.tabs = []; // not monitored, but scope is 'all'

      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      sdkState.recentEvents = [makeEvent({ sessionId: "some-other-session" })];
      await nextTick();

      expect(dispatchAlertMock).toHaveBeenCalledOnce();
      scope.stop();
    });
  });

  // ── Null-ID event uniqueness ─────────────────────────────────────

  describe("null-ID event key uniqueness", () => {
    it("treats two null-ID events with the same type and timestamp as distinct", async () => {
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      const ts = "2024-01-01T00:00:00Z";
      const a = makeEvent({ id: null, eventType: "session.idle", timestamp: ts });
      const b = makeEvent({ id: null, eventType: "session.idle", timestamp: ts });

      // Arrive in the same tick — both should alert
      sdkState.recentEvents = [a, b];
      await nextTick();

      expect(dispatchAlertMock).toHaveBeenCalledTimes(2);
      scope.stop();
    });

    it("does not re-alert for the same null-ID event object on repeated watcher ticks", async () => {
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));

      const event = makeEvent({ id: null });
      sdkState.recentEvents = [event];
      await nextTick();

      // Same object reference stays in buffer; watcher fires again with an addition
      sdkState.recentEvents = [event, makeEvent({ id: "different" })];
      await nextTick();

      // First event: 1 dispatch. Second event: 1 dispatch. Total: 2.
      expect(dispatchAlertMock).toHaveBeenCalledTimes(2);
      scope.stop();
    });
  });

  // ── Cleanup ──────────────────────────────────────────────────────

  describe("cleanup", () => {
    it("stops dispatching after cleanup() is called", async () => {
      let cleanup!: () => void;
      const scope = effectScope();
      scope.run(() => { cleanup = useAlertWatcher(makeRouter() as any); });

      cleanup();

      sdkState.recentEvents = [makeEvent()];
      await nextTick();

      expect(dispatchAlertMock).not.toHaveBeenCalled();
      scope.stop();
    });

    it("stops dispatching when the effect scope is stopped", async () => {
      const scope = effectScope();
      scope.run(() => useAlertWatcher(makeRouter() as any));
      scope.stop();

      sdkState.recentEvents = [makeEvent()];
      await nextTick();

      expect(dispatchAlertMock).not.toHaveBeenCalled();
    });
  });
});
