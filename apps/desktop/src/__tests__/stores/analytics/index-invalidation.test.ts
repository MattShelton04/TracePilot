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

describe("analytics cache invalidation on reindex", () => {
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
