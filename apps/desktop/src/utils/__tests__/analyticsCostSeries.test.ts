import type { AnalyticsData } from "@tracepilot/types";
import { describe, expect, it, vi } from "vitest";
import {
  buildAnalyticsAiCreditSummary,
  buildAnalyticsCostSeries,
  buildCombinedCostSeries,
  buildSourceCostRows,
  combinedCostTotal,
  type SourceCostRow,
} from "../analyticsCostSeries";

const baseAnalytics: AnalyticsData = {
  totalSessions: 1,
  totalTokens: 0,
  totalCost: 0,
  totalPremiumRequests: 0,
  tokenUsageByDay: [],
  activityPerDay: [],
  modelDistribution: [],
  costByDay: [
    { date: "2026-01-02", cost: 3 },
    { date: "2026-01-01", cost: 2 },
  ],
  modelUsageByDay: [
    {
      date: "2026-01-02",
      model: "claude-opus-4.6",
      inputTokens: 100,
      cacheReadTokens: 25,
      outputTokens: 50,
      cacheWriteTokens: 10,
    },
    {
      date: "2026-01-01",
      model: "gpt-5.4",
      inputTokens: 80,
      cacheReadTokens: 0,
      outputTokens: 40,
      cacheWriteTokens: 0,
    },
    {
      date: "2026-01-02",
      model: "unknown",
      inputTokens: 1_000,
      cacheReadTokens: 0,
      outputTokens: 1_000,
      cacheWriteTokens: 0,
    },
  ],
  apiDurationStats: {
    avgMs: 0,
    medianMs: 0,
    p95Ms: 0,
    minMs: 0,
    maxMs: 0,
    totalSessionsWithDuration: 0,
  },
  productivityMetrics: {
    avgTurnsPerSession: 0,
    avgToolCallsPerTurn: 0,
    avgTokensPerTurn: 0,
    avgTokensPerApiSecond: 0,
  },
  cacheStats: {
    totalCacheReadTokens: 0,
    totalInputTokens: 0,
    cacheHitRate: 0,
    nonCachedInputTokens: 0,
  },
  sessionsWithErrors: 0,
  totalRateLimits: 0,
  totalCompactions: 0,
  totalTruncations: 0,
  incidentsByDay: [],
};

describe("buildAnalyticsCostSeries", () => {
  it("builds the legacy Copilot series from premium requests", () => {
    const computeWholesaleCost = vi.fn();
    expect(buildAnalyticsCostSeries(baseAnalytics, "legacy", 0.04, computeWholesaleCost)).toEqual([
      { date: "2026-01-02", cost: 0.12 },
      { date: "2026-01-01", cost: 0.08 },
    ]);
    expect(computeWholesaleCost).not.toHaveBeenCalled();
  });

  it("builds an exact direct API series from per-day model usage", () => {
    const computeWholesaleCost = vi.fn(
      (model: string, input: number, cacheRead: number, output: number, cacheWrite = 0) => {
        if (model === "unknown") return null;
        return input + cacheRead + output + cacheWrite;
      },
    );

    expect(
      buildAnalyticsCostSeries(baseAnalytics, "directApi", 0.04, computeWholesaleCost),
    ).toEqual([
      { date: "2026-01-01", cost: 120 },
      { date: "2026-01-02", cost: 185 },
    ]);
    expect(computeWholesaleCost).toHaveBeenCalledWith("claude-opus-4.6", 100, 25, 50, 10);
    expect(computeWholesaleCost).toHaveBeenCalledWith("gpt-5.4", 80, 0, 40, 0);
  });
});

describe("buildAnalyticsAiCreditSummary", () => {
  it("merges observed AIC with estimates only for uncovered historical tokens", () => {
    const data: AnalyticsData = {
      ...baseAnalytics,
      totalNanoAiu: 2_000_000_000,
      sessionsWithObservedAiCredits: 1,
      modelDistribution: [
        {
          model: "gpt-5.4",
          tokens: 300,
          percentage: 100,
          inputTokens: 200,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          premiumRequests: 0,
          requestCount: 1,
          totalNanoAiu: 2_000_000_000,
          unobservedInputTokens: 50,
          unobservedOutputTokens: 25,
          unobservedCacheReadTokens: 0,
          unobservedCacheWriteTokens: 0,
        },
      ],
    };
    const usageCost = vi.fn(() => 0.01);
    const directCost = vi.fn(() => 10);

    expect(buildAnalyticsAiCreditSummary(data, usageCost, directCost)).toEqual({
      credits: 3,
      usdEquivalent: 0.03,
      source: "mixed-observed-estimated",
      observedCredits: 2,
      estimatedCredits: 1,
      isPartial: false,
    });
    expect(usageCost).toHaveBeenCalledWith("gpt-5.4", 50, 0, 25, 0);
    expect(directCost).not.toHaveBeenCalled();
  });

  it("uses direct API rates as the final estimate fallback", () => {
    const data: AnalyticsData = {
      ...baseAnalytics,
      modelDistribution: [
        {
          model: "custom",
          tokens: 100,
          percentage: 100,
          inputTokens: 60,
          outputTokens: 40,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          premiumRequests: 5,
          requestCount: 1,
        },
      ],
    };
    const summary = buildAnalyticsAiCreditSummary(
      data,
      () => null,
      () => 0.05,
    );
    expect(summary.credits).toBe(5);
    expect(summary.source).toBe("estimated-direct-api");
  });
});

describe("cost split by source", () => {
  const priced = vi.fn(() => 1);
  const claudeUsage = {
    model: "claude-opus-5-5",
    source: "claudeCode" as const,
    inputTokens: 1_000,
    outputTokens: 1_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const mixed: AnalyticsData = {
    ...baseAnalytics,
    modelDistribution: [
      {
        ...claudeUsage,
        tokens: 2_000,
        percentage: 50,
        premiumRequests: 0,
        requestCount: 1,
        costUsd: 4.2,
      },
      {
        model: "gpt-5.4",
        source: "copilot",
        tokens: 2_000,
        percentage: 50,
        inputTokens: 1_000,
        outputTokens: 1_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        premiumRequests: 1,
        requestCount: 1,
      },
    ],
    modelUsageByDay: [
      { date: "2026-01-01", ...claudeUsage },
      { ...claudeUsage, date: "2026-01-02", model: "gpt-5.4", source: "copilot" },
    ],
    costBySource: [
      { source: "copilot", sessions: 3, tokens: 2_000, costUsd: null, sessionsWithCostUsd: 0 },
      { source: "claudeCode", sessions: 2, tokens: 2_000, costUsd: 4.2, sessionsWithCostUsd: 1 },
    ],
    costUsdByDay: [{ date: "2026-01-01", cost: 4.2 }],
  };

  it("never estimates AI Credits from a source billed in USD", () => {
    priced.mockClear();
    const summary = buildAnalyticsAiCreditSummary(mixed, priced, priced);
    expect(priced).toHaveBeenCalledTimes(1);
    expect(priced).toHaveBeenCalledWith("gpt-5.4", 1_000, 0, 1_000, 0);
    expect(summary.estimatedCredits).toBeCloseTo(1 / 0.01);

    const trend = buildAnalyticsCostSeries(mixed, "aiCredits", 0.04, priced, priced);
    expect(trend.map((point) => point.date)).toEqual(["2026-01-02"]);
  });

  it("charts provider USD as its own series", () => {
    expect(buildAnalyticsCostSeries(mixed, "usd", 0.04, priced)).toEqual([
      { date: "2026-01-01", cost: 4.2 },
    ]);
  });

  it("keeps each source's own unit beside its USD value and flags a partial total", () => {
    const summary = buildAnalyticsAiCreditSummary(mixed, priced, priced);
    const rows = buildSourceCostRows(mixed, summary);
    expect(rows).toEqual([
      expect.objectContaining({
        source: "copilot",
        unit: "aic",
        amount: summary.credits,
        usdEquivalent: summary.usdEquivalent,
      }),
      expect.objectContaining({
        source: "claudeCode",
        unit: "usd",
        amount: 4.2,
        usdEquivalent: 4.2,
        partial: true,
      }),
    ]);
  });

  it("charts every source on one USD series, AI Credits at $0.01 each", () => {
    // gpt-5.4 on Jan 2 is priced at $1 (100 AIC); Claude Code has $4.20 on Jan 1.
    expect(buildCombinedCostSeries(mixed, priced, priced)).toEqual([
      { date: "2026-01-01", cost: 4.2, aiCreditsUsd: 0, sourceUsd: 4.2 },
      {
        date: "2026-01-02",
        cost: expect.closeTo(1),
        aiCreditsUsd: expect.closeTo(1),
        sourceUsd: 0,
      },
    ]);
  });

  it("adds both halves of a day both sources were used", () => {
    const sameDay = {
      ...mixed,
      costUsdByDay: [
        { date: "2026-01-02", cost: 0.5 },
        { date: "2026-01-03", cost: 0.25 },
      ],
    };
    const points = buildCombinedCostSeries(sameDay, priced, priced);
    expect(points.map((p) => p.date)).toEqual(["2026-01-02", "2026-01-03"]);
    expect(points[0].cost).toBeCloseTo(1.5);
    expect(points[0].aiCreditsUsd + points[0].sourceUsd).toBeCloseTo(points[0].cost);
    expect(points[1]).toEqual({ date: "2026-01-03", cost: 0.25, aiCreditsUsd: 0, sourceUsd: 0.25 });
  });

  it("uses observed AI Credits in the combined series", () => {
    const observed = {
      ...mixed,
      modelUsageByDay: [
        {
          ...claudeUsage,
          date: "2026-01-02",
          model: "gpt-5.4",
          source: "copilot" as const,
          totalNanoAiu: 2_000_000_000,
        },
      ],
      costUsdByDay: [],
    };
    const never = vi.fn(() => null);
    expect(buildCombinedCostSeries(observed, never, never)).toEqual([
      { date: "2026-01-02", cost: 0.02, aiCreditsUsd: 0.02, sourceUsd: 0 },
    ]);
    expect(never).not.toHaveBeenCalled();
  });
});

describe("combinedCostTotal", () => {
  const row = (overrides: Partial<SourceCostRow>): SourceCostRow => ({
    source: "copilot",
    sessions: 1,
    tokens: 1,
    unit: "aic",
    amount: 100,
    usdEquivalent: 1,
    partial: false,
    ...overrides,
  });

  it("sums every source's USD value", () => {
    expect(
      combinedCostTotal([
        row({}),
        row({ source: "claudeCode", unit: "usd", amount: 2.5, usdEquivalent: 2.5 }),
      ]),
    ).toEqual({ usd: 3.5, partial: false });
  });

  it("is partial when a source is partly priced or has sessions but no price", () => {
    expect(combinedCostTotal([row({}), row({ source: "claudeCode", partial: true })]).partial).toBe(
      true,
    );
    expect(
      combinedCostTotal([
        row({}),
        row({ source: "claudeCode", amount: null, usdEquivalent: null }),
      ]),
    ).toEqual({ usd: 1, partial: true });
  });

  it("is null, not $0, when nothing is priced", () => {
    expect(combinedCostTotal([row({ amount: null, usdEquivalent: null })])).toEqual({
      usd: null,
      partial: true,
    });
    expect(combinedCostTotal([])).toEqual({ usd: null, partial: false });
  });
});
