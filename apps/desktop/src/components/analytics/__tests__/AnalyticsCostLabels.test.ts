import { setupPinia } from "@tracepilot/test-utils";
import { createChartLayout } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_ANALYTICS } from "../../../__tests__/views/analyticsFixtures";
import AnalyticsDistributionRow from "../AnalyticsDistributionRow.vue";
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

  function costTrend(billedInAic?: boolean) {
    return mount(AnalyticsDistributionRow, {
      props: {
        data: FIXTURE_ANALYTICS,
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
