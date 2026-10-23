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
  analyticsEmptyScope,
  analyticsScopeWords,
  binRows,
  busiestColumn,
  cumulativeRows,
  type DayRow,
  dashboardDays,
  daysBetween,
  durationStrip,
  errorPins,
  formatShare,
  perColumnTitle,
  rangeDays,
  rangeText,
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

  it("spans any dated series, unsorted, out to a later last day", () => {
    const now = new Date("2026-03-02T12:00:00Z");
    expect(rangeDays(["2026-03-03", "2026-03-01"], {}, now)).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
    ]);
    expect(rangeDays([], { fromDate: "2026-03-01" }, now)).toEqual(["2026-03-01", "2026-03-02"]);
  });

  it("names the range in words", () => {
    expect(rangeText("7d")).toBe("the past 7 days");
    expect(rangeText("custom")).toBe("the selected period");
    expect(rangeText("all")).toBe("all time");
  });
});

describe("analytics scope words", () => {
  const base = { selectedRepo: null, selectedSource: null } as const;

  it("says all only when nothing narrows the scope", () => {
    expect(analyticsScopeWords({ ...base, selectedTimeRange: "all" })).toEqual({
      all: "all ",
      suffix: "",
    });
    expect(analyticsScopeWords({ ...base, selectedTimeRange: "30d" })).toEqual({
      all: "",
      suffix: " in the past 30 days",
    });
    expect(analyticsScopeWords({ ...base, selectedTimeRange: "month-to-date" }).suffix).toBe(
      " this month",
    );
  });

  it("names a custom range with a date as the selected period", () => {
    for (const dates of [
      { customFromDate: "2026-01-01" },
      { customToDate: "2026-02-01" },
      { customFromDate: "2026-01-01", customToDate: "2026-02-01" },
    ]) {
      expect(analyticsScopeWords({ ...base, selectedTimeRange: "custom", ...dates })).toEqual({
        all: "",
        suffix: " in the selected period",
      });
    }
  });

  it("reads a custom range with no dates as all time, since it fetches every session", () => {
    expect(analyticsScopeWords({ ...base, selectedTimeRange: "custom" })).toEqual({
      all: "all ",
      suffix: "",
    });
    expect(
      analyticsScopeWords({ ...base, selectedTimeRange: "custom", selectedSource: "claudeCode" }),
    ).toEqual({ all: "", suffix: "" });
  });
});

describe("analytics empty scope", () => {
  const sentence = (filters: Parameters<typeof analyticsEmptyScope>[0]) => {
    const { source, suffix } = analyticsEmptyScope(filters);
    return `No ${source}sessions ended${suffix}.`;
  };

  it.each([
    ["all", null, null, "No sessions ended."],
    ["all", "project:harbor", null, "No sessions ended in harbor."],
    ["all", null, "copilot", "No Copilot sessions ended."],
    ["all", "project:harbor", "copilot", "No Copilot sessions ended in harbor."],
    ["7d", null, null, "No sessions ended in the past 7 days."],
    ["7d", "project:harbor", null, "No sessions ended in harbor in the past 7 days."],
    ["7d", null, "claudeCode", "No Claude Code sessions ended in the past 7 days."],
    ["7d", "project:harbor", "copilot", "No Copilot sessions ended in harbor in the past 7 days."],
    [
      "month-to-date",
      "project:harbor",
      "copilot",
      "No Copilot sessions ended in harbor this month.",
    ],
    ["custom", null, null, "No sessions ended."],
  ] as const)("reads naturally for %s, repo %s, source %s", (range, repo, source, expected) => {
    expect(sentence({ selectedTimeRange: range, selectedRepo: repo, selectedSource: source })).toBe(
      expected,
    );
  });

  it("names a dated custom range as the selected period", () => {
    expect(
      sentence({
        selectedTimeRange: "custom",
        selectedRepo: "project:harbor",
        selectedSource: null,
        customFromDate: "2026-01-01",
      }),
    ).toBe("No sessions ended in harbor in the selected period.");
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

  it("names the busiest drawn column and the days each column covers", () => {
    const daily = [
      row("2026-03-15", [6, 1]),
      row("2026-03-16", [5, 0]),
      row("2026-03-24", [9, 0]),
      row("2026-03-25", [0, 0]),
    ];
    expect(busiestColumn(daily)).toMatchObject({ total: 9, label: "Mar 24" });
    expect(perColumnTitle("Calls", daily)).toBe("Calls per day");
    const merged = [
      { ...daily[0], to: "2026-03-16", values: [11, 1] },
      { ...daily[2], to: "2026-03-25" },
    ];
    expect(busiestColumn(merged)).toMatchObject({ total: 12, label: "Mar 15 – Mar 16" });
    expect(perColumnTitle("Calls", merged)).toBe("Calls per 2 days");
    expect(busiestColumn([row("2026-03-15", [0])])).toBeNull();
    expect(perColumnTitle("Calls", [])).toBe("Calls per day");
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
  const stats = (minMs: number, medianMs: number, avgMs: number, p95Ms: number, maxMs: number) => ({
    minMs,
    medianMs,
    avgMs,
    p95Ms,
    maxMs,
    totalSessionsWithDuration: 9,
  });

  /** Labels that share a row never overlap, using the strip's 6px mono advance. */
  function expectNoOverlap(marks: ReturnType<typeof durationStrip>, widthPx: number) {
    const spans = marks.map((m) => {
      const w = `${m.label} ${m.text}`.length * 6;
      const x = (m.pct / 100) * widthPx;
      const start = m.align === "start" ? x : m.align === "end" ? x - w : x - w / 2;
      return { row: m.row, start, end: start + w };
    });
    for (const a of spans)
      for (const b of spans)
        if (a !== b && a.row === b.row) expect(a.end <= b.start || b.end <= a.start).toBe(true);
  }

  it("staggers labels too close for one row", () => {
    const marks = durationStrip(stats(2_000, 1_000_000, 1_200_000, 7_000_000, 7_200_000), 800);
    expect(marks.map((m) => m.row)).toEqual([0, 0, 1, 0, 1]);
    expect(marks[0].pct).toBe(0);
    expect(marks[4].pct).toBe(100);
    expectNoOverlap(marks, 800);
  });

  it("merges one timed session's equal statistics into a single centred label", () => {
    const marks = durationStrip(stats(12_000, 12_000, 12_000, 12_000, 12_000), 800);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      keys: ["min", "median", "avg", "p95", "max"],
      label: "min · median · mean · p95 · max",
      text: "12s",
      pct: 50,
      row: 0,
    });
  });

  it("merges only the statistics that share a value", () => {
    const marks = durationStrip(stats(140, 410, 410, 920, 1_400), 800);
    expect(marks.map((m) => m.label)).toEqual(["min", "median · mean", "p95", "max"]);
    expect(marks[1].text).toBe("410ms");
  });

  it("spreads sub-second statistics instead of pinning them to the start", () => {
    const marks = durationStrip(stats(140, 410, 480, 920, 1_400), 800);
    const pct = marks.map((m) => Math.round(m.pct));
    expect(pct).toEqual([0, 47, 54, 82, 100]);
    expectNoOverlap(marks, 800);
  });

  it("gives every clustered label a row of its own when they would overlap", () => {
    const marks = durationStrip(stats(2_000, 10_000, 11_000, 12_000, 7_200_000), 800);
    expect(marks.map((m) => m.label)).toEqual(["min", "median", "mean", "p95", "max"]);
    expect(marks.map((m) => m.row)).toEqual([0, 0, 1, 2, 0]);
    expectNoOverlap(marks, 800);
  });

  it("keeps labels inside the strip at both ends", () => {
    const marks = durationStrip(stats(2_000, 60_000, 90_000, 600_000, 7_200_000), 800);
    expect(marks[0].align).toBe("start");
    expect(marks[4].align).toBe("end");
  });
});

describe("shares", () => {
  it("never shows a sliver as 0%", () => {
    expect(formatShare(0.04)).toBe("<0.1%");
    expect(formatShare(0.4)).toBe("0.4%");
    expect(formatShare(42.6)).toBe("43%");
    expect(formatShare(0)).toBe("0%");
  });

  it("never shows nearly all as 100%, and carries 0.96% to 1%", () => {
    expect(formatShare(0.96)).toBe("1%");
    expect(formatShare(98.6)).toBe("99%");
    expect(formatShare(99.02)).toBe("99%");
    expect(formatShare(99.6)).toBe("99.6%");
    expect(formatShare(99.9)).toBe("99.9%");
    expect(formatShare(99.96)).toBe(">99.9%");
    expect(formatShare(100)).toBe("100%");
    expect(formatShare(130)).toBe("130%");
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
      toolsMetric: "calls",
      toolsStyle: "bars",
      toolsSort: "calls",
      codeStyle: "bars",
    });
  });

  it("keeps stored choices that are still options and defaults the rest", () => {
    expect(
      readAnalyticsViews(JSON.stringify({ activityMetric: "tokens", costView: "pie", extra: 1 })),
    ).toMatchObject({ activityMetric: "tokens", costView: "sources" });
  });
});
