// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import { FIXTURE_ANALYTICS, FIXTURE_CODE_IMPACT, FIXTURE_TOOL_ANALYSIS, mocks } from "./setup";
import { useAnalyticsStore } from "../../../stores/analytics";

describe("useAnalyticsStore", () => {
  // ── refreshAll ────────────────────────────────────────────
  describe("refreshAll", () => {
    it("fetches all three datasets in parallel", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      mocks.getToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      mocks.getCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.refreshAll();

      expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
      expect(store.toolAnalysis).toEqual(FIXTURE_TOOL_ANALYSIS);
      expect(store.codeImpact).toEqual(FIXTURE_CODE_IMPACT);
    });

    it("clears cache and re-fetches everything", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      mocks.getToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      mocks.getCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      await store.fetchToolAnalysis();
      await store.fetchCodeImpact();

      await store.refreshAll();

      expect(mocks.getAnalytics).toHaveBeenCalledTimes(2);
      expect(mocks.getToolAnalysis).toHaveBeenCalledTimes(2);
      expect(mocks.getCodeImpact).toHaveBeenCalledTimes(2);
    });

    it("handles partial failures", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      mocks.getToolAnalysis.mockRejectedValue(new Error("tool fail"));
      mocks.getCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.refreshAll();

      expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
      expect(store.toolAnalysisError).toBe("tool fail");
      expect(store.codeImpact).toEqual(FIXTURE_CODE_IMPACT);
    });

    it("passes date options through to all fetches", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      mocks.getToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      mocks.getCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.refreshAll({ fromDate: "2025-03-01", toDate: "2025-03-31" });

      const expected = { fromDate: "2025-03-01", toDate: "2025-03-31", hideEmpty: true };
      expect(mocks.getAnalytics).toHaveBeenCalledWith(expected);
      expect(mocks.getToolAnalysis).toHaveBeenCalledWith(expected);
      expect(mocks.getCodeImpact).toHaveBeenCalledWith(expected);
    });
  });

  // ── $reset ────────────────────────────────────────────────
  describe("$reset", () => {
    it("resets all state to initial values", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      mocks.getToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      mocks.getCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.refreshAll();
      expect(store.analytics).not.toBeNull();

      store.$reset();

      expect(store.analytics).toBeNull();
      expect(store.toolAnalysis).toBeNull();
      expect(store.codeImpact).toBeNull();
      expect(store.analyticsLoading).toBe(false);
      expect(store.toolAnalysisLoading).toBe(false);
      expect(store.codeImpactLoading).toBe(false);
      expect(store.analyticsError).toBeNull();
      expect(store.toolAnalysisError).toBeNull();
      expect(store.codeImpactError).toBeNull();
    });

    it("clears cache so next fetch re-requests data", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      store.$reset();
      await store.fetchAnalytics();

      expect(mocks.getAnalytics).toHaveBeenCalledTimes(2);
    });
  });

  // ── Independence ──────────────────────────────────────────
  describe("independence", () => {
    it("fetching one dataset does not affect others", async () => {
      mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();

      expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
      expect(store.toolAnalysis).toBeNull();
      expect(store.codeImpact).toBeNull();
      expect(store.toolAnalysisLoading).toBe(false);
      expect(store.codeImpactLoading).toBe(false);
    });

    it("error in one dataset does not affect others", async () => {
      mocks.getAnalytics.mockRejectedValue(new Error("analytics fail"));
      mocks.getToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      await store.fetchToolAnalysis();

      expect(store.analyticsError).toBe("analytics fail");
      expect(store.toolAnalysis).toEqual(FIXTURE_TOOL_ANALYSIS);
      expect(store.toolAnalysisError).toBeNull();
    });
  });
});
