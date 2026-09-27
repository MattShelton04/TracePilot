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
import { safeListen } from "@/utils/tauriEvents";
import { useAnalyticsStore } from "../../../stores/analytics";
import { createDeferred } from "@tracepilot/test-utils";

describe("analytics cache invalidation on reindex", () => {
  it("refetches after indexing instead of joining a pre-index request", async () => {
    const old = createDeferred<typeof FIXTURE_ANALYTICS>();
    mocks.getAnalytics.mockReturnValueOnce(old.promise).mockResolvedValueOnce(FIXTURE_ANALYTICS);
    const store = useAnalyticsStore();
    await store.watchIndexUpdates();
    const pending = store.fetchAnalytics();
    listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();
    await store.fetchAnalytics();
    expect(mocks.getAnalytics).toHaveBeenCalledTimes(2);
    old.resolve({ ...FIXTURE_ANALYTICS, totalSessions: 0 });
    await pending;
    expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
  });
  it("drops cached results and bumps dataRevision when indexing finishes", async () => {
    mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const store = useAnalyticsStore();
    await store.watchIndexUpdates();

    await store.fetchAnalytics();
    await store.fetchAnalytics();
    expect(mocks.getAnalytics).toHaveBeenCalledTimes(1);

    listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();
    expect(store.dataRevision).toBe(1);

    await store.fetchAnalytics();
    expect(mocks.getAnalytics).toHaveBeenCalledTimes(2);
  });

  it("registers the index listener only once", async () => {
    const store = useAnalyticsStore();
    vi.mocked(safeListen).mockClear();
    await store.watchIndexUpdates();
    await store.watchIndexUpdates();
    expect(safeListen).toHaveBeenCalledTimes(1);
  });
});
