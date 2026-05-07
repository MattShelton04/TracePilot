import type { AnalyticsData } from "@tracepilot/types";
import { describe, expect, it, vi } from "vitest";
import { buildAnalyticsCostSeries } from "../analyticsCostSeries";

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
