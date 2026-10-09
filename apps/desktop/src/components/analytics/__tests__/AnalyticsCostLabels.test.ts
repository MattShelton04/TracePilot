import { setupPinia } from "@tracepilot/test-utils";
import { createChartLayout } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_ANALYTICS } from "../../../__tests__/views/analyticsFixtures";
import AnalyticsDistributionRow from "../AnalyticsDistributionRow.vue";
import AnalyticsSourceCostPanel from "../AnalyticsSourceCostPanel.vue";
import AnalyticsStatsGrids from "../AnalyticsStatsGrids.vue";

beforeEach(() => setupPinia());

describe("analytics cost labels for sources without AI Credits", () => {
  it("shows an unavailable AIC USD equivalent as a dash, not $0.00", () => {
    const wrapper = mount(AnalyticsStatsGrids, {
      props: {
        data: FIXTURE_ANALYTICS,
        aiCreditSummary: {
          credits: null,
          usdEquivalent: null,
          source: "unavailable",
          observedCredits: 0,
          estimatedCredits: 0,
          isPartial: true,
        },
      },
    });
    expect(wrapper.text()).not.toContain("$0.00");
    expect(wrapper.text()).toContain("AIC USD Equivalent");
  });

  function costTrend(billedInAic?: boolean, data = FIXTURE_ANALYTICS) {
    return mount(AnalyticsDistributionRow, {
      props: {
        data,
        chartLayout: createChartLayout(55, 490, 20, 175),
        gridLines: [],
        timeRangeLabel: "all time",
        tooltip: {
          visible: false,
          pinned: false,
          x: 0,
          y: 0,
          content: "",
          chartId: "",
          highlightIndex: -1,
        },
        onChartMouseMove: vi.fn(),
        onChartClick: vi.fn(),
        dismissTooltip: vi.fn(),
        billedInAic,
      },
      global: { stubs: { RouterLink: true } },
    });
  }

  it("does not chart an AI Credit cost trend for a source that is not billed in them", () => {
    const claude = costTrend(false);
    expect(claude.find('[data-testid="cost-trend-unbilled"]').exists()).toBe(true);
    expect(claude.find('[role="radiogroup"]').exists()).toBe(false);

    const copilot = costTrend();
    expect(copilot.find('[data-testid="cost-trend-unbilled"]').exists()).toBe(false);
    expect(copilot.find('[role="radiogroup"]').exists()).toBe(true);
  });
});

describe("analytics cost split by source", () => {
  const claudeOnly = {
    ...FIXTURE_ANALYTICS,
    costBySource: [
      {
        source: "claudeCode" as const,
        sessions: 3,
        tokens: 1_000,
        costUsd: 1.25,
        sessionsWithCostUsd: 2,
      },
    ],
  };

  it("shows a USD-priced source's estimate instead of AI Credit cards", () => {
    const wrapper = mount(AnalyticsStatsGrids, {
      props: { data: claudeOnly, aiCreditSummary: null },
    });
    expect(wrapper.text()).toContain("Estimated Cost");
    expect(wrapper.text()).toContain("$1.25");
    expect(wrapper.text()).toContain("2 of 3");
    expect(wrapper.text()).not.toContain("AI Credits");
  });

  it("lists each source in its own unit without a combined total", () => {
    const wrapper = mount(AnalyticsSourceCostPanel, {
      props: {
        rows: [
          {
            source: "copilot",
            sessions: 4,
            tokens: 2_000,
            unit: "aic",
            amount: 12.5,
            usdEquivalent: 0.125,
            partial: false,
          },
          {
            source: "claudeCode",
            sessions: 3,
            tokens: 1_000,
            unit: "usd",
            amount: null,
            usdEquivalent: null,
            partial: false,
          },
        ],
      },
    });
    const copilot = wrapper.find('[data-source="copilot"]').text();
    const claude = wrapper.find('[data-source="claudeCode"]').text();
    expect(copilot).toContain("12.5");
    expect(copilot).toContain("AIC");
    expect(claude).toContain("Unpriced");
    expect(claude).not.toContain("$0.00");
    expect(wrapper.text()).toContain("not added together");
  });

  it("charts estimated USD for a source not billed in AI Credits", () => {
    const priced = { ...claudeOnly, costUsdByDay: [{ date: "2026-03-01", cost: 1.25 }] };
    const wrapper = mountTrend(false, priced);
    expect(wrapper.find('[data-testid="cost-trend-unbilled"]').exists()).toBe(false);
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
    expect(wrapper.find("svg[aria-label*='estimated cost']").exists()).toBe(true);
  });

  it("offers an Estimated USD basis beside AI Credits only when runs are priced in USD", async () => {
    const copilot = mountTrend(undefined, FIXTURE_ANALYTICS);
    expect(copilot.text()).not.toContain("Estimated USD");

    const mixed = mountTrend(undefined, {
      ...FIXTURE_ANALYTICS,
      costUsdByDay: [{ date: "2026-03-01", cost: 1.25 }],
    });
    const usd = mixed.findAll('[role="radio"]').find((b) => b.text() === "Estimated USD");
    expect(usd).toBeDefined();
    await usd?.trigger("click");
    expect(usd?.attributes("aria-checked")).toBe("true");
  });
});

function mountTrend(billedInAic: boolean | undefined, data: typeof FIXTURE_ANALYTICS) {
  return mount(AnalyticsDistributionRow, {
    props: {
      data,
      chartLayout: createChartLayout(55, 490, 20, 175),
      gridLines: [],
      timeRangeLabel: "all time",
      tooltip: {
        visible: false,
        pinned: false,
        x: 0,
        y: 0,
        content: "",
        chartId: "",
        highlightIndex: -1,
      },
      onChartMouseMove: vi.fn(),
      onChartClick: vi.fn(),
      dismissTooltip: vi.fn(),
      billedInAic,
    },
    global: { stubs: { RouterLink: true } },
  });
}
