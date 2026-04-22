import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, reactive } from "vue";
import {
  type ModelComparisonContext,
  ModelComparisonKey,
  type ModelRow,
} from "@/composables/useModelComparison";
import ModelCharts from "../ModelCharts.vue";
import ModelCompareTable from "../ModelCompareTable.vue";
import ModelLeaderboard from "../ModelLeaderboard.vue";
import ModelStatsGrid from "../ModelStatsGrid.vue";

// ── Mocks ──────────────────────────────────────────────────────────────
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({
    computeWholesaleCost: vi.fn(() => 0),
    costPerPremiumRequest: 0.04,
  }),
}));

function makeRow(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    model: "gpt-4",
    color: "#6366f1",
    tokens: 1000,
    inputTokens: 600,
    outputTokens: 400,
    cacheReadTokens: 100,
    percentage: 50,
    premiumRequests: 2,
    cacheHitRate: 16.67,
    cost: 0.05,
    copilotCost: 0.08,
    ...overrides,
  };
}

function makeCtxStub(overrides: Partial<ModelComparisonContext> = {}): ModelComparisonContext {
  const base = {
    store: { analyticsError: null, fetchAnalytics: vi.fn() },
    loading: false,
    data: { modelDistribution: [] },
    pageSubtitle: "Performance and cost metrics across all models",
    modelRows: [] as ModelRow[],
    totalTokens: 0,
    totalCost: 0,
    totalCopilotCost: 0,
    modelCount: 0,
    costMode: "both" as const,
    normMode: "raw" as const,
    bestCacheIdx: -1,
    bestCostIdx: -1,
    bestCopilotCostIdx: -1,
    sortKey: "tokens" as const,
    sortDir: "desc" as const,
    toggleSort: vi.fn(),
    sortArrow: vi.fn((_k: string) => "↓"),
    displayRows: [] as ModelRow[],
    fmtNorm: vi.fn((v: number | null, _isCost = false) => (v == null ? "—" : String(v))),
    radarModels: [] as ModelRow[],
    radarValues: vi.fn((_r: ModelRow) => [0.5, 0.5, 0.5, 0.5, 0.5]),
    radarPoint: vi.fn((_i: number, _v: number) => ({ x: 150, y: 130 })),
    radarPolygon: vi.fn((_vals: number[]) => "150,130 150,130 150,130 150,130 150,130"),
    radarAxisEnd: vi.fn((_i: number) => ({ x: 150, y: 40 })),
    radarLabelPos: vi.fn((_i: number) => ({ x: 150, y: 20, anchor: "middle" })),
    scatterScale: { maxT: 1000, maxC: 1 },
    scatterX: vi.fn((_t: number) => 100),
    scatterY: vi.fn((_c: number) => 100),
    scatterRadius: vi.fn((_c: number) => 8),
    compareA: "",
    compareB: "",
    compareRowA: undefined,
    compareRowB: undefined,
    compareMetrics: [] as ModelComparisonContext["compareMetrics"],
    ...overrides,
  };
  return reactive(base) as unknown as ModelComparisonContext;
}

function hostFor<C>(child: C, ctx: ModelComparisonContext) {
  return defineComponent({
    setup() {
      provide(ModelComparisonKey, ctx);
      return () => h(child as never);
    },
  });
}

describe("ModelStatsGrid", () => {
  it("renders stat cards and one card per model row", () => {
    const ctx = makeCtxStub({
      modelCount: 2,
      totalTokens: 2000,
      totalCost: 0.1,
      totalCopilotCost: 0.16,
      modelRows: [makeRow({ model: "gpt-4" }), makeRow({ model: "gpt-5" })],
    });
    const wrapper = mount(hostFor(ModelStatsGrid, ctx));
    expect(wrapper.text()).toContain("Models Used");
    expect(wrapper.text()).toContain("gpt-4");
    expect(wrapper.text()).toContain("gpt-5");
    expect(wrapper.findAll(".model-card").length).toBe(2);
  });
});

describe("ModelLeaderboard", () => {
  it("renders table rows and toggles costMode on click", async () => {
    const ctx = makeCtxStub({
      modelRows: [makeRow()],
      displayRows: [makeRow()],
    });
    const wrapper = mount(hostFor(ModelLeaderboard, ctx));
    expect(wrapper.findAll("tbody tr").length).toBe(1);
    const btns = wrapper.findAll(".cost-toggle .toggle-btn");
    await btns[0]!.trigger("click");
    expect(ctx.costMode).toBe("wholesale");
  });

  it("invokes toggleSort when sort header clicked", async () => {
    const ctx = makeCtxStub({
      modelRows: [makeRow()],
      displayRows: [makeRow()],
    });
    const wrapper = mount(hostFor(ModelLeaderboard, ctx));
    await wrapper.findAll(".sort-header")[0]!.trigger("click");
    expect(ctx.toggleSort).toHaveBeenCalledWith("model");
  });
});

describe("ModelCharts", () => {
  it("shows placeholder when fewer than 2 radar models", () => {
    const ctx = makeCtxStub({ radarModels: [makeRow()] });
    const wrapper = mount(hostFor(ModelCharts, ctx));
    expect(wrapper.text()).toContain("Need at least 2 models for radar comparison.");
  });

  it("renders radar + scatter svgs when data is sufficient", () => {
    const rows = [makeRow({ model: "a" }), makeRow({ model: "b" })];
    const ctx = makeCtxStub({ modelRows: rows, radarModels: rows });
    const wrapper = mount(hostFor(ModelCharts, ctx));
    expect(wrapper.findAll("svg.chart-svg").length).toBe(2);
  });
});

describe("ModelCompareTable", () => {
  it("shows placeholder when fewer than 2 model rows", () => {
    const ctx = makeCtxStub({ modelRows: [makeRow()] });
    const wrapper = mount(hostFor(ModelCompareTable, ctx));
    expect(wrapper.text()).toContain("Need at least 2 models for side-by-side comparison.");
  });

  it("renders compareMetrics rows when enough data is present", () => {
    const a = makeRow({ model: "a" });
    const b = makeRow({ model: "b" });
    const ctx = makeCtxStub({
      modelRows: [a, b],
      compareA: "a",
      compareB: "b",
      compareRowA: a,
      compareRowB: b,
      compareMetrics: [
        {
          label: "Total Tokens",
          valueA: "1000",
          valueB: "1000",
          delta: "0",
          direction: "neutral",
          better: "neutral",
        },
      ],
    });
    const wrapper = mount(hostFor(ModelCompareTable, ctx));
    expect(wrapper.findAll(".compare-table tbody tr").length).toBe(1);
    expect(wrapper.text()).toContain("Total Tokens");
  });

  it("toggles normMode via Share % button", async () => {
    const ctx = makeCtxStub({
      modelRows: [makeRow({ model: "a" }), makeRow({ model: "b" })],
    });
    const wrapper = mount(hostFor(ModelCompareTable, ctx));
    const btns = wrapper.findAll(".norm-toggle .toggle-btn");
    await btns[2]!.trigger("click");
    expect(ctx.normMode).toBe("share");
  });
});
