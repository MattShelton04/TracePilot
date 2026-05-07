import type { AnalyticsData, CodeImpactData, ToolAnalysisData } from "@tracepilot/types";

export const FIXTURE_ANALYTICS: AnalyticsData = {
  totalSessions: 10,
  totalTokens: 2_500_000,
  totalCost: 5.5,
  totalPremiumRequests: 40,
  tokenUsageByDay: [
    { date: "2025-01-01", tokens: 100_000 },
    { date: "2025-01-02", tokens: 150_000 },
    { date: "2025-01-03", tokens: 200_000 },
  ],
  activityPerDay: [
    { date: "2025-01-01", count: 3 },
    { date: "2025-01-02", count: 4 },
    { date: "2025-01-03", count: 3 },
  ],
  modelDistribution: [
    {
      model: "gpt-4",
      tokens: 1_500_000,
      percentage: 60,
      inputTokens: 750_000,
      outputTokens: 750_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      premiumRequests: 24,
      requestCount: 180,
    },
    {
      model: "claude-3",
      tokens: 1_000_000,
      percentage: 40,
      inputTokens: 500_000,
      outputTokens: 500_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      premiumRequests: 16,
      requestCount: 120,
    },
  ],
  costByDay: [
    { date: "2025-01-01", cost: 1.5 },
    { date: "2025-01-02", cost: 2.0 },
    { date: "2025-01-03", cost: 2.0 },
  ],
  modelUsageByDay: [
    {
      date: "2025-01-01",
      model: "gpt-4",
      inputTokens: 250_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    {
      date: "2025-01-02",
      model: "gpt-4",
      inputTokens: 300_000,
      outputTokens: 250_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    {
      date: "2025-01-03",
      model: "claude-3",
      inputTokens: 500_000,
      outputTokens: 500_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  ],
  apiDurationStats: {
    avgMs: 1_800_000,
    medianMs: 1_200_000,
    p95Ms: 5_400_000,
    minMs: 120_000,
    maxMs: 7_200_000,
    totalSessionsWithDuration: 8,
  },
  productivityMetrics: {
    avgTurnsPerSession: 8.5,
    avgToolCallsPerTurn: 4.2,
    avgTokensPerTurn: 60_489,
    avgTokensPerApiSecond: 3_420,
  },
  cacheStats: {
    totalCacheReadTokens: 300_000,
    totalInputTokens: 1_250_000,
    cacheHitRate: 24.0,
    nonCachedInputTokens: 950_000,
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
  activityHeatmap: [
    { day: 0, hour: 10, count: 5 },
    { day: 1, hour: 14, count: 3 },
  ],
};

export const FIXTURE_CODE_IMPACT: CodeImpactData = {
  filesModified: 15,
  linesAdded: 1000,
  linesRemoved: 300,
  netChange: 700,
  fileTypeBreakdown: [
    { extension: ".ts", count: 10, percentage: 66.7 },
    { extension: ".vue", count: 5, percentage: 33.3 },
  ],
  mostModifiedFiles: [
    { path: "src/index.ts", additions: 100, deletions: 30 },
    { path: "src/App.vue", additions: 80, deletions: 20 },
  ],
  changesByDay: [
    { date: "2025-01-01", additions: 200, deletions: 60 },
    { date: "2025-01-02", additions: 300, deletions: 80 },
    { date: "2025-01-03", additions: 500, deletions: 160 },
  ],
};
