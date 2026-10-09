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
    cacheWriteTokens: 0,
    percentage: 50,
    premiumRequests: 2,
    requestCount: 10,
    cacheHitRate: 16.67,
    cost: 0.05,
    copilotCost: 0.08,
    costUsd: null,
    costUsdPartial: false,
    source: "copilot",
    billedInAiCredits: true,
    usdEquivalent: 0.05,
    ...overrides,
    id: overrides.id ?? overrides.model ?? "gpt-4",
    label: overrides.label ?? overrides.model ?? "gpt-4",
    family: overrides.family ?? overrides.model ?? "gpt-4",
    aiCredits: overrides.aiCredits ?? 5,
    aiCreditSource: overrides.aiCreditSource ?? "observed",
  };
}

function makeCtxStub(overrides: Partial<ModelComparisonContext> = {}): ModelComparisonContext {
  const base = {
    store: { analyticsError: null, fetchAnalytics: vi.fn() },
    loading: false,
    data: { modelDistribution: [], modelUsageByDay: [] },
    pageSubtitle: "Performance and cost metrics across all models",
    modelRows: [] as ModelRow[],
    totalTokens: 0,
    totalCost: 0,
    totalAiCredits: 0,
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
    compareA: "",
    compareB: "",
    compareRowA: undefined,
    compareRowB: undefined,
    compareMetrics: [] as ModelComparisonContext["compareMetrics"],
    usdSource: null,
    totalCostUsd: null,
    ...overrides,
  };
  const rows = base.modelRows;
  return reactive({
    usdRows: rows.filter((row) => !row.billedInAiCredits),
    ...base,
  }) as unknown as ModelComparisonContext;
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
  it("renders an AIC-first table without legacy cost toggles", () => {
    const ctx = makeCtxStub({
      modelRows: [makeRow()],
      displayRows: [makeRow()],
    });
    const wrapper = mount(hostFor(ModelLeaderboard, ctx));
    expect(wrapper.findAll("tbody tr").length).toBe(1);
    expect(wrapper.text()).toContain("AI Credits");
    expect(wrapper.find(".cost-toggle").exists()).toBe(false);
  });

  it("invokes toggleSort when its header button is activated", async () => {
    const ctx = makeCtxStub({
      modelRows: [makeRow()],
      displayRows: [makeRow()],
    });
    const wrapper = mount(hostFor(ModelLeaderboard, ctx));
    await wrapper.get('button[aria-label="Sort by Model"]').trigger("click");
    expect(ctx.toggleSort).toHaveBeenCalledWith("model");
  });

  it("formats raw AI Credits with grouping separators", () => {
    const largeCredits = 111_123_141.341;
    const ctx = makeCtxStub({
      modelRows: [makeRow({ aiCredits: largeCredits })],
      displayRows: [makeRow({ aiCredits: largeCredits })],
    });

    const wrapper = mount(hostFor(ModelLeaderboard, ctx));

    expect(wrapper.find(".matrix-cost-value").text()).toBe("111,123,141 AIC");
  });

  it("heads the column Cost when a model is priced in USD", () => {
    const copilot = makeRow({ model: "gpt-5", aiCredits: 3 });
    const claude = makeRow({
      model: "claude-opus-5-5",
      aiCredits: null,
      billedInAiCredits: false,
      costUsd: 1064.3,
    });
    const ctx = makeCtxStub({ modelRows: [copilot, claude], displayRows: [copilot, claude] });
    const wrapper = mount(hostFor(ModelLeaderboard, ctx));
    const header = wrapper.get('button[aria-label="Sort by Cost"]');
    expect(header.element.closest("th")?.getAttribute("title")).toContain("estimated USD");
    // The narrow column drops the "est." suffix; the header carries it.
    expect(wrapper.findAll(".matrix-cost-value").map((cell) => cell.text())).toEqual([
      "3 AIC",
      "$1,064.30",
    ]);
  });
});

describe("ModelStatsGrid card cap", () => {
  const manyRows = (count: number) =>
    Array.from({ length: count }, (_, i) => makeRow({ model: `m${i}`, tokens: 1000 - i }));

  it("shows the eight most-used models until the user asks for all", async () => {
    const wrapper = mount(hostFor(ModelStatsGrid, makeCtxStub({ modelRows: manyRows(12) })));
    expect(wrapper.findAll(".model-card")).toHaveLength(8);
    const toggle = wrapper.find(".model-cards-more-btn");
    expect(toggle.text()).toBe("Show all 12 models");
    await toggle.trigger("click");
    expect(wrapper.findAll(".model-card")).toHaveLength(12);
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(toggle.text()).toBe("Show top 8");
  });

  it("shows a list only a few models longer in full", () => {
    const wrapper = mount(hostFor(ModelStatsGrid, makeCtxStub({ modelRows: manyRows(10) })));
    expect(wrapper.findAll(".model-card")).toHaveLength(10);
    expect(wrapper.find(".model-cards-more-btn").exists()).toBe(false);
  });
});

describe("ModelCharts", () => {
  it("shows placeholders when there is too little to compare", () => {
    const ctx = makeCtxStub({ modelRows: [makeRow()] });
    const wrapper = mount(hostFor(ModelCharts, ctx));
    expect(wrapper.text()).toContain("Needs at least 2 models with a cost to compare.");
    expect(wrapper.text()).toContain("Needs at least 2 models to compare profiles.");
  });

  it("draws one bubble per priced model and a profile card per model", () => {
    const rows = [
      makeRow({ model: "a", tokens: 3000, percentage: 75, usdEquivalent: 3 }),
      makeRow({ model: "b", tokens: 1000, percentage: 25, usdEquivalent: 2 }),
      makeRow({ model: "c", tokens: 10, percentage: 0.25, usdEquivalent: null }),
    ];
    const ctx = makeCtxStub({ modelRows: rows });
    const wrapper = mount(hostFor(ModelCharts, ctx));
    expect(wrapper.findAll('circle[data-reveal="pop"]')).toHaveLength(2);
    expect(wrapper.text()).toContain("No cost recorded: c.");
    expect(wrapper.findAll(".fingerprint-card")).toHaveLength(3);
  });

  it("switches the profiles panel to the overlay and trails views", async () => {
    const rows = [makeRow({ model: "a", tokens: 3000 }), makeRow({ model: "b", tokens: 1000 })];
    const wrapper = mount(hostFor(ModelCharts, makeCtxStub({ modelRows: rows })));
    const viewButton = (label: string) =>
      wrapper.findAll(".toggle-btn").find((b) => b.text() === label);
    await viewButton("Overlay")?.trigger("click");
    expect(wrapper.findAll(".fingerprint-option")).toHaveLength(2);
    await viewButton("Trails")?.trigger("click");
    expect(wrapper.find(".model-trails").exists()).toBe(true);
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
