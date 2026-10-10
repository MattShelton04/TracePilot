import { setupPinia } from "@tracepilot/test-utils";
import { formatCost } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

// ── Mocks ──────────────────────────────────────────────────────────────
const prefsStoreMock = {
  computeWholesaleCost: vi.fn(
    (_model: string, input: number, _cacheRead: number, output: number, cacheWrite = 0) =>
      (input + output + cacheWrite) * 0.00001,
  ),
  computeUsageBasedCost: vi.fn(() => null),
  costPerPremiumRequest: 0.04,
};
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => prefsStoreMock,
}));

const analyticsStoreMock: {
  analytics: { modelDistribution: unknown[]; [key: string]: unknown } | null;
  analyticsLoading: boolean;
  analyticsError: string | null;
  selectedRepo: string | null;
  sourcePrefix: string;
  fetchAnalytics: ReturnType<typeof vi.fn>;
  fetchAvailableRepos: ReturnType<typeof vi.fn>;
} = {
  analytics: null,
  analyticsLoading: false,
  analyticsError: null,
  selectedRepo: null,
  sourcePrefix: "",
  fetchAnalytics: vi.fn(),
  fetchAvailableRepos: vi.fn(),
};

vi.mock("@/composables/useAnalyticsPage", () => ({
  useAnalyticsPage: () => ({ store: analyticsStoreMock }),
}));

// Import AFTER mocks
import { useModelComparison } from "../useModelComparison";

function mountHook() {
  const TestHost = defineComponent({
    setup() {
      const comp = useModelComparison();
      return { comp };
    },
    template: "<div />",
  });
  const wrapper = mount(TestHost);
  return { wrapper, comp: wrapper.vm.comp };
}

function seedDistribution(
  rows: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens?: number;
    premiumRequests: number;
    source?: string;
    costUsd?: number | null;
  }>,
) {
  analyticsStoreMock.analytics = {
    modelDistribution: rows.map((r) => ({ cacheWriteTokens: 0, ...r })),
  };
}

describe("useModelComparison", () => {
  beforeEach(() => {
    setupPinia();
    analyticsStoreMock.analytics = null;
    analyticsStoreMock.analyticsLoading = false;
    analyticsStoreMock.analyticsError = null;
    analyticsStoreMock.selectedRepo = null;
    analyticsStoreMock.sourcePrefix = "";
    analyticsStoreMock.fetchAnalytics = vi.fn();
    analyticsStoreMock.fetchAvailableRepos = vi.fn();
  });

  it("initializes with default state and empty rows", () => {
    const { comp } = mountHook();
    expect(comp.costMode).toBe("both");
    expect(comp.normMode).toBe("raw");
    expect(comp.sortKey).toBe("tokens");
    expect(comp.sortDir).toBe("desc");
    expect(comp.modelRows).toEqual([]);
    expect(comp.modelCount).toBe(0);
    expect(comp.pageSubtitle).toBe("Performance and cost metrics across all models");
  });

  it("builds modelRows with percentage, cacheHitRate, cost, copilotCost", () => {
    seedDistribution([
      {
        model: "gpt-4",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        premiumRequests: 2,
      },
      {
        model: "gpt-5",
        inputTokens: 3000,
        outputTokens: 500,
        cacheReadTokens: 300,
        premiumRequests: 5,
      },
    ]);
    const { comp } = mountHook();
    expect(comp.modelRows).toHaveLength(2);
    expect(comp.modelCount).toBe(2);
    expect(comp.totalTokens).toBe(5000);
    const gpt4 = comp.modelRows.find((r) => r.model === "gpt-4")!;
    // percentage: 1500 / 5000 = 30%
    expect(gpt4.percentage).toBeCloseTo(30);
    // cacheHitRate: 200/1000 = 20%
    expect(gpt4.cacheHitRate).toBeCloseTo(20);
    // copilotCost: 2 * 0.04
    expect(gpt4.copilotCost).toBeCloseTo(0.08);
  });

  it("leaves totalAiCredits empty, not zero, when no model is priced in AI Credits", () => {
    seedDistribution([
      {
        model: "claude-opus-5-5",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        premiumRequests: 0,
      },
    ]);
    const priced = prefsStoreMock.computeWholesaleCost.getMockImplementation();
    prefsStoreMock.computeWholesaleCost.mockImplementation(() => null as unknown as number);
    try {
      const { comp } = mountHook();
      expect(comp.modelRows[0].aiCredits).toBeNull();
      expect(comp.totalAiCredits).toBeNull();
    } finally {
      if (priced) prefsStoreMock.computeWholesaleCost.mockImplementation(priced);
    }
  });

  it("toggleSort flips direction on same key and resets on new key", () => {
    const { comp } = mountHook();
    expect(comp.sortKey).toBe("tokens");
    expect(comp.sortDir).toBe("desc");
    comp.toggleSort("tokens");
    expect(comp.sortDir).toBe("asc");
    comp.toggleSort("tokens");
    expect(comp.sortDir).toBe("desc");
    comp.toggleSort("model");
    expect(comp.sortKey).toBe("model");
    expect(comp.sortDir).toBe("asc"); // model defaults to asc
    comp.toggleSort("cost");
    expect(comp.sortKey).toBe("cost");
    expect(comp.sortDir).toBe("desc");
  });

  it("sortArrow reflects sort state", () => {
    const { comp } = mountHook();
    expect(comp.sortArrow("tokens")).toBe("↓");
    expect(comp.sortArrow("model")).toBe("⇅");
    comp.toggleSort("tokens");
    expect(comp.sortArrow("tokens")).toBe("↑");
  });

  it("displayRows switches between raw / per-10m-tokens / share", () => {
    seedDistribution([
      {
        model: "a",
        inputTokens: 5_000_000,
        outputTokens: 5_000_000,
        cacheReadTokens: 0,
        premiumRequests: 10,
      },
      {
        model: "b",
        inputTokens: 5_000_000,
        outputTokens: 5_000_000,
        cacheReadTokens: 0,
        premiumRequests: 10,
      },
    ]);
    const { comp } = mountHook();
    // raw: tokens = 10_000_000 for each
    expect(comp.displayRows[0].tokens).toBe(10_000_000);
    comp.normMode = "share";
    // share: each row should be 50%
    expect(comp.displayRows[0].tokens).toBeCloseTo(50);
    comp.normMode = "per-10m-tokens";
    // divisor = tokens/10M = 1 → values unchanged except for 1-to-1 normalization
    expect(comp.displayRows[0].tokens).toBeCloseTo(10_000_000);
  });

  it("fmtNorm formats value according to normMode", () => {
    const { comp } = mountHook();
    expect(comp.fmtNorm(null)).toBe("—");
    comp.normMode = "share";
    expect(comp.fmtNorm(25.5)).toBe("25.5%");
    comp.normMode = "per-10m-tokens";
    expect(comp.fmtNorm(10)).toBe("10");
    expect(comp.fmtNorm(10.5)).toBe("10.5");
  });

  it("watch seeds compareA/compareB once >= 2 rows exist", async () => {
    seedDistribution([
      { model: "x", inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, premiumRequests: 1 },
      { model: "y", inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, premiumRequests: 1 },
    ]);
    const { comp } = mountHook();
    expect(comp.compareA).toBe("copilot:x");
    expect(comp.compareB).toBe("copilot:y");
    expect(comp.compareMetrics.length).toBe(8);
    expect(comp.compareMetrics.map((m) => m.label)).toContain("Total Tokens");
    expect(comp.compareMetrics.map((m) => m.label)).toContain("AI Credits");
  });

  it("opens the comparison on one model used by two sources", async () => {
    const usage = { inputTokens: 100, outputTokens: 100, cacheReadTokens: 0, premiumRequests: 0 };
    seedDistribution([
      { model: "gpt-5", ...usage },
      { model: "claude-opus-4.6", ...usage },
      { model: "claude-opus-4-6", source: "claudeCode", costUsd: 1, ...usage },
    ]);
    const { comp } = mountHook();
    expect(comp.compareA).toBe("copilot:claude-opus-4.6");
    expect(comp.compareB).toBe("claudeCode:claude-opus-4-6");
    expect(comp.compareMetrics.find((m) => m.label === "Cost (USD)")?.valueB).toBe("$1.00");
  });

  it("colours models by token rank and gives the rest one neutral", () => {
    seedDistribution(
      Array.from({ length: 10 }, (_, i) => ({
        model: `m${i}`,
        inputTokens: 100 * (i + 1),
        outputTokens: 0,
        cacheReadTokens: 0,
        premiumRequests: 0,
      })),
    );
    const { comp } = mountHook();
    const byModel = new Map(comp.modelRows.map((row) => [row.model, row.color]));
    const named = [...byModel.values()].filter((color) => !color.startsWith("var("));
    // The eight most-used models get palette colours; the two least used share the tail.
    expect(named).toHaveLength(8);
    expect(byModel.get("m0")).toBe(byModel.get("m1"));
    expect(byModel.get("m0")).toMatch(/^var\(/);
  });

  it("pageSubtitle reflects selectedRepo", () => {
    analyticsStoreMock.selectedRepo = "foo/bar";
    const { comp } = mountHook();
    expect(comp.pageSubtitle).toContain("in foo/bar");
  });

  it("pageSubtitle names the selected source", () => {
    analyticsStoreMock.sourcePrefix = "Claude Code ";
    const { comp } = mountHook();
    expect(comp.pageSubtitle).toBe("Performance and cost metrics across all Claude Code models");
  });

  it("passes cacheWriteTokens through to computeWholesaleCost (regression)", () => {
    prefsStoreMock.computeWholesaleCost.mockClear();
    seedDistribution([
      {
        model: "claude-sonnet-4.6",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 300,
        premiumRequests: 1,
      },
    ]);
    const { comp } = mountHook();
    // Touch the computed so it evaluates.
    expect(comp.modelRows).toHaveLength(1);
    expect(prefsStoreMock.computeWholesaleCost).toHaveBeenCalledWith(
      "claude-sonnet-4.6",
      1000,
      200,
      500,
      300,
    );
    // Mock returns (input+output+cacheWrite) * 1e-5 = (1000+500+300)*1e-5 = 0.018
    expect(comp.modelRows[0].cost).toBeCloseTo(0.018);
  });

  it("shows the Analytics all-sources USD total, not the sum of per-model figures", () => {
    // Per-model Claude Code costs add up to a fraction of a cent less than
    // the session totals Analytics adds: $2,130.2751 against $2,130.2849.
    const copilotNanoAiu = 851_135_490_000_000; // 851,135.49 AIC = $8,511.3549
    const uncovered = {
      unobservedInputTokens: 0,
      unobservedOutputTokens: 0,
      unobservedCacheReadTokens: 0,
      unobservedCacheWriteTokens: 0,
    };
    analyticsStoreMock.analytics = {
      modelDistribution: [
        {
          model: "gpt-5",
          source: "copilot",
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          premiumRequests: 0,
          totalNanoAiu: copilotNanoAiu,
          ...uncovered,
        },
        ...[1000.1, 1130.1751].map((costUsd, i) => ({
          model: `claude-opus-5-${i}`,
          source: "claudeCode",
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          premiumRequests: 0,
          costUsd,
        })),
      ],
      totalNanoAiu: copilotNanoAiu,
      sessionsWithObservedAiCredits: 1,
      costBySource: [
        { source: "copilot", sessions: 1, tokens: 1100, costUsd: null, sessionsWithCostUsd: 0 },
        {
          source: "claudeCode",
          sessions: 2,
          tokens: 2200,
          costUsd: 2130.2849,
          sessionsWithCostUsd: 2,
        },
      ],
    };
    const { comp } = mountHook();
    expect(comp.mixedUnits).toBe(true);
    // Rows alone would read $10,641.63.
    const rowSum = comp.modelRows.reduce((sum, row) => sum + (row.usdEquivalent ?? 0), 0);
    expect(formatCost(rowSum)).toBe("$10,641.63");
    expect(formatCost(comp.totalUsd)).toBe("$10,641.64");
  });
});
