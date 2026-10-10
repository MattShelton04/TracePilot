import { setupPinia } from "@tracepilot/test-utils";
import type { SourceCostEntry } from "@tracepilot/types";
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

  it("adds every source into one USD cost card when sources are mixed", () => {
    const summary = {
      credits: 12.5,
      usdEquivalent: 0.125,
      source: "observed" as const,
      observedCredits: 12.5,
      estimatedCredits: 0,
      isPartial: false,
    };
    const copilotEntry = {
      source: "copilot" as const,
      sessions: 4,
      tokens: 2_000,
      costUsd: null,
      sessionsWithCostUsd: 0,
    };
    const labels = (costBySource: SourceCostEntry[]) =>
      mount(AnalyticsStatsGrids, {
        props: { data: { ...FIXTURE_ANALYTICS, costBySource }, aiCreditSummary: summary },
      })
        .findAllComponents({ name: "StatCard" })
        .slice(0, 4)
        .map((card) => [card.props("label"), card.props("tooltip")] as const);
    const value = (costBySource: SourceCostEntry[], label: string) =>
      mount(AnalyticsStatsGrids, {
        props: { data: { ...FIXTURE_ANALYTICS, costBySource }, aiCreditSummary: summary },
      })
        .findAllComponents({ name: "StatCard" })
        .find((card) => card.props("label") === label)
        ?.props("value");
    expect(value([copilotEntry, ...claudeOnly.costBySource], "Total Cost (USD)")).toBe("$1.38");

    const mixed = labels([copilotEntry, ...claudeOnly.costBySource]);
    expect(mixed.map(([label]) => label)).toEqual([
      "Total Sessions",
      "Total Tokens",
      "AI Credits (Copilot)",
      "Total Cost (USD)",
    ]);
    // Every source adds into one USD total; the Claude Code half is partial.
    const total = mixed.find(([label]) => label === "Total Cost (USD)")?.[1];
    expect(total).toContain("Copilot $0.13 + Claude Code $1.25");
    expect(total).toContain("$0.01 each");
    expect(total).toContain("Partial");

    const copilotOnly = labels([copilotEntry]).map(([label]) => label);
    expect(copilotOnly).toContain("AI Credits");
    expect(copilotOnly).toContain("AIC USD Equivalent");
  });

  it("lists each source in USD with a total across sources", () => {
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
            amount: 2,
            usdEquivalent: 2,
            partial: true,
          },
        ],
      },
    });
    const copilot = wrapper.find('[data-source="copilot"]').text();
    const claude = wrapper.find('[data-source="claudeCode"]').text();
    const total = wrapper.find('[data-source="total"]').text();
    expect(copilot).toContain("$0.13");
    expect(copilot).toContain("12.5 AIC at $0.01");
    expect(claude).toContain("$2.00");
    expect(claude).toContain("partial");
    expect(total).toContain("All sources");
    expect(total).toContain("7");
    expect(total).toContain("$2.13");
    expect(total).toContain("Partial");
    expect(wrapper.text()).not.toMatch(/not a bill|not added together/i);
  });

  it("shows an unpriced source as unpriced, not $0.00", () => {
    const wrapper = mount(AnalyticsSourceCostPanel, {
      props: {
        rows: [
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
    expect(wrapper.find('[data-source="claudeCode"]').text()).toContain("Unpriced");
    expect(wrapper.find('[data-source="total"]').text()).toContain("Unpriced");
    expect(wrapper.text()).not.toContain("$0.00");
  });

  it("charts estimated USD for a source not billed in AI Credits", () => {
    const priced = { ...claudeOnly, costUsdByDay: [{ date: "2026-03-01", cost: 1.25 }] };
    const wrapper = mountTrend(false, priced);
    expect(wrapper.find('[data-testid="cost-trend-unbilled"]').exists()).toBe(false);
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
    expect(wrapper.find("svg[aria-label*='estimated cost']").exists()).toBe(true);
  });

  const mixedTrendData = {
    ...FIXTURE_ANALYTICS,
    costBySource: [
      {
        source: "copilot" as const,
        sessions: 4,
        tokens: 2_000,
        costUsd: null,
        sessionsWithCostUsd: 0,
      },
      ...claudeOnly.costBySource,
    ],
    costUsdByDay: [{ date: "2025-01-01", cost: 1.25 }],
  };

  it("keeps the Copilot-only bases when no run is priced in USD", () => {
    const copilot = mountTrend(undefined, FIXTURE_ANALYTICS);
    expect(copilot.findAll('[role="radio"]').map((b) => b.text())).toEqual([
      "AI Credits",
      "Legacy Premium",
    ]);
    expect(copilot.get('[aria-checked="true"]').text()).toBe("AI Credits");
  });

  it("defaults to one USD series across sources, with each source a click away", async () => {
    const mixed = mountTrend(undefined, mixedTrendData);
    const options = mixed.findAll('[role="radio"]');
    expect(options.map((b) => b.text())).toEqual([
      "All Sources",
      "AI Credits",
      "Legacy Premium",
      "Claude Code",
    ]);
    expect(mixed.get('[aria-checked="true"]').text()).toBe("All Sources");
    expect(mixed.find("svg[aria-label*='across all sources']").exists()).toBe(true);

    const claude = options.find((b) => b.text() === "Claude Code");
    await claude?.trigger("click");
    expect(claude?.attributes("aria-checked")).toBe("true");
    expect(mixed.find("svg[aria-label*='estimated cost']").exists()).toBe(true);
  });

  it("breaks each day of the combined series down by source", async () => {
    const onChartMouseMove = vi.fn();
    const mixed = mountTrend(undefined, mixedTrendData, onChartMouseMove);
    await mixed.get("svg[aria-label*='across all sources']").trigger("mousemove");
    const [, coords, format] = onChartMouseMove.mock.calls[0];
    // 30, 50 and 80 AIC at $0.01, plus $1.25 of Claude Code on the first day.
    expect(coords.map((point: { cost: number }) => point.cost)).toEqual([
      expect.closeTo(1.55),
      expect.closeTo(0.5),
      expect.closeTo(0.8),
    ]);
    expect(format(0)).toContain("$1.55 · Copilot $0.30 · Claude Code $1.25");
  });
});

function mountTrend(
  billedInAic: boolean | undefined,
  data: typeof FIXTURE_ANALYTICS,
  onChartMouseMove = vi.fn(),
) {
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
      onChartMouseMove,
      onChartClick: vi.fn(),
      dismissTooltip: vi.fn(),
      billedInAic,
    },
    global: { stubs: { RouterLink: true } },
  });
}
