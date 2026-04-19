/**
 * Behaviour tests for the alertWatcher Pinia store.
 *
 * The store is now SDK-event-driven — it tracks which bridge events have
 * already been seen per session so the composable can dedup alerts.
 * All file-system polling helpers (turn-count, error-baseline, running-state)
 * have been removed in favour of this narrower surface.
 */
import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { useAlertWatcherStore } from "../alertWatcher";

describe("useAlertWatcherStore", () => {
  beforeEach(() => {
    setupPinia();
  });

  // ── SDK event dedup ────────────────────────────────────────────

  describe("hasSeenSdkEvent / markSdkEventSeen", () => {
    it("returns false for an event that has not been seen", () => {
      const store = useAlertWatcherStore();
      expect(store.hasSeenSdkEvent("session-1", "evt-abc")).toBe(false);
    });

    it("returns true after marking an event as seen", () => {
      const store = useAlertWatcherStore();
      store.markSdkEventSeen("session-1", "evt-abc");
      expect(store.hasSeenSdkEvent("session-1", "evt-abc")).toBe(true);
    });

    it("deduplicates: a second mark does not break the check", () => {
      const store = useAlertWatcherStore();
      store.markSdkEventSeen("session-1", "evt-abc");
      store.markSdkEventSeen("session-1", "evt-abc");
      expect(store.hasSeenSdkEvent("session-1", "evt-abc")).toBe(true);
    });

    it("tracks events from different sessions independently", () => {
      const store = useAlertWatcherStore();
      store.markSdkEventSeen("session-1", "evt-1");
      expect(store.hasSeenSdkEvent("session-2", "evt-1")).toBe(false);
    });

    it("uses the composite sessionId:eventKey format (same key, different sessions = different entries)", () => {
      const store = useAlertWatcherStore();
      store.markSdkEventSeen("aaaa", "key");
      expect(store.hasSeenSdkEvent("aaaa", "key")).toBe(true);
      // Same key but different session — must not match.
      expect(store.hasSeenSdkEvent("bbbb", "key")).toBe(false);
    });

    it("fires an alert-like check exactly once per unique (session, key) pair", () => {
      const store = useAlertWatcherStore();
      const sessionId = "s1";
      const eventKey = "evt-idle";
      let dispatched = 0;

      const maybeDispatch = () => {
        if (store.hasSeenSdkEvent(sessionId, eventKey)) return;
        store.markSdkEventSeen(sessionId, eventKey);
        dispatched++;
      };

      maybeDispatch();
      maybeDispatch();
      maybeDispatch();

      expect(dispatched).toBe(1);
    });
  });

  // ── pruneSdkEvents ─────────────────────────────────────────────

  describe("pruneSdkEvents", () => {
    it("removes entries for sessions not in the active set", () => {
      const store = useAlertWatcherStore();
      store.markSdkEventSeen("live", "evt-1");
      store.markSdkEventSeen("live", "evt-2");
      store.markSdkEventSeen("gone", "evt-3");

      store.pruneSdkEvents(new Set(["live"]));

      expect(store.hasSeenSdkEvent("live", "evt-1")).toBe(true);
      expect(store.hasSeenSdkEvent("live", "evt-2")).toBe(true);
      expect(store.hasSeenSdkEvent("gone", "evt-3")).toBe(false);
    });

    it("keeps all entries when every session is still active", () => {
      const store = useAlertWatcherStore();
      store.markSdkEventSeen("s1", "e1");
      store.markSdkEventSeen("s2", "e2");

      store.pruneSdkEvents(new Set(["s1", "s2"]));

      expect(store.hasSeenSdkEvent("s1", "e1")).toBe(true);
      expect(store.hasSeenSdkEvent("s2", "e2")).toBe(true);
    });

    it("clears everything when the active set is empty", () => {
      const store = useAlertWatcherStore();
      store.markSdkEventSeen("s1", "e1");
      store.markSdkEventSeen("s2", "e2");

      store.pruneSdkEvents(new Set());

      expect(store.hasSeenSdkEvent("s1", "e1")).toBe(false);
      expect(store.hasSeenSdkEvent("s2", "e2")).toBe(false);
    });
  });

  // ── capturedRoute ──────────────────────────────────────────────

  describe("setCapturedRoute / capturedRoute", () => {
    it("starts as null", () => {
      const store = useAlertWatcherStore();
      expect(store.capturedRoute).toBeNull();
    });

    it("stores and exposes the route", () => {
      const store = useAlertWatcherStore();
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake route for test
      store.setCapturedRoute({ params: { id: "session-1" } } as any);
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake route for test
      expect((store.capturedRoute as any)?.params?.id).toBe("session-1");
    });
  });

  // ── $reset ─────────────────────────────────────────────────────

  describe("$reset", () => {
    it("clears all seen events and resets capturedRoute to null", () => {
      const store = useAlertWatcherStore();
      store.markSdkEventSeen("s1", "idle-1");
      store.markSdkEventSeen("s2", "error-1");
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake route for test
      store.setCapturedRoute({ params: { id: "s1" } } as any);

      store.$reset();

      expect(store.hasSeenSdkEvent("s1", "idle-1")).toBe(false);
      expect(store.hasSeenSdkEvent("s2", "error-1")).toBe(false);
      expect(store.capturedRoute).toBeNull();
    });

    it("allows new events to be tracked after reset", () => {
      const store = useAlertWatcherStore();
      store.markSdkEventSeen("s1", "e1");
      store.$reset();

      store.markSdkEventSeen("s1", "e2");
      expect(store.hasSeenSdkEvent("s1", "e1")).toBe(false);
      expect(store.hasSeenSdkEvent("s1", "e2")).toBe(true);
    });
  });
});
