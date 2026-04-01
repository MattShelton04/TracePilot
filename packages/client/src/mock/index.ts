import type {
  AnalyticsData,
  CheckpointEntry,
  CodeImpactData,
  ConversationTurn,
  EventsResponse,
  ExportResult,
  HealthScoringData,
  SessionDetail,
  SessionListItem,
  ShutdownMetrics,
  TodosResponse,
  ToolAnalysisData,
} from "@tracepilot/types";

// Deterministic timestamps keep tests and snapshots stable.
const NOW = "2026-03-20T12:00:00.000Z";
const NOW_MS = new Date(NOW).getTime();
const ONE_HOUR = 3_600_000;

/** Offset NOW by `ms` milliseconds and return an ISO string. */
function ts(ms: number): string {
  return new Date(NOW_MS + ms).toISOString();
}

export const MOCK_SESSIONS: SessionListItem[] = [
  {
    id: "sess-auth-refactor",
    summary: "Auth plugin refactor",
    repository: "tracepilot/app",
    branch: "main",
    hostType: "cli",
    eventCount: 240,
    turnCount: 8,
    currentModel: "gpt-5.4",
    createdAt: new Date(new Date(NOW).getTime() - ONE_HOUR * 36).toISOString(),
    updatedAt: new Date(new Date(NOW).getTime() - ONE_HOUR * 2).toISOString(),
    isRunning: false,
    errorCount: 1,
    rateLimitCount: 0,
    compactionCount: 1,
    truncationCount: 0,
  },
  {
    id: "sess-search-polish",
    summary: "Search preset cleanup",
    repository: "tracepilot/app",
    branch: "feature/search",
    hostType: "cli",
    eventCount: 120,
    turnCount: 4,
    currentModel: "claude-opus-4.6",
    createdAt: new Date(new Date(NOW).getTime() - ONE_HOUR * 72).toISOString(),
    updatedAt: new Date(new Date(NOW).getTime() - ONE_HOUR * 4).toISOString(),
    isRunning: false,
  },
  {
    id: "sess-export-markdown",
    summary: "Markdown export polish",
    repository: "tracepilot/app",
    branch: "docs/export",
    hostType: "cli",
    eventCount: 75,
    turnCount: 3,
    currentModel: "gpt-4.1",
    createdAt: new Date(new Date(NOW).getTime() - ONE_HOUR * 96).toISOString(),
    updatedAt: new Date(new Date(NOW).getTime() - ONE_HOUR * 6).toISOString(),
    isRunning: false,
  },
];

export function getMockSessionDetail(sessionId: string): SessionDetail {
  return {
    id: sessionId,
    summary: "Mock session detail",
    repository: "tracepilot/app",
    branch: "main",
    cwd: "/home/user/project",
    hostType: "cli",
    eventCount: 240,
    turnCount: 8,
    hasPlan: true,
    hasCheckpoints: true,
    checkpointCount: 2,
    createdAt: new Date(new Date(NOW).getTime() - ONE_HOUR * 36).toISOString(),
    updatedAt: new Date(new Date(NOW).getTime() - ONE_HOUR * 2).toISOString(),
  };
}

export const MOCK_TURNS: ConversationTurn[] = [
  {
    turnIndex: 0,
    userMessage: "Please refactor the auth module into plugins and keep JWT refresh working.",
    assistantMessages: [
      {
        content:
          "I'll design a plugin registry and ensure refresh tokens remain backward compatible.",
      },
    ],
    model: "gpt-5.4",
    isComplete: true,
    reasoningTexts: [
      {
        content:
          "The auth module has tight coupling between JWT refresh logic and the login handler. I should extract a plugin interface so providers can be swapped without touching the core refresh flow.",
      },
    ],
    toolCalls: [
      {
        toolCallId: "edit-auth",
        toolName: "edit",
        success: true,
        isComplete: true,
        startedAt: ts(0),
        completedAt: ts(320),
        durationMs: 320,
        intentionSummary: "Refactor auth login to use plugin",
        arguments: { path: "src/auth/login.ts", intention: "convert to plugin" },
        resultContent: "Applied plugin wrapper to login.ts",
      },
      {
        toolCallId: "grep-oauth",
        toolName: "grep",
        success: true,
        isComplete: true,
        startedAt: ts(400),
        completedAt: ts(440),
        durationMs: 40,
        intentionSummary: "Find OAuth usage",
        arguments: { pattern: "oauth", path: "src/auth" },
        resultContent: "src/auth/oauth.ts:12: export const OAUTH_PROVIDERS = ['github', 'google'];",
      },
    ],
  },
  {
    turnIndex: 1,
    userMessage: "Add search preset coverage and avoid duplicate searches.",
    assistantMessages: [
      {
        content:
          "I'll consolidate browse presets and ensure only one search triggers after hydration.",
      },
    ],
    model: "claude-opus-4.6",
    isComplete: true,
    toolCalls: [
      {
        toolCallId: "edit-search",
        toolName: "edit",
        success: true,
        isComplete: true,
        startedAt: ts(5000),
        completedAt: ts(5280),
        durationMs: 280,
        intentionSummary: "Consolidate presets",
        arguments: { path: "apps/desktop/src/stores/search.ts" },
        resultContent: "Added applyBrowsePreset helper",
      },
      {
        toolCallId: "test-search",
        toolName: "powershell",
        success: true,
        isComplete: true,
        startedAt: ts(5400),
        completedAt: ts(6600),
        durationMs: 1200,
        intentionSummary: "Run search tests",
        arguments: { command: "pnpm --filter @tracepilot/desktop test -- search" },
        resultContent: "All 22 search preset tests passed",
      },
    ],
  },
  {
    turnIndex: 2,
    userMessage: "Export a session to Markdown for the docs page.",
    assistantMessages: [
      { content: "Rendering Markdown with metadata, turns, tool calls, and events." },
    ],
    model: "gpt-4.1",
    isComplete: true,
    toolCalls: [
      {
        toolCallId: "render-md",
        toolName: "task",
        success: true,
        isComplete: true,
        startedAt: ts(10000),
        completedAt: ts(10900),
        durationMs: 900,
        intentionSummary: "Render markdown export",
        arguments: { sessionId: "sess-export-markdown" },
        resultContent: "Exported markdown to /tmp/export.md",
      },
      {
        toolCallId: "sql-check",
        toolName: "sql",
        success: true,
        isComplete: true,
        startedAt: ts(11000),
        completedAt: ts(11050),
        durationMs: 50,
        intentionSummary: "Verify session count",
        arguments: { query: "select count(*) from sessions" },
        resultContent: "| count |\n| --- |\n| 47 |",
      },
    ],
  },
  {
    turnIndex: 3,
    userMessage: "Explore the test suite and verify nothing is broken.",
    assistantMessages: [{ content: "Launching an explore agent to scan the test suite." }],
    model: "gpt-5.4",
    isComplete: true,
    toolCalls: [
      {
        toolCallId: "explore-agent",
        toolName: "task",
        isSubagent: true,
        agentDisplayName: "Explore Agent",
        agentDescription: "Fast codebase exploration agent",
        success: true,
        isComplete: true,
        startedAt: ts(15000),
        completedAt: ts(23500),
        durationMs: 8500,
        intentionSummary: "Scan test suite for regressions",
        arguments: { prompt: "Check all test files for failures" },
        resultContent: "All 47 test files pass. No regressions found.",
      },
      {
        toolCallId: "explore-grep",
        toolName: "grep",
        parentToolCallId: "explore-agent",
        success: true,
        isComplete: true,
        startedAt: ts(15200),
        completedAt: ts(15500),
        durationMs: 300,
        intentionSummary: "Find test files",
        arguments: { pattern: "\\.test\\.ts$", path: "src" },
        resultContent: "Found 47 test files",
      },
      {
        toolCallId: "explore-run-tests",
        toolName: "powershell",
        parentToolCallId: "explore-agent",
        success: true,
        isComplete: true,
        startedAt: ts(15600),
        completedAt: ts(23000),
        durationMs: 7400,
        intentionSummary: "Run full test suite",
        arguments: { command: "pnpm test" },
        resultContent: "47 test suites passed, 0 failed",
      },
    ],
  },
];

export const MOCK_EVENTS: EventsResponse = {
  events: [
    {
      id: "evt-1",
      eventType: "session.start",
      timestamp: new Date(NOW_MS - ONE_HOUR * 3).toISOString(),
      data: { summary: "Session launched", severity: "info" },
    },
    {
      id: "evt-2",
      eventType: "session.error",
      timestamp: new Date(NOW_MS - ONE_HOUR * 2).toISOString(),
      data: { summary: "Refresh token invalid", severity: "error", code: "INVALID_REFRESH" },
    },
    {
      id: "evt-3",
      eventType: "session.compaction_complete",
      timestamp: new Date(NOW_MS - ONE_HOUR).toISOString(),
      data: { summary: "Compaction reduced tokens 42000 → 12000", severity: "info" },
    },
  ],
  totalCount: 3,
  hasMore: false,
  allEventTypes: ["session.start", "session.error", "session.compaction_complete"],
};

export const MOCK_TODOS: TodosResponse = {
  todos: [
    { id: "todo-1", title: "Add GitHub auth provider", status: "in_progress" },
    { id: "todo-2", title: "Write browse preset tests", status: "done" },
  ],
  deps: [],
};

export const MOCK_CHECKPOINTS: CheckpointEntry[] = [
  {
    number: 1,
    title: "Auth plugin scaffolded",
    filename: "checkpoint-1.md",
    content: "Created plugin registry",
  },
  {
    number: 2,
    title: "Search presets consolidated",
    filename: "checkpoint-2.md",
    content: "applyBrowsePreset added",
  },
];

export const MOCK_SHUTDOWN_METRICS: ShutdownMetrics = {
  shutdownType: "graceful",
  shutdownCount: 1,
  totalPremiumRequests: 12,
  totalApiDurationMs: 12_500,
  sessionStartTime: Date.parse(NOW) - ONE_HOUR * 4,
  currentModel: "gpt-5.4",
  codeChanges: {
    filesModified: [
      "apps/desktop/src/stores/search.ts",
      "apps/desktop/src/utils/logger.ts",
      "packages/client/src/index.ts",
    ],
    linesAdded: 640,
    linesRemoved: 210,
  },
  modelMetrics: {
    "gpt-5.4": {
      requests: { count: 24, cost: 58.5 },
      usage: {
        inputTokens: 25_000,
        outputTokens: 9_500,
        cacheReadTokens: 1_200,
        cacheWriteTokens: 0,
      },
    },
    "claude-opus-4.6": {
      requests: { count: 18, cost: 42.3 },
      usage: {
        inputTokens: 18_400,
        outputTokens: 7_900,
        cacheReadTokens: 900,
        cacheWriteTokens: 0,
      },
    },
  },
  sessionSegments: [
    {
      startTimestamp: new Date(new Date(NOW).getTime() - ONE_HOUR * 4).toISOString(),
      endTimestamp: new Date(new Date(NOW).getTime() - ONE_HOUR * 2).toISOString(),
      tokens: 20_000,
      totalRequests: 20,
      premiumRequests: 6,
      apiDurationMs: 7_200,
      currentModel: "gpt-5.4",
      modelMetrics: {
        "gpt-5.4": {
          requests: { count: 20, cost: 32 },
          usage: {
            inputTokens: 14_000,
            outputTokens: 6_000,
            cacheReadTokens: 600,
            cacheWriteTokens: 0,
          },
        },
      },
    },
    {
      startTimestamp: new Date(new Date(NOW).getTime() - ONE_HOUR * 2).toISOString(),
      endTimestamp: NOW,
      tokens: 41_700,
      totalRequests: 22,
      premiumRequests: 6,
      apiDurationMs: 5_300,
      currentModel: "claude-opus-4.6",
      modelMetrics: {
        "claude-opus-4.6": {
          requests: { count: 22, cost: 34.8 },
          usage: {
            inputTokens: 26_300,
            outputTokens: 13_400,
            cacheReadTokens: 1_200,
            cacheWriteTokens: 0,
          },
        },
      },
    },
  ],
};

export const MOCK_ANALYTICS: AnalyticsData = {
  totalSessions: 47,
  totalTokens: 223_500,
  totalCost: 124.75,
  totalPremiumRequests: 42,
  averageHealthScore: 0.76,
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
  healthDistribution: { healthyCount: 32, attentionCount: 11, criticalCount: 4 },
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

export const MOCK_HEALTH_SCORING: HealthScoringData = {
  overallScore: 0.73,
  healthyCount: 5,
  attentionCount: 3,
  criticalCount: 1,
  attentionSessions: [
    {
      sessionId: "sess-auth-refactor",
      sessionName: "Auth refactor",
      score: 0.62,
      flags: [{ name: "High retry rate", severity: "warning" }],
    },
    {
      sessionId: "sess-search-polish",
      sessionName: "Search polish",
      score: 0.71,
      flags: [{ name: "Excessive tool calls", severity: "warning" }],
    },
  ],
  healthFlags: [
    {
      name: "High retry rate",
      count: 4,
      severity: "warning",
      description: "Session had more than 3 consecutive retries",
    },
    {
      name: "Many errors",
      count: 2,
      severity: "danger",
      description: "More than 10 tool call failures",
    },
    {
      name: "High token usage",
      count: 3,
      severity: "warning",
      description: "Token usage exceeded 500K",
    },
    {
      name: "Low success rate",
      count: 1,
      severity: "warning",
      description: "Tool success rate below 85%",
    },
  ],
};

export const MOCK_EXPORT_RESULT: ExportResult = {
  sessionsExported: 1,
  filePath: "/tmp/tracepilot-export.json",
  fileSizeBytes: 12345,
  exportedAt: NOW,
};
