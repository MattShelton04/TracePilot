import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

// ── Mocks ──────────────────────────────────────────────────────────────
const prefsStoreMock = {
  computeWholesaleCost: vi.fn(
    (_model: string, input: number, _cacheRead: number, output: number) =>
      (input + output) * 0.00001,
  ),
  costPerPremiumRequest: 0.04,
};
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => prefsStoreMock,
}));

const analyticsStoreMock: {
  analytics: { modelDistribution: unknown[] } | null;
  analyticsLoading: boolean;
  analyticsError: string | null;
  selectedRepo: string | null;
  fetchAnalytics: ReturnType<typeof vi.fn>;
  fetchAvailableRepos: ReturnType<typeof vi.fn>;
} = {
  analytics: null,
  analyticsLoading: false,
  analyticsError: null,
  selectedRepo: null,
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
    premiumRequests: number;
  }>,
) {
  analyticsStoreMock.analytics = { modelDistribution: rows };
}

describe("useModelComparison", () => {
  beforeEach(() => {
    setupPinia();
    analyticsStoreMock.analytics = null;
    analyticsStoreMock.analyticsLoading = false;
    analyticsStoreMock.analyticsError = null;
    analyticsStoreMock.selectedRepo = null;
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
    expect(comp.compareA).toBe("x");
    expect(comp.compareB).toBe("y");
    expect(comp.compareMetrics.length).toBe(9);
    expect(comp.compareMetrics.map((m) => m.label)).toContain("Total Tokens");
    expect(comp.compareMetrics.map((m) => m.label)).toContain("Direct API Cost");
  });

  it("radar + scatter helpers produce valid coordinates", () => {
    seedDistribution([
      {
        model: "a",
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        premiumRequests: 2,
      },
      {
        model: "b",
        inputTokens: 2000,
        outputTokens: 500,
        cacheReadTokens: 500,
        premiumRequests: 3,
      },
    ]);
    const { comp } = mountHook();
    const vals = comp.radarValues(comp.modelRows[0]);
    expect(vals).toHaveLength(5);
    expect(vals.every((v) => v >= 0 && v <= 1)).toBe(true);
    const pt = comp.radarPoint(0, 1);
    expect(Number.isFinite(pt.x)).toBe(true);
    expect(Number.isFinite(pt.y)).toBe(true);
    const poly = comp.radarPolygon(vals);
    expect(poly.split(" ")).toHaveLength(5);
    const end = comp.radarAxisEnd(0);
    expect(end.y).toBeLessThan(130); // axis 0 points up
    const label = comp.radarLabelPos(0);
    expect(["start", "end", "middle"]).toContain(label.anchor);
    // scatter
    const x = comp.scatterX(comp.modelRows[0].tokens);
    const y = comp.scatterY(0);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    expect(comp.scatterRadius(50)).toBeGreaterThan(6);
  });

  it("pageSubtitle reflects selectedRepo", () => {
    analyticsStoreMock.selectedRepo = "foo/bar";
    const { comp } = mountHook();
    expect(comp.pageSubtitle).toContain("in foo/bar");
  });
});
