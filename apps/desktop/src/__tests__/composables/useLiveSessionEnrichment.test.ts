import { refreshSessionEnrichment } from "@tracepilot/client";
import { setupPinia } from "@tracepilot/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_ENRICHMENT_INTERVAL_MS,
  useLiveSessionEnrichment,
} from "@/composables/useLiveSessionEnrichment";
import { usePreferencesStore } from "@/stores/preferences";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({ refreshSessionEnrichment: vi.fn() });
});

const refresh = vi.mocked(refreshSessionEnrichment);
const ok = { availability: "ready" as const, refreshed: 0, unchanged: 1, skipped: 0, detail: null };

beforeEach(() => {
  setupPinia();
  vi.useFakeTimers();
  refresh.mockReset();
  refresh.mockResolvedValue(ok);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLiveSessionEnrichment", () => {
  it("refreshes only the open session, spaced by the interval", async () => {
    const live = useLiveSessionEnrichment();

    await live.nudge("s1");
    await live.nudge("s1");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith("s1");

    vi.advanceTimersByTime(LIVE_ENRICHMENT_INTERVAL_MS);
    await live.nudge("s1");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("retries on the next tick when the indexing gate was busy", async () => {
    refresh.mockRejectedValueOnce({ code: "ALREADY_INDEXING", message: "busy" });
    const live = useLiveSessionEnrichment();

    await live.nudge("s1");
    await live.nudge("s1");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does nothing while the feature is off", async () => {
    const prefs = usePreferencesStore();
    vi.spyOn(prefs, "isFeatureEnabled").mockReturnValue(false);
    await useLiveSessionEnrichment().nudge("s1");
    expect(refresh).not.toHaveBeenCalled();
  });
});
