import { setupPinia } from "@tracepilot/test-utils";
import type { AnalyticsData } from "@tracepilot/types";
import { KPI } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAnalyticsDashboardViews } from "@/composables/useAnalyticsDashboardViews";
import { activityRows, dashboardDays } from "@/utils/analyticsDashboard";
import { buildDashboardSummary, type Pricing } from "@/utils/analyticsSummary";
import { FIXTURE_ANALYTICS } from "../../../__tests__/views/analyticsFixtures";
import AnalyticsIncidentsPanel from "../AnalyticsIncidentsPanel.vue";
import AnalyticsKpis from "../AnalyticsKpis.vue";

beforeEach(() => {
  setupPinia();
  localStorage.clear();
  resetAnalyticsDashboardViews();
});

const unpriced: Pricing = { computeUsageBasedCost: () => null, computeWholesaleCost: () => null };

/** Incidents as the index reports them: `errors` counts rate limits too. */
function withIncidents(
  errors: number,
  rateLimits: number,
  sessionsWithErrors: number,
): AnalyticsData {
  return {
    ...FIXTURE_ANALYTICS,
    sessionsWithErrors,
    totalRateLimits: rateLimits,
    incidentsByDay: [{ date: "2025-01-02", errors, rateLimits, compactions: 0, truncations: 0 }],
  };
}

function errorsKpi(data: AnalyticsData) {
  const summary = buildDashboardSummary(data, unpriced);
  const days = dashboardDays(data, {});
  const rows = activityRows({
    data,
    days,
    metric: "runs",
    aiCreditsByDay: summary.aiCreditsByDay,
    label: (s) => s,
  }).rows;
  const kpi = mount(AnalyticsKpis, { props: { data, summary, rows } })
    .findAllComponents(KPI)
    .find((k) => k.props("label") === "Errors");
  if (!kpi) throw new Error("no Errors KPI");
  return { value: kpi.props("value"), text: kpi.text() };
}

function incidentsPanel(data: AnalyticsData) {
  const wrapper = mount(AnalyticsIncidentsPanel, {
    props: {
      data,
      days: dashboardDays(data, {}),
      sources: ["claudeCode"],
      rangeText: "any session",
    },
  });
  const tile = (kind: string) => wrapper.get(`[data-kind="${kind}"] .ad-tile__value span`).text();
  return { errors: tile("errors"), rateLimits: tile("rateLimits"), text: wrapper.text() };
}

describe("analytics incident counts", () => {
  it("counts a rate limit alone as a rate limit in both the Errors tile and the panel", () => {
    const data = withIncidents(1, 1, 1);
    const kpi = errorsKpi(data);
    const panel = incidentsPanel(data);

    expect(panel.errors).toBe("0");
    expect(panel.rateLimits).toBe("1");
    expect(kpi.value).toBe(panel.errors);
    expect(kpi.text).toContain("1 rate limit · 1 session affected");
    expect(kpi.text).not.toContain("rate limits");
    expect(panel.text).toContain("1 session with errors or rate limits");
  });

  it("gives the Errors tile the panel's error count, rate limits apart", () => {
    const data = withIncidents(5, 2, 3);
    const kpi = errorsKpi(data);
    const panel = incidentsPanel(data);

    expect(panel.errors).toBe("3");
    expect(kpi.value).toBe(panel.errors);
    expect(kpi.text).toContain("2 rate limits · 3 sessions affected");
    expect(panel.text).toContain("3 sessions with errors or rate limits");
  });
});
