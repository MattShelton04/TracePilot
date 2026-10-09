import type { AnalyticsData, ToolAnalysisData } from "@tracepilot/types";

import { MOCK_ANALYTICS, MOCK_TOOL_ANALYSIS } from "./analytics.js";
import { NOW } from "./common.js";

// Analytics filtered to Claude Code: priced in USD from per-run segments,
// never in AI Credits. The unfiltered mocks stay Copilot-only so visual
// captures of Copilot views are unaffected.

const day = (offset: number) =>
  new Date(new Date(NOW).getTime() - offset * 86_400_000).toISOString().split("T")[0];

const OPUS = {
  model: "claude-opus-5-5",
  source: "claudeCode" as const,
  tokens: 152_000,
  percentage: 84.4,
  inputTokens: 148_400,
  outputTokens: 3_600,
  cacheReadTokens: 132_000,
  cacheWriteTokens: 14_000,
  premiumRequests: 0,
  requestCount: 41,
  costUsd: 3.85,
};

const HAIKU = {
  model: "claude-haiku-4-5-20251001",
  source: "claudeCode" as const,
  tokens: 28_000,
  percentage: 15.6,
  inputTokens: 27_200,
  outputTokens: 800,
  cacheReadTokens: 21_000,
  cacheWriteTokens: 5_000,
  premiumRequests: 0,
  requestCount: 0,
  costUsd: null,
};

export const MOCK_CLAUDE_ANALYTICS: AnalyticsData = {
  ...MOCK_ANALYTICS,
  totalSessions: 3,
  totalTokens: 180_000,
  totalCost: 0,
  totalPremiumRequests: 0,
  totalNanoAiu: 0,
  sessionsWithObservedAiCredits: 0,
  tokenUsageByDay: [
    { date: day(2), tokens: 62_000 },
    { date: day(1), tokens: 71_000 },
    { date: day(0), tokens: 47_000 },
  ],
  activityPerDay: [
    { date: day(2), count: 1 },
    { date: day(1), count: 2 },
    { date: day(0), count: 1 },
  ],
  modelDistribution: [OPUS, HAIKU],
  costByDay: [],
  modelUsageByDay: [],
  costBySource: [
    { source: "claudeCode", sessions: 3, tokens: 180_000, costUsd: 3.85, sessionsWithCostUsd: 2 },
  ],
  costUsdByDay: [
    { date: day(2), cost: 1.4 },
    { date: day(1), cost: 1.65 },
    { date: day(0), cost: 0.8 },
  ],
  cacheStats: {
    totalCacheReadTokens: 153_000,
    totalInputTokens: 175_600,
    cacheHitRate: 87.1,
    nonCachedInputTokens: 22_600,
  },
};

export const MOCK_CLAUDE_TOOL_ANALYSIS: ToolAnalysisData = {
  ...MOCK_TOOL_ANALYSIS,
  totalCalls: 46,
  successRate: 0.93,
  avgDurationMs: 640,
  mostUsedTool: "shell",
  tools: [
    {
      name: "shell",
      callCount: 18,
      successRate: 0.89,
      avgDurationMs: 1_100,
      totalDurationMs: 19_800,
      nativeTools: [
        {
          name: "Bash",
          source: "claudeCode",
          callCount: 15,
          successRate: 0.87,
          avgDurationMs: 1_050,
        },
        {
          name: "PowerShell",
          source: "claudeCode",
          callCount: 3,
          successRate: 1,
          avgDurationMs: 1_350,
        },
      ],
    },
    {
      name: "view",
      callCount: 16,
      successRate: 1,
      avgDurationMs: 90,
      totalDurationMs: 1_440,
      nativeTools: [
        { name: "Read", source: "claudeCode", callCount: 16, successRate: 1, avgDurationMs: 90 },
      ],
    },
    {
      name: "edit",
      callCount: 9,
      successRate: 0.89,
      avgDurationMs: 200,
      totalDurationMs: 1_800,
      nativeTools: [
        { name: "Edit", source: "claudeCode", callCount: 9, successRate: 0.89, avgDurationMs: 200 },
      ],
    },
    {
      name: "create",
      callCount: 3,
      successRate: 1,
      avgDurationMs: 240,
      totalDurationMs: 720,
      nativeTools: [
        { name: "Write", source: "claudeCode", callCount: 3, successRate: 1, avgDurationMs: 240 },
      ],
    },
  ],
};
