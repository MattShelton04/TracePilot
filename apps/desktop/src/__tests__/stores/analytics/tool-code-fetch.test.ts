// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import { FIXTURE_CODE_IMPACT, FIXTURE_TOOL_ANALYSIS, mocks } from "./setup";
import { useAnalyticsStore } from "../../../stores/analytics";

describe("useAnalyticsStore", () => {
  // ── fetchToolAnalysis ─────────────────────────────────────
  describe("fetchToolAnalysis", () => {
    it("fetches and stores tool analysis data", async () => {
      mocks.getToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      const store = useAnalyticsStore();

      await store.fetchToolAnalysis();

      expect(store.toolAnalysis).toEqual(FIXTURE_TOOL_ANALYSIS);
      expect(store.toolAnalysisLoading).toBe(false);
      expect(store.toolAnalysisError).toBeNull();
    });

    it("handles errors", async () => {
      mocks.getToolAnalysis.mockRejectedValue(new Error("parse error"));
      const store = useAnalyticsStore();

      await store.fetchToolAnalysis();

      expect(store.toolAnalysis).toBeNull();
      expect(store.toolAnalysisError).toBe("parse error");
    });

    it("caches by date range", async () => {
      mocks.getToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      const store = useAnalyticsStore();

      await store.fetchToolAnalysis({ fromDate: "2025-01-01" });
      await store.fetchToolAnalysis({ fromDate: "2025-01-01" });

      expect(mocks.getToolAnalysis).toHaveBeenCalledTimes(1);
    });
  });

  // ── fetchCodeImpact ───────────────────────────────────────
  describe("fetchCodeImpact", () => {
    it("fetches and stores code impact data", async () => {
      mocks.getCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.fetchCodeImpact();

      expect(store.codeImpact).toEqual(FIXTURE_CODE_IMPACT);
      expect(store.codeImpactLoading).toBe(false);
      expect(store.codeImpactError).toBeNull();
    });

    it("handles errors", async () => {
      mocks.getCodeImpact.mockRejectedValue(new Error("disk error"));
      const store = useAnalyticsStore();

      await store.fetchCodeImpact();

      expect(store.codeImpact).toBeNull();
      expect(store.codeImpactError).toBe("disk error");
    });
  });
});
