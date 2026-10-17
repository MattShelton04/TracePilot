// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_ANALYTICS, mocks } from "./setup";
import { useAnalyticsStore } from "../../../stores/analytics";
import { dashboardDays } from "../../../utils/analyticsDashboard";

// Preset ranges ("Past 7 days", "This month") end on the current UTC day,
// which turns over while the app stays open.
describe("analytics preset ranges across UTC midnight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T23:58:00Z"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("moves with the UTC day, so Past 7 days stays seven days", () => {
    const store = useAnalyticsStore();
    store.setTimeRange("7d");
    expect(store.dateRange).toEqual({ fromDate: "2026-10-11" });

    vi.advanceTimersByTime(5 * 60_000); // 00:03 UTC on the 18th

    expect(store.dateRange).toEqual({ fromDate: "2026-10-12" });
    expect(dashboardDays(FIXTURE_ANALYTICS, store.dateRange)).toHaveLength(7);
  });

  it("starts a new month at the UTC month boundary", () => {
    vi.setSystemTime(new Date("2026-10-31T23:58:00Z"));
    const store = useAnalyticsStore();
    store.setTimeRange("month-to-date");
    expect(store.dateRange).toEqual({ fromDate: "2026-10-01" });

    vi.advanceTimersByTime(5 * 60_000);

    expect(store.dateRange).toEqual({ fromDate: "2026-11-01" });
  });

  it("catches up when the window regains focus after sleeping through midnight", () => {
    const store = useAnalyticsStore();
    store.setTimeRange("30d");
    expect(store.dateRange).toEqual({ fromDate: "2026-09-18" });

    // A suspended machine runs no timers; the clock jumps on resume.
    vi.setSystemTime(new Date("2026-10-19T08:00:00Z"));
    window.dispatchEvent(new Event("focus"));

    expect(store.dateRange).toEqual({ fromDate: "2026-09-20" });
  });

  it("prefetches the ranges the page asks for after midnight", async () => {
    vi.stubGlobal("requestIdleCallback", (cb: () => void) => queueMicrotask(cb));
    mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const store = useAnalyticsStore();
    store.setTimeRange("7d");
    // The page watches the range, so it was read before midnight.
    expect(store.dateRange).toEqual({ fromDate: "2026-10-11" });
    vi.advanceTimersByTime(5 * 60_000);

    await store.fetchAnalytics();
    await store.prefetchNearby(["analytics"]);

    const fromDates = mocks.getAnalytics.mock.calls.map(([params]) => params.fromDate);
    // The page's own 7-day range, then All, 30 and 90 days, all as of the 18th.
    expect(fromDates).toEqual(["2026-10-12", undefined, "2026-09-19", "2026-07-21"]);
  });
});
