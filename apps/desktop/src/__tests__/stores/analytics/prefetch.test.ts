// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it, vi } from "vitest";
import { FIXTURE_ANALYTICS, mocks } from "./setup";

const listeners = vi.hoisted(() => new Map<string, () => void>());
vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn(async (event: string, handler: () => void) => {
    listeners.set(event, handler);
    return () => listeners.delete(event);
  }),
}));

import { IPC_EVENTS } from "@tracepilot/client";
import { useAnalyticsStore } from "../../../stores/analytics";

describe("analytics prefetching", () => {
  it("loads the other preset ranges without changing what is shown", async () => {
    mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const store = useAnalyticsStore();
    await store.fetchAnalytics();

    await store.prefetchNearby(["analytics"]);
    // 7d, 30d and 90d; "all" is the current range.
    expect(mocks.getAnalytics).toHaveBeenCalledTimes(4);
    expect(store.analyticsLoading).toBe(false);

    store.setTimeRange("30d");
    await store.fetchAnalytics();
    expect(mocks.getAnalytics).toHaveBeenCalledTimes(4);
  });

  it("stops when cancelled", async () => {
    mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const store = useAnalyticsStore();
    const run = store.prefetchNearby(["analytics"]);
    store.cancelPrefetch();
    await run;
    expect(mocks.getAnalytics).not.toHaveBeenCalled();
  });

  it("waits for no further idle slot once cancelled mid-request", async () => {
    let finish!: () => void;
    mocks.getAnalytics.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const store = useAnalyticsStore();
    const idle = vi.fn((cb: () => void) => setTimeout(cb, 0));
    vi.stubGlobal("requestIdleCallback", idle);
    try {
      const run = store.prefetchNearby(["analytics"]);
      await vi.waitFor(() => expect(mocks.getAnalytics).toHaveBeenCalledTimes(1));
      const waits = idle.mock.calls.length;
      store.cancelPrefetch();
      finish();
      await run;
      expect(idle).toHaveBeenCalledTimes(waits);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refreshes in place, reporting refreshing rather than loading", async () => {
    mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const store = useAnalyticsStore();
    await store.fetchAnalytics();

    store.setTimeRange("7d");
    const pending = store.fetchAnalytics({ background: true });
    expect(store.analyticsRefreshing).toBe(true);
    expect(store.analyticsLoading).toBe(false);
    expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
    await pending;
    expect(store.analyticsRefreshing).toBe(false);
  });

  it("warms the current view and re-warms it after a reindex", async () => {
    mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const store = useAnalyticsStore();

    await store.warm(["analytics"]);
    expect(mocks.getAnalytics).toHaveBeenCalledTimes(1);
    expect(store.analytics).toBeNull();

    await store.fetchAnalytics();
    expect(mocks.getAnalytics).toHaveBeenCalledTimes(1);
    expect(store.analytics).toEqual(FIXTURE_ANALYTICS);

    listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();
    await vi.waitFor(() => expect(mocks.getAnalytics).toHaveBeenCalledTimes(2));
  });
});
