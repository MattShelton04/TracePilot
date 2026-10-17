import type { AnalyticsData } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { FIXTURE_ANALYTICS } from "@/__tests__/views/analyticsFixtures";
import {
  buildDashboardSummary,
  costBreakdown,
  countOf,
  formatDashboardCost,
  type Pricing,
} from "@/utils/analyticsSummary";

const unpriced: Pricing = { computeUsageBasedCost: () => null, computeWholesaleCost: () => null };

describe("analytics summary formatting", () => {
  it("reads a nonzero cost below half a cent as < $0.01, like the Metrics tab", () => {
    expect(formatDashboardCost(0.003)).toBe("< $0.01");
    expect(formatDashboardCost(0)).toBe("$0.00");
    expect(formatDashboardCost(0.006)).toBe("$0.01");
    expect(formatDashboardCost(1.25)).toBe("$1.25");
  });

  it("prices a Claude Code model below a cent as < $0.01", () => {
    const data: AnalyticsData = {
      ...FIXTURE_ANALYTICS,
      costBySource: [
        { source: "claudeCode", sessions: 1, tokens: 900, costUsd: 0.003, sessionsWithCostUsd: 1 },
      ],
      modelDistribution: [
        {
          ...FIXTURE_ANALYTICS.modelDistribution[0],
          model: "claude-haiku-4.5",
          source: "claudeCode",
          costUsd: 0.003,
        },
      ],
    };
    const summary = buildDashboardSummary(data, unpriced);
    expect(summary.models[0].costText).toBe("< $0.01");
    expect(costBreakdown(summary.costRows)).toBe("Claude Code < $0.01");
  });

  it("counts a noun in the singular only for one", () => {
    expect(countOf(1, "session")).toBe("1 session");
    expect(countOf(0, "session")).toBe("0 sessions");
    expect(countOf(1204, "session")).toBe("1,204 sessions");
  });
});
