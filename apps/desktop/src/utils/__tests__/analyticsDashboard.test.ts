import type { AnalyticsData } from "@tracepilot/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  readAnalyticsViews,
  resetAnalyticsDashboardViews,
  useAnalyticsDashboardViews,
} from "@/composables/useAnalyticsDashboardViews";
import { FIXTURE_ANALYTICS } from "../../__tests__/views/analyticsFixtures";
import {
  activityRows,
  binRows,
  cumulativeRows,
  type DayRow,
  dashboardDays,
  daysBetween,
  durationStrip,
  errorPins,
  formatShare,
  tickIndices,
} from "../analyticsDashboard";

const row = (from: string, values: number[], extra: Partial<DayRow> = {}): DayRow => ({
  from,
  to: from,
  values,
  runs: 0,
  errors: 0,
  rateLimits: 0,
  ...extra,
});

describe("dashboard days", () => {
  it("lists every UTC day of a span, inclusive", () => {
    expect(daysBetween("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(daysBetween("2026-03-02", "2026-03-01")).toEqual([]);
  });

  it("spans All time from the first day with data to today", () => {
    const days = dashboardDays(FIXTURE_ANALYTICS, {}, new Date("2026-03-20T12:00:00Z"));
    expect(days[0]).toBe("2025-01-01");
    expect(days.at(-1)).toBe("2026-03-20");
  });

  it("draws a range's own days even when it has no data", () => {
    const empty = {
      ...FIXTURE_ANALYTICS,
      activityPerDay: [],
      tokenUsageByDay: [],
      incidentsByDay: [],
    };
    expect(dashboardDays(empty, { fromDate: "2026-01-01", toDate: "2026-01-03" })).toHaveLength(3);
    expect(dashboardDays(empty, {})).toEqual([]);
  });
});

describe("activity rows", () => {
  const data: AnalyticsData = {
    ...FIXTURE_ANALYTICS,
    costBySource: [
      { source: "copilot", sessions: 4, tokens: 1, costUsd: null, sessionsWithCostUsd: 0 },
      { source: "claudeCode", sessions: 2, tokens: 1, costUsd: 3, sessionsWithCostUsd: 2 },
    ],
    costUsdByDay: [{ date: "2025-01-02", cost: 3 }],
    modelUsageByDay: [
      ...FIXTURE_ANALYTICS.modelUsageByDay,
      {
        date: "2025-01-02",
        model: "claude-opus-5-5",
        source: "claudeCode",
        inputTokens: 900,
        outputTokens: 100,
        cacheReadTokens: 800,
        cacheWriteTokens: 0,
      },
    ],
    incidentsByDay: [
      { date: "2025-01-02", errors: 3, rateLimits: 1, compactions: 0, truncations: 0 },
    ],
  };
  const days = ["2025-01-01", "2025-01-02", "2025-01-03"];
  const build = (metric: "cost" | "tokens" | "runs") =>
    activityRows({
      data,
      days,
      metric,
      aiCreditsByDay: new Map([["2025-01-01", 30]]),
      label: (source) => source,
    });

  it("stacks cost by source in USD, AI Credits at $0.01", () => {
    const { series, rows } = build("cost");
    expect(series.map((s) => s.key)).toEqual(["copilot", "claudeCode"]);
    expect(rows.map((r) => r.values)).toEqual([
      [0.3, 0],
      [0, 3],
      [0, 0],
    ]);
  });

  it("stacks tokens by source and keeps runs as one series", () => {
    expect(build("tokens").rows[1].values).toEqual([550_000, 1_000]);
    const runs = build("runs");
    expect(runs.series).toHaveLength(1);
    expect(runs.rows.map((r) => r.values[0])).toEqual([3, 4, 3]);
  });

  it("separates rate limits from other errors", () => {
    expect(build("runs").rows[1]).toMatchObject({ errors: 2, rateLimits: 1 });
  });
});

describe("binning and running totals", () => {
  const rows = [row("d1", [1, 2]), row("d2", [3, 4]), row("d3", [5, 6])];

  it("adds daily values into bins", () => {
    expect(binRows(rows, 2).map((r) => [r.from, r.to, r.values])).toEqual([
      ["d1", "d2", [4, 6]],
      ["d3", "d3", [5, 6]],
    ]);
  });

  it("keeps a running total's last value per bin", () => {
    const running = cumulativeRows(rows);
    expect(running.map((r) => r.values)).toEqual([
      [1, 2],
      [4, 6],
      [9, 12],
    ]);
    expect(binRows(running, 2, true).map((r) => r.values)).toEqual([
      [4, 6],
      [9, 12],
    ]);
  });
});

describe("axis ticks and pins", () => {
  it("spaces tick labels to the width", () => {
    expect(tickIndices(30, 840, 84)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27]);
    expect(tickIndices(1, 840)).toEqual([0]);
  });

  it("merges pins closer than the gap into one with a count", () => {
    const pins = errorPins(
      [
        row("d1", [0], { errors: 1 }),
        row("d2", [0], { rateLimits: 2 }),
        row("d3", [0]),
        row("d4", [0]),
        row("d5", [0], { errors: 1 }),
      ],
      25,
    );
    expect(pins.map((p) => [p.columns, p.errors, p.rateLimits])).toEqual([
      [[0, 1], 1, 2],
      [[4], 1, 0],
    ]);
  });
});

describe("model time strip", () => {
  it("staggers labels too close for one row", () => {
    const marks = durationStrip({
      minMs: 2_000,
      medianMs: 1_000_000,
      avgMs: 1_200_000,
      p95Ms: 7_000_000,
      maxMs: 7_200_000,
      totalSessionsWithDuration: 9,
    });
    expect(marks.map((m) => m.row)).toEqual([0, 0, 1, 0, 1]);
    expect(marks[0].pct).toBe(0);
    expect(marks[4].pct).toBe(100);
  });
});

describe("shares", () => {
  it("never shows a sliver as 0%", () => {
    expect(formatShare(0.04)).toBe("<0.1%");
    expect(formatShare(0.4)).toBe("0.4%");
    expect(formatShare(42.6)).toBe("43%");
    expect(formatShare(0)).toBe("0%");
  });
});

describe("dashboard view choices", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAnalyticsDashboardViews();
  });

  it("defaults to cost bars, source cards and incident tiles", () => {
    expect(useAnalyticsDashboardViews().value).toEqual({
      activityMetric: "cost",
      activityStyle: "bars",
      costView: "sources",
      incidentsView: "tiles",
      incidentsScale: "count",
    });
  });

  it("keeps stored choices that are still options and defaults the rest", () => {
    expect(
      readAnalyticsViews(JSON.stringify({ activityMetric: "tokens", costView: "pie", extra: 1 })),
    ).toMatchObject({ activityMetric: "tokens", costView: "sources" });
  });
});
