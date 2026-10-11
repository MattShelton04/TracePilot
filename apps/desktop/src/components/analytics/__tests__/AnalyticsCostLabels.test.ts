import { setupPinia } from "@tracepilot/test-utils";
import type { AnalyticsData, SourceCostEntry } from "@tracepilot/types";
import { KPI } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAnalyticsDashboardViews } from "@/composables/useAnalyticsDashboardViews";
import { activityRows, dashboardDays } from "@/utils/analyticsDashboard";
import { buildDashboardSummary, type Pricing } from "@/utils/analyticsSummary";
import { FIXTURE_ANALYTICS } from "../../../__tests__/views/analyticsFixtures";
import AnalyticsCostPanel from "../AnalyticsCostPanel.vue";
import AnalyticsKpis from "../AnalyticsKpis.vue";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  setupPinia();
  localStorage.clear();
  resetAnalyticsDashboardViews();
});

/** No model can be priced: AI Credits come only from observed billing. */
const unpriced: Pricing = { computeUsageBasedCost: () => null, computeWholesaleCost: () => null };

const copilotEntry: SourceCostEntry = {
  source: "copilot",
  sessions: 4,
  tokens: 2_000,
  costUsd: null,
  sessionsWithCostUsd: 0,
};
const claudeEntry: SourceCostEntry = {
  source: "claudeCode",
  sessions: 3,
  tokens: 1_000,
  costUsd: 1.25,
  sessionsWithCostUsd: 2,
};

function withSources(costBySource: SourceCostEntry[], extra: Partial<AnalyticsData> = {}) {
  return { ...FIXTURE_ANALYTICS, costBySource, ...extra };
}

function costKpi(data: AnalyticsData, pricing = unpriced) {
  const summary = buildDashboardSummary(data, pricing);
  const rows = activityRows({
    data,
    days: dashboardDays(data, {}),
    metric: "runs",
    aiCreditsByDay: summary.aiCreditsByDay,
    label: (s) => s,
  }).rows;
  const wrapper = mount(AnalyticsKpis, { props: { data, summary, rows } });
  const kpi = wrapper.findAllComponents(KPI)[2];
  return {
    label: kpi.props("label"),
    value: kpi.props("value"),
    tooltip: kpi.props("description"),
    text: kpi.text(),
  };
}

describe("analytics cost labels", () => {
  it("shows an unavailable AI Credit total as a dash, not $0.00", () => {
    const kpi = costKpi(
      withSources([copilotEntry], {
        totalNanoAiu: 0,
        sessionsWithObservedAiCredits: 0,
        modelDistribution: FIXTURE_ANALYTICS.modelDistribution.map((m) => ({
          ...m,
          totalNanoAiu: null,
        })),
      }),
    );
    expect(kpi.label).toBe("AI Credits");
    expect(kpi.value).toBe("—");
    expect(kpi.text).not.toContain("$0.00");
  });

  it("reads Copilot alone in AI Credits with the dollar value beside", () => {
    const kpi = costKpi(withSources([copilotEntry], { sessionsWithObservedAiCredits: 3 }));
    expect(kpi.label).toBe("AI Credits");
    expect(kpi.value).toBe("160");
    expect(kpi.text).toContain("$1.60");
    expect(kpi.text).toContain("3 of 4 observed");
  });

  it("shows a USD-priced source's estimate, not AI Credits", () => {
    const kpi = costKpi(withSources([claudeEntry]));
    expect(kpi.label).toBe("Estimated cost");
    expect(kpi.value).toBe("$1.25");
    expect(kpi.text).toContain("2 of 3 priced");
    expect(kpi.text).toContain("partial");
    expect(kpi.text).not.toContain("AI Credits");
  });

  it("adds every source into one USD total when sources are mixed", () => {
    const kpi = costKpi(withSources([copilotEntry, claudeEntry], { totalNanoAiu: 12_500_000_000 }));
    expect(kpi.label).toBe("Cost");
    expect(kpi.value).toBe("$1.38");
    expect(kpi.tooltip).toContain("Copilot $0.13 + Claude Code $1.25");
    expect(kpi.tooltip).toContain("$0.01 each");
    expect(kpi.tooltip).toContain("Partial");
    expect(kpi.text).toContain("Copilot $0.13 · Claude Code $1.25");
  });
});

describe("analytics cost panel", () => {
  function panel(data: AnalyticsData) {
    const summary = buildDashboardSummary(data, unpriced);
    return mount(AnalyticsCostPanel, {
      props: {
        data,
        summary,
        days: dashboardDays(data, {}),
        rangeText: "any session",
        costPerPremiumRequest: 0.04,
      },
    });
  }

  it("gives each source a card in its own unit, and a USD total", () => {
    const wrapper = panel(
      withSources([copilotEntry, claudeEntry], { totalNanoAiu: 12_500_000_000 }),
    );
    const copilot = wrapper.get('[data-source="copilot"]').text();
    const claude = wrapper.get('[data-source="claudeCode"]').text();
    const total = wrapper.get('[data-source="total"]').text();
    expect(copilot).toContain("12.5 AIC");
    expect(copilot).toContain("$0.13");
    expect(claude).toContain("$1.25");
    expect(claude).toContain("partial");
    expect(claude).toContain("2 of 3 sessions");
    expect(total).toContain("All sources");
    expect(total).toContain("$1.38");
    expect(total).toContain("partial");
    expect(total).toContain("$0.01 each");
  });

  it("shows an unpriced source as unpriced, not $0.00", () => {
    const wrapper = panel(withSources([{ ...claudeEntry, costUsd: null, sessionsWithCostUsd: 0 }]));
    expect(wrapper.get('[data-source="claudeCode"]').text()).toContain("Unpriced");
    expect(wrapper.text()).not.toContain("$0.00");
  });

  it("lists a single source's priciest models beside its card", () => {
    const wrapper = panel(withSources([copilotEntry]));
    const models = wrapper.get('[data-source="models"]').text();
    expect(models).toContain("gpt-4");
    expect(models).toContain("96 AIC");
    expect(wrapper.find('[data-source="total"]').exists()).toBe(false);
  });

  it("draws the running total of each day's spend by source", async () => {
    const wrapper = panel(
      withSources([copilotEntry, claudeEntry], {
        costUsdByDay: [{ date: "2025-01-01", cost: 1.25 }],
      }),
    );
    await wrapper
      .findAll('[role="radio"]')
      .find((b) => b.text() === "Running total")
      ?.trigger("click");
    expect(wrapper.find('[aria-label="Running total of cost"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("USD · AI Credits at $0.01");
    // 30, 50 and 80 AIC at $0.01, plus $1.25 of Claude Code on the first day.
    expect(wrapper.text()).toContain("Total $2.85");
  });
});
