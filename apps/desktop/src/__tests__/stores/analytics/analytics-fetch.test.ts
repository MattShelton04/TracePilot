// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import type { AnalyticsData } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { FIXTURE_ANALYTICS, mocks } from "./setup";
import { useAnalyticsStore } from "../../../stores/analytics";

describe("useAnalyticsStore", () => {
  describe("initial state", () => {
    it("initializes with null data and no errors", () => {
      const store = useAnalyticsStore();
      expect(store.analytics).toBeNull();
      expect(store.toolAnalysis).toBeNull();
      expect(store.codeImpact).toBeNull();
    });

    it("initializes with loading states false", () => {
      const store = useAnalyticsStore();
      expect(store.analyticsLoading).toBe(false);
      expect(store.toolAnalysisLoading).toBe(false);
      expect(store.codeImpactLoading).toBe(false);
    });

    it("initializes with no errors", () => {
      const store = useAnalyticsStore();
      expect(store.analyticsError).toBeNull();
      expect(store.toolAnalysisError).toBeNull();
      expect(store.codeImpactError).toBeNull();
    });
  });

  // ── fetchAnalytics ────────────────────────────────────────
  describe("fetchAnalytics", () => {
    it("fetches and stores analytics data", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();

      expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
      expect(store.analyticsLoading).toBe(false);
      expect(store.analyticsError).toBeNull();
    });

    it("sets loading state during fetch", async () => {
      let resolvePromise: ((value: AnalyticsData) => void) | undefined;
      mocks.getAnalytics.mockReturnValue(
        new Promise<AnalyticsData>((resolve) => {
          resolvePromise = resolve;
        }),
      );
      const store = useAnalyticsStore();

      const fetchPromise = store.fetchAnalytics({ force: true });
      expect(store.analyticsLoading).toBe(true);

      resolvePromise?.(FIXTURE_ANALYTICS);
      await fetchPromise;
      expect(store.analyticsLoading).toBe(false);
    });

    it("handles errors gracefully", async () => {
      mocks.getAnalytics.mockRejectedValue(new Error("Network error"));
      const store = useAnalyticsStore();

      await store.fetchAnalytics();

      expect(store.analytics).toBeNull();
      expect(store.analyticsError).toBe("Network error");
      expect(store.analyticsLoading).toBe(false);
    });

    it("handles non-Error rejection values", async () => {
      mocks.getAnalytics.mockRejectedValue("string error");
      const store = useAnalyticsStore();

      await store.fetchAnalytics();

      expect(store.analyticsError).toBe("string error");
    });

    it("passes date filters to client function", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics({ fromDate: "2025-01-01", toDate: "2025-01-31" });

      expect(mocks.getAnalytics).toHaveBeenCalledWith({
        fromDate: "2025-01-01",
        toDate: "2025-01-31",
        hideEmpty: true,
      });
    });

    it("skips fetch when already loaded (cache hit)", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      await store.fetchAnalytics(); // second call

      expect(mocks.getAnalytics).toHaveBeenCalledTimes(1);
    });

    it("re-fetches when forced", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      await store.fetchAnalytics({ force: true });

      expect(mocks.getAnalytics).toHaveBeenCalledTimes(2);
    });

    it("fetches again with different date range", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics({ fromDate: "2025-01-01" });
      await store.fetchAnalytics({ fromDate: "2025-02-01" });

      expect(mocks.getAnalytics).toHaveBeenCalledTimes(2);
    });

    it("clears previous error on retry", async () => {
      mocks.getAnalytics.mockRejectedValueOnce(new Error("fail"));
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      expect(store.analyticsError).toBe("fail");

      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      await store.fetchAnalytics({ force: true });
      expect(store.analyticsError).toBeNull();
      expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
    });
  });
});
