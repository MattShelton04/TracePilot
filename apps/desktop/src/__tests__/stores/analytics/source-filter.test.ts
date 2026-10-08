// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it } from "vitest";
import { FIXTURE_ANALYTICS, FIXTURE_CODE_IMPACT, FIXTURE_TOOL_ANALYSIS, mocks } from "./setup";
import { useAnalyticsStore } from "../../../stores/analytics";

function resolveAll() {
  mocks.getAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
  mocks.getToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
  mocks.getCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
}

describe("analytics source filter", () => {
  it("sends no source while every source is selected", async () => {
    resolveAll();
    const store = useAnalyticsStore();

    await store.refreshAll();

    for (const fetcher of [mocks.getAnalytics, mocks.getToolAnalysis, mocks.getCodeImpact]) {
      expect(fetcher.mock.calls[0][0]).not.toHaveProperty("source", expect.anything());
    }
    expect(store.sourcePrefix).toBe("");
  });

  it("passes the selected source to every dataset", async () => {
    resolveAll();
    const store = useAnalyticsStore();

    store.setSource("claudeCode");
    await store.refreshAll();

    for (const fetcher of [mocks.getAnalytics, mocks.getToolAnalysis, mocks.getCodeImpact]) {
      expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ source: "claudeCode" }));
    }
    expect(store.sourcePrefix).toBe("Claude Code ");
  });

  it("caches each source separately", async () => {
    resolveAll();
    const store = useAnalyticsStore();

    await store.fetchAnalytics();
    store.setSource("copilot");
    await store.fetchAnalytics();
    store.setSource(null);
    await store.fetchAnalytics();

    expect(mocks.getAnalytics).toHaveBeenCalledTimes(2);
  });

  it("clears the source on reset", () => {
    const store = useAnalyticsStore();
    store.setSource("claudeCode");

    store.$reset();

    expect(store.selectedSource).toBeNull();
  });
});
