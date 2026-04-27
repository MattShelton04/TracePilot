/**
 * Behaviour tests for the SDK-only alert watcher store. The store owns compact
 * baseline/dedup state used by the SDK live-state watcher.
 */
import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { useAlertWatcherStore } from "../alertWatcher";

describe("useAlertWatcherStore", () => {
  beforeEach(() => {
    setupPinia();
  });

  describe("SDK live-state dedup", () => {
    it("fires SDK alerts exactly once for the same state key", () => {
      const store = useAlertWatcherStore();
      const stateKey = "sdk-session:sdk-user-input-required:req-1";

      let alerts = 0;
      const observeOnce = () => {
        if (store.hasAlertedSdkState(stateKey)) return;
        store.markSdkStateAlerted(stateKey);
        alerts++;
      };

      observeOnce();
      observeOnce();

      expect(alerts).toBe(1);
      expect(store.hasAlertedSdkState(stateKey)).toBe(true);
    });

    it("tracks last SDK status for transition checks", () => {
      const store = useAlertWatcherStore();
      expect(store.getLastSdkStatus("sdk-session")).toBeNull();
      store.setLastSdkStatus("sdk-session", "running");
      expect(store.getLastSdkStatus("sdk-session")).toBe("running");
    });

    it("prunes stale SDK state dedup entries", () => {
      const store = useAlertWatcherStore();
      store.setLastSdkStatus("live-sdk", "running");
      store.setLastSdkStatus("dead-sdk", "waiting_for_input");
      store.markSdkStateAlerted("live-sdk:sdk-user-input-required:req-1");
      store.markSdkStateAlerted("dead-sdk:sdk-user-input-required:req-2");
      store.markSdkStateAlerted("sdk-bridge:sdk-event-lag:1:1");

      store.pruneSdkEntries(new Set(["live-sdk"]));

      expect(store.getLastSdkStatus("live-sdk")).toBe("running");
      expect(store.getLastSdkStatus("dead-sdk")).toBeNull();
      expect(store.hasAlertedSdkState("live-sdk:sdk-user-input-required:req-1")).toBe(true);
      expect(store.hasAlertedSdkState("dead-sdk:sdk-user-input-required:req-2")).toBe(false);
      expect(store.hasAlertedSdkState("sdk-bridge:sdk-event-lag:1:1")).toBe(true);
    });
  });

  describe("$reset", () => {
    it("clears SDK dedup state and captured route", () => {
      const store = useAlertWatcherStore();
      store.markSdkStateAlerted("sdk-session:sdk-user-input-required:req-1");
      store.setLastSdkStatus("sdk-session", "running");
      store.setCapturedRoute({ params: { id: "sdk-session" } } as any);

      store.$reset();

      expect(store.hasAlertedSdkState("sdk-session:sdk-user-input-required:req-1")).toBe(false);
      expect(store.getLastSdkStatus("sdk-session")).toBeNull();
      expect(store.capturedRoute).toBeNull();
    });
  });
});
