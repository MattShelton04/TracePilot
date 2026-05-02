import type { AnalyticsData, CodeImpactData, ToolAnalysisData } from "@tracepilot/types";

import { NOW } from "./common.js";

export const MOCK_ANALYTICS: AnalyticsData = {
  totalSessions: 47,
  totalTokens: 223_500,
  totalCost: 124.75,
  totalPremiumRequests: 42,
  tokenUsageByDay: Array.from({ length: 7 }, (_, i) => ({
    date: new Date(new Date(NOW).getTime() - (6 - i) * 86_400_000).toISOString().split("T")[0],
    tokens: 20_000 + i * 2_500,
  })),
  activityPerDay: Array.from({ length: 7 }, (_, i) => ({
    date: new Date(new Date(NOW).getTime() - (6 - i) * 86_400_000).toISOString().split("T")[0],
    count: 6 + i,
  })),
  modelDistribution: [
    {
      model: "gpt-5.4",
      tokens: 120_000,
      percentage: 53.7,
      inputTokens: 82_000,
      outputTokens: 38_000,
      cacheReadTokens: 4_200,
      premiumRequests: 24,
      requestCount: 46,
    },
    {
      model: "claude-opus-4.6",
      tokens: 103_500,
      percentage: 46.3,
      inputTokens: 70_000,
      outputTokens: 33_500,
      cacheReadTokens: 3_100,
      premiumRequests: 18,
      requestCount: 39,
    },
  ],
  costByDay: Array.from({ length: 7 }, (_, i) => ({
    date: new Date(new Date(NOW).getTime() - (6 - i) * 86_400_000).toISOString().split("T")[0],
    cost: 12 + i * 1.5,
  })),
  apiDurationStats: {
    avgMs: 480,
    medianMs: 410,
    p95Ms: 920,
    minMs: 140,
    maxMs: 1_400,
    totalSessionsWithDuration: 44,
  },
  productivityMetrics: {
    avgTurnsPerSession: 68.3,
    avgToolCallsPerTurn: 1.8,
    avgTokensPerTurn: 1_540,
    avgTokensPerApiSecond: 420,
  },
  cacheStats: {
    totalCacheReadTokens: 7_300,
    totalInputTokens: 152_000,
    cacheHitRate: 4.8,
    nonCachedInputTokens: 144_700,
  },
  sessionsWithErrors: 6,
  totalRateLimits: 9,
  totalCompactions: 14,
  totalTruncations: 3,
  incidentsByDay: [
    { date: "2026-03-15", errors: 1, rateLimits: 1, compactions: 2, truncations: 0 },
    { date: "2026-03-16", errors: 0, rateLimits: 0, compactions: 3, truncations: 1 },
    { date: "2026-03-17", errors: 2, rateLimits: 2, compactions: 1, truncations: 0 },
    { date: "2026-03-18", errors: 0, rateLimits: 0, compactions: 4, truncations: 1 },
    { date: "2026-03-19", errors: 1, rateLimits: 1, compactions: 2, truncations: 0 },
  ],
};

function deterministicHeatmap(length: number): { day: number; hour: number; count: number }[] {
  return Array.from({ length }, (_, i) => ({
    day: Math.floor(i / 24),
    hour: i % 24,
    count: (i * 3 + 7) % 16,
  }));
}

export const MOCK_TOOL_ANALYSIS: ToolAnalysisData = {
  totalCalls: 127,
  successRate: 0.945,
  avgDurationMs: 1200,
  mostUsedTool: "powershell",
  tools: [
    { name: "edit", callCount: 34, successRate: 0.98, avgDurationMs: 450, totalDurationMs: 15_300 },
    { name: "view", callCount: 27, successRate: 0.99, avgDurationMs: 120, totalDurationMs: 3_240 },
    {
      name: "create",
      callCount: 18,
      successRate: 0.95,
      avgDurationMs: 380,
      totalDurationMs: 6_840,
    },
    {
      name: "powershell",
      callCount: 22,
      successRate: 0.88,
      avgDurationMs: 2_100,
      totalDurationMs: 46_200,
    },
    { name: "grep", callCount: 11, successRate: 0.97, avgDurationMs: 340, totalDurationMs: 3_740 },
    { name: "glob", callCount: 8, successRate: 0.99, avgDurationMs: 180, totalDurationMs: 1_440 },
    {
      name: "task",
      callCount: 7,
      successRate: 0.91,
      avgDurationMs: 8_500,
      totalDurationMs: 59_500,
    },
  ],
  activityHeatmap: deterministicHeatmap(168),
};

export const MOCK_CODE_IMPACT: CodeImpactData = {
  filesModified: 18,
  linesAdded: 640,
  linesRemoved: 210,
  netChange: 430,
  fileTypeBreakdown: [
    { extension: ".ts", count: 7, percentage: 38.9 },
    { extension: ".vue", count: 4, percentage: 22.2 },
    { extension: ".css", count: 3, percentage: 16.7 },
    { extension: ".json", count: 2, percentage: 11.1 },
    { extension: ".md", count: 2, percentage: 11.1 },
  ],
  mostModifiedFiles: [
    { path: "apps/desktop/src/stores/search.ts", additions: 180, deletions: 60 },
    { path: "apps/desktop/src/utils/logger.ts", additions: 90, deletions: 30 },
    { path: "apps/desktop/src/views/SessionDetailView.vue", additions: 70, deletions: 20 },
    { path: "packages/ui/src/components/StatCard.vue", additions: 60, deletions: 15 },
    { path: "packages/client/src/index.ts", additions: 40, deletions: 10 },
  ],
  changesByDay: Array.from({ length: 14 }, (_, i) => ({
    date: new Date(new Date(NOW).getTime() - (13 - i) * 86_400_000).toISOString().split("T")[0],
    additions: 40 + i * 5,
    deletions: 12 + i,
  })),
};
