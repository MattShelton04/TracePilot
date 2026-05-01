import type {
  CheckpointEntry,
  ConversationTurn,
  EventsResponse,
  SessionDetail,
  SessionListItem,
  ShutdownMetrics,
  TodosResponse,
} from "@tracepilot/types";

import { NOW, NOW_MS, ONE_HOUR, ts } from "./common.js";

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
