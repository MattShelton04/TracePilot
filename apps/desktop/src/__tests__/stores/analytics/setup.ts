import { setupPinia } from "@tracepilot/test-utils";
import type { AnalyticsData, CodeImpactData, ToolAnalysisData } from "@tracepilot/types";
import { beforeEach, vi } from "vitest";

const hoistedMocks = vi.hoisted(() => ({
  getAnalytics: vi.fn(),
  getToolAnalysis: vi.fn(),
  getCodeImpact: vi.fn(),
}));

export const mocks = hoistedMocks;

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getAnalytics: (...args: unknown[]) => hoistedMocks.getAnalytics(...args),
    getToolAnalysis: (...args: unknown[]) => hoistedMocks.getToolAnalysis(...args),
    getCodeImpact: (...args: unknown[]) => hoistedMocks.getCodeImpact(...args),
  });
});

export const FIXTURE_ANALYTICS: AnalyticsData = {
  totalSessions: 10,
  totalTokens: 500_000,
  totalCost: 5.0,
  totalPremiumRequests: 25,
  averageHealthScore: 0.8,
  tokenUsageByDay: [{ date: "2025-01-01", tokens: 50_000 }],
  activityPerDay: [{ date: "2025-01-01", count: 3 }],
  modelDistribution: [
    {
      model: "gpt-4",
      tokens: 500_000,
      percentage: 100,
      inputTokens: 250_000,
      outputTokens: 250_000,
      cacheReadTokens: 0,
      premiumRequests: 5,
      requestCount: 50,
    },
  ],
  costByDay: [{ date: "2025-01-01", cost: 5.0 }],
  apiDurationStats: {
    avgMs: 1_000_000,
    medianMs: 900_000,
    p95Ms: 2_000_000,
    minMs: 100_000,
    maxMs: 3_000_000,
    totalSessionsWithDuration: 10,
  },
  productivityMetrics: {
    avgTurnsPerSession: 5.0,
    avgToolCallsPerTurn: 3.0,
    avgTokensPerTurn: 10_000,
    avgTokensPerApiSecond: 2_500,
  },
  cacheStats: {
    totalCacheReadTokens: 50_000,
    totalInputTokens: 250_000,
    cacheHitRate: 20.0,
    nonCachedInputTokens: 200_000,
  },
  healthDistribution: {
    healthyCount: 7,
    attentionCount: 2,
    criticalCount: 1,
  },
  sessionsWithErrors: 2,
  totalRateLimits: 3,
  totalCompactions: 5,
  totalTruncations: 1,
  incidentsByDay: [
    { date: "2026-03-18", errors: 1, rateLimits: 1, compactions: 3, truncations: 1 },
    { date: "2026-03-19", errors: 1, rateLimits: 2, compactions: 2, truncations: 0 },
  ],
};

export const FIXTURE_TOOL_ANALYSIS: ToolAnalysisData = {
  totalCalls: 50,
  successRate: 0.95,
  avgDurationMs: 500,
  mostUsedTool: "edit",
  tools: [
    { name: "edit", callCount: 30, successRate: 0.97, avgDurationMs: 400, totalDurationMs: 12_000 },
    { name: "view", callCount: 20, successRate: 0.92, avgDurationMs: 650, totalDurationMs: 13_000 },
  ],
  activityHeatmap: [{ day: 0, hour: 10, count: 5 }],
};

export const FIXTURE_CODE_IMPACT: CodeImpactData = {
  filesModified: 15,
  linesAdded: 1000,
  linesRemoved: 300,
  netChange: 700,
  fileTypeBreakdown: [{ extension: ".ts", count: 10, percentage: 66.7 }],
  mostModifiedFiles: [{ path: "src/index.ts", additions: 100, deletions: 30 }],
  changesByDay: [{ date: "2025-01-01", additions: 200, deletions: 60 }],
};

beforeEach(() => {
  setupPinia();
  vi.clearAllMocks();
});
