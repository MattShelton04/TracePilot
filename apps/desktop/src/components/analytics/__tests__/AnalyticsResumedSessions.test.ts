/**
 * Per-day series count every run that ended in the range, while the headline
 * totals (`totalSessions`, `costBySource`, `modelDistribution`) count only
 * sessions last active in it (their in-range usage). A session resumed after
 * the range therefore has runs in the day series but nothing in the totals;
 * the per-day charts must still draw them.
 */
import { setupPinia } from "@tracepilot/test-utils";
import type { AnalyticsData } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetAnalyticsDashboardViews,
  useAnalyticsDashboardViews,
} from "@/composables/useAnalyticsDashboardViews";
import { activityRows, hasDailyUsage } from "@/utils/analyticsDashboard";
import { buildDashboardSummary, type Pricing } from "@/utils/analyticsSummary";
import { FIXTURE_ANALYTICS } from "../../../__tests__/views/analyticsFixtures";
import AnalyticsCostPanel from "../AnalyticsCostPanel.vue";
import AnalyticsDayChart from "../AnalyticsDayChart.vue";
import AnalyticsKpis from "../AnalyticsKpis.vue";
import AnalyticsModelMix from "../AnalyticsModelMix.vue";
import AnalyticsTokenMix from "../AnalyticsTokenMix.vue";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  setupPinia();
  localStorage.clear();
  resetAnalyticsDashboardViews();
});

const unpriced: Pricing = { computeUsageBasedCost: () => null, computeWholesaleCost: () => null };
const days = ["2025-01-01", "2025-01-02", "2025-01-03"];

/** A Claude Code run that ended on Jan 2, from a session last active later. */
const claudeRun = {
  activityPerDay: [{ date: "2025-01-02", count: 1 }],
  tokenUsageByDay: [{ date: "2025-01-02", tokens: 1_000 }],
  modelUsageByDay: [
    {
      date: "2025-01-02",
      model: "claude-sonnet-4.6",
      source: "claudeCode" as const,
      inputTokens: 900,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  ],
  costUsdByDay: [{ date: "2025-01-02", cost: 0.5 }],
};

/** No session was last active in the range; only the resumed run is in it. */
const resumedOnly: AnalyticsData = {
  ...FIXTURE_ANALYTICS,
  totalSessions: 0,
  totalTokens: 0,
  totalCost: 0,
  totalPremiumRequests: 0,
  totalNanoAiu: 0,
  sessionsWithObservedAiCredits: 0,
  modelDistribution: [],
  costByDay: [],
  incidentsByDay: [],
  costBySource: [],
  ...claudeRun,
};

const build = (data: AnalyticsData, metric: "cost" | "tokens" | "runs") =>
  activityRows({
    data,
    days,
    metric,
    aiCreditsByDay: new Map(),
    label: (source) => source,
  });

describe("per-day charts with runs from resumed sessions", () => {
  it("draws a source that has day rows but no session in the totals", () => {
    // Copilot sessions were last active in the range; the Claude Code one
    // was resumed after it.
    const data: AnalyticsData = {
      ...FIXTURE_ANALYTICS,
      costBySource: [
        { source: "copilot", sessions: 4, tokens: 1, costUsd: null, sessionsWithCostUsd: 0 },
      ],
      modelUsageByDay: [...FIXTURE_ANALYTICS.modelUsageByDay, ...claudeRun.modelUsageByDay],
      costUsdByDay: claudeRun.costUsdByDay,
    };
    const tokens = build(data, "tokens");
    expect(tokens.series.map((s) => s.key)).toEqual(["copilot", "claudeCode"]);
    expect(tokens.rows[1].values).toEqual([550_000, 1_000]);
    const cost = build(data, "cost");
    expect(cost.series.map((s) => s.key)).toEqual(["copilot", "claudeCode"]);
    expect(cost.rows[1].values).toEqual([0, 0.5]);
  });

  it("draws the runs when no session was last active in the range", () => {
    expect(hasDailyUsage(resumedOnly)).toBe(true);
    expect(build(resumedOnly, "tokens").rows[1].values).toEqual([1_000]);
    expect(build(resumedOnly, "cost").rows[1].values).toEqual([0.5]);
    expect(build(resumedOnly, "runs").series[0].label).toBe("claudeCode runs");
  });

  it("keeps the cost running total and says why By source is empty", () => {
    const summary = buildDashboardSummary(resumedOnly, unpriced);
    const props = {
      data: resumedOnly,
      summary,
      days,
      costPerPremiumRequest: 0.04,
    };
    const views = useAnalyticsDashboardViews();

    views.value.costView = "sources";
    const sources = mount(AnalyticsCostPanel, { props });
    expect(sources.text()).toContain("No session ended in this range");
    expect(sources.text()).not.toContain("No usage");

    views.value.costView = "running";
    const running = mount(AnalyticsCostPanel, { props });
    expect(running.findComponent(AnalyticsDayChart).exists()).toBe(true);
    expect(running.text()).not.toContain("No cost");
    expect(running.text()).toContain("$0.50");
  });

  it("labels the run strip with its runs, not as empty", () => {
    const summary = buildDashboardSummary(resumedOnly, unpriced);
    const rows = build(resumedOnly, "runs").rows;
    const kpis = mount(AnalyticsKpis, { props: { data: resumedOnly, summary, rows } });
    expect(kpis.text()).toContain("1 run · active 1 of 3");
    expect(kpis.text()).not.toContain("No sessions");
  });

  it("explains empty model and token mixes instead of saying nothing ran", () => {
    const mix = mount(AnalyticsModelMix, { props: { models: [], dailyUsage: true } });
    expect(mix.text()).toContain("No session ended in this range");
    expect(mix.text()).not.toContain("No model calls were recorded");
    const { composition } = buildDashboardSummary(resumedOnly, unpriced);
    const tokens = mount(AnalyticsTokenMix, {
      props: { composition, models: [], dailyUsage: true },
    });
    expect(tokens.text()).toContain("No session ended in this range");
    expect(tokens.text()).not.toContain("No model usage.");
  });
});
