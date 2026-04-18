/**
 * Behaviour tests for the alertWatcher Pinia store. Focused on dedup /
 * baseline semantics — the composable wiring is covered indirectly here
 * via the store surface it drives.
 */
import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { useAlertWatcherStore } from "../alertWatcher";

describe("useAlertWatcherStore", () => {
  beforeEach(() => {
    setupPinia();
  });

  describe("running-state transitions", () => {
    it("returns false for unseen session ids", () => {
      const store = useAlertWatcherStore();
      expect(store.seenRunning("s1")).toBe(false);
    });

    it("records a running session and clears on unmark", () => {
      const store = useAlertWatcherStore();
      store.markRunning("s1");
      expect(store.seenRunning("s1")).toBe(true);
      store.unmarkRunning("s1");
      expect(store.seenRunning("s1")).toBe(false);
    });

    it("replaceRunning swaps the whole set atomically", () => {
      const store = useAlertWatcherStore();
      store.markRunning("a");
      store.markRunning("b");
      store.replaceRunning(["b", "c"]);
      expect(store.seenRunning("a")).toBe(false);
      expect(store.seenRunning("b")).toBe(true);
      expect(store.seenRunning("c")).toBe(true);
    });

    it("models a first-seen-running / running→stopped lifecycle", () => {
      const store = useAlertWatcherStore();

      // Cycle 1: session first observed running — no alert, just tracked.
      const sessionsCycle1 = [{ id: "s1", isRunning: true }];
      const alertsCycle1: string[] = [];
      for (const s of sessionsCycle1) {
        if (!s.isRunning && store.seenRunning(s.id)) alertsCycle1.push(s.id);
      }
      store.replaceRunning(sessionsCycle1.filter((s) => s.isRunning).map((s) => s.id));
      expect(alertsCycle1).toEqual([]);
      expect(store.seenRunning("s1")).toBe(true);

      // Cycle 2: session transitioned to stopped — alert fires once.
      const sessionsCycle2 = [{ id: "s1", isRunning: false }];
      const alertsCycle2: string[] = [];
      for (const s of sessionsCycle2) {
        if (!s.isRunning && store.seenRunning(s.id)) alertsCycle2.push(s.id);
      }
      store.replaceRunning(sessionsCycle2.filter((s) => s.isRunning).map((s) => s.id));
      expect(alertsCycle2).toEqual(["s1"]);

      // Cycle 3: still stopped — no re-alert because not previously running.
      const sessionsCycle3 = [{ id: "s1", isRunning: false }];
      const alertsCycle3: string[] = [];
      for (const s of sessionsCycle3) {
        if (!s.isRunning && store.seenRunning(s.id)) alertsCycle3.push(s.id);
      }
      store.replaceRunning(sessionsCycle3.filter((s) => s.isRunning).map((s) => s.id));
      expect(alertsCycle3).toEqual([]);
    });
  });

  describe("ask_user dedup", () => {
    it("reports unseen call ids as not yet alerted", () => {
      const store = useAlertWatcherStore();
      expect(store.hasAlertedAskUser("s1:call-1")).toBe(false);
    });

    it("fires an alert exactly once for the same call id", () => {
      const store = useAlertWatcherStore();
      const callKey = "s1:call-abc";

      let alerts = 0;
      const observeOnce = () => {
        if (store.hasAlertedAskUser(callKey)) return;
        store.markAskUserAlerted(callKey);
        alerts++;
      };

      observeOnce();
      observeOnce();
      observeOnce();

      expect(alerts).toBe(1);
      expect(store.hasAlertedAskUser(callKey)).toBe(true);
    });
  });

  describe("turn-count tracking", () => {
    it("returns 0 and false for unseen session ids", () => {
      const store = useAlertWatcherStore();
      expect(store.getLastTurnCount("s1")).toBe(0);
      expect(store.hasTurnCount("s1")).toBe(false);
    });

    it("records and updates last-seen turn counts", () => {
      const store = useAlertWatcherStore();
      store.setLastTurnCount("s1", 3);
      expect(store.hasTurnCount("s1")).toBe(true);
      expect(store.getLastTurnCount("s1")).toBe(3);
      store.setLastTurnCount("s1", 7);
      expect(store.getLastTurnCount("s1")).toBe(7);
    });
  });

  describe("error baseline skip-first", () => {
    it("returns false for unseen baseline and 0 for unseen error count", () => {
      const store = useAlertWatcherStore();
      expect(store.isErrorBaselineEstablished("s1")).toBe(false);
      expect(store.getLastErrorCount("s1")).toBe(0);
    });

    it("records initial baseline without alerting; subsequent increase alerts", () => {
      const store = useAlertWatcherStore();

      // Simulate the checkSessionErrorAlerts flow for a single session.
      const observe = (errorCount: number): "baselined" | "alerted" | "noop" => {
        if (!store.isErrorBaselineEstablished("s1")) {
          store.establishErrorBaseline("s1");
          store.setLastErrorCount("s1", errorCount);
          return "baselined";
        }
        const last = store.getLastErrorCount("s1");
        const result = errorCount > last ? "alerted" : "noop";
        store.setLastErrorCount("s1", errorCount);
        return result;
      };

      expect(observe(2)).toBe("baselined"); // first observation — no alert
      expect(observe(2)).toBe("noop"); // unchanged — no alert
      expect(observe(3)).toBe("alerted"); // increase — alert
      expect(observe(3)).toBe("noop"); // already alerted at this high-water mark
      expect(observe(5)).toBe("alerted"); // further increase — alert again
    });
  });

  describe("prune", () => {
    it("removes entries for sessions that are no longer running", () => {
      const store = useAlertWatcherStore();
      store.setLastTurnCount("live", 5);
      store.setLastTurnCount("dead", 9);
      store.establishErrorBaseline("live");
      store.establishErrorBaseline("dead");
      store.setLastErrorCount("live", 1);
      store.setLastErrorCount("dead", 4);
      store.markAskUserAlerted("live:call-1");
      store.markAskUserAlerted("dead:call-2");

      store.pruneStaleEntries(new Set(["live"]));

      expect(store.hasTurnCount("live")).toBe(true);
      expect(store.hasTurnCount("dead")).toBe(false);
      expect(store.isErrorBaselineEstablished("live")).toBe(true);
      expect(store.isErrorBaselineEstablished("dead")).toBe(false);
      expect(store.getLastErrorCount("dead")).toBe(0);
      expect(store.hasAlertedAskUser("live:call-1")).toBe(true);
      expect(store.hasAlertedAskUser("dead:call-2")).toBe(false);
    });
  });

  describe("$reset", () => {
    it("clears every Set/Map and resets flags + captured route", () => {
      const store = useAlertWatcherStore();
      store.markRunning("s1");
      store.setLastTurnCount("s1", 4);
      store.markAskUserAlerted("s1:call-x");
      store.establishErrorBaseline("s1");
      store.setLastErrorCount("s1", 2);
      store.askUserPollInFlight = true;
      store.seedInFlight = true;
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake route for test
      store.setCapturedRoute({ params: { id: "s1" } } as any);

      store.$reset();

      expect(store.seenRunning("s1")).toBe(false);
      expect(store.hasTurnCount("s1")).toBe(false);
      expect(store.hasAlertedAskUser("s1:call-x")).toBe(false);
      expect(store.isErrorBaselineEstablished("s1")).toBe(false);
      expect(store.getLastErrorCount("s1")).toBe(0);
      expect(store.askUserPollInFlight).toBe(false);
      expect(store.seedInFlight).toBe(false);
      expect(store.capturedRoute).toBeNull();
    });
  });
});
