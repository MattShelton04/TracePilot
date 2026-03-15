import type {
  SessionListItem,
  SessionDetail,
  ConversationTurn,
  EventsResponse,
  TodosResponse,
  CheckpointEntry,
  ShutdownMetrics,
  AnalyticsData,
  ToolAnalysisData,
  CodeImpactData,
  HealthScoringData,
  ExportResult,
} from "@tracepilot/types";

// ===== Existing mock data (extracted from index.ts) =====

export const MOCK_SESSIONS: SessionListItem[] = [
  {
    id: "c86fe369-c858-4d91-81da-203c5e276e33",
    summary: "Implemented login feature with OAuth",
    repository: "example/project",
    branch: "main",
    hostType: "cli",
    eventCount: 2450,
    turnCount: 12,
    currentModel: "claude-opus-4.6",
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    summary: "Fixed CSS layout issues",
    repository: "example/frontend",
    branch: "feat/responsive",
    hostType: "cli",
    eventCount: 890,
    turnCount: 5,
    currentModel: "gpt-5.4",
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: "deadbeef-1234-5678-9abc-def012345678",
    summary: "Set up CI/CD pipeline with GitHub Actions",
    repository: "example/infra",
    branch: "devops/ci",
    hostType: "cli",
    eventCount: 4200,
    turnCount: 22,
    currentModel: "claude-sonnet-4.5",
    createdAt: new Date(Date.now() - 604800000).toISOString(),
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

export function getMockSessionDetail(sessionId: string): SessionDetail {
  return {
    id: sessionId,
    summary: "Mock session detail",
    repository: "example/project",
    branch: "main",
    cwd: "/home/user/project",
    hostType: "cli",
    eventCount: 2450,
    turnCount: 12,
    hasPlan: true,
    hasCheckpoints: true,
    checkpointCount: 3,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  };
}

export const MOCK_TURNS: ConversationTurn[] = [
  {
    turnIndex: 0,
    userMessage: "Please implement the login feature with OAuth support. We need GitHub and Google providers.",
    assistantMessages: ["I'll implement the login feature with OAuth support. Let me start by examining the current project structure and setting up the authentication module.\n\nFirst, I'll create the base auth module with JWT token handling, then add the OAuth provider integrations."],
    model: "claude-opus-4.6",
    toolCalls: [
      { toolName: "view", success: true, isComplete: true, durationMs: 120, arguments: { path: "src/auth/index.ts" }, toolCallId: "tc_001", startedAt: new Date(Date.now() - 86398000).toISOString(), completedAt: new Date(Date.now() - 86397880).toISOString() },
      { toolName: "edit", success: true, isComplete: true, durationMs: 340, arguments: { path: "src/auth/login.ts", old_str: "// TODO: implement", new_str: "export async function login(credentials: Credentials) { ... }" }, toolCallId: "tc_002" },
      { toolName: "powershell", success: false, isComplete: true, durationMs: 2100, arguments: { command: "npm test -- --filter auth", description: "Run auth tests" }, error: "Test failed: expected 200 got 401\n  at AuthController.login (src/auth/login.ts:42:15)\n  at Object.<anonymous> (tests/auth.test.ts:28:5)", toolCallId: "tc_003" },
      { toolName: "edit", success: true, isComplete: true, durationMs: 280, arguments: { path: "src/auth/login.ts" }, toolCallId: "tc_004" },
      { toolName: "powershell", success: true, isComplete: true, durationMs: 1800, arguments: { command: "npm test -- --filter auth", description: "Run auth tests" }, toolCallId: "tc_005" },
    ],
    durationMs: 154000,
    isComplete: true,
    timestamp: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    turnIndex: 1,
    userMessage: "Great work! Now add unit tests for the login module and make sure all edge cases are covered.",
    assistantMessages: ["I'll write comprehensive unit tests for the login module. Let me cover the main flows and edge cases including expired tokens, invalid credentials, and rate limiting."],
    model: "claude-opus-4.6",
    toolCalls: [
      { toolName: "view", success: true, isComplete: true, durationMs: 90, arguments: { path: "src/auth/login.ts" }, toolCallId: "tc_010" },
      { toolName: "create", success: true, isComplete: true, durationMs: 450, arguments: { path: "tests/auth.test.ts" }, toolCallId: "tc_011" },
      { toolName: "powershell", success: true, isComplete: true, durationMs: 3200, arguments: { command: "npm test -- --verbose", description: "Run all tests" }, toolCallId: "tc_012" },
      { toolName: "report_intent", success: true, isComplete: true, durationMs: 10, arguments: { intent: "Writing auth tests" }, toolCallId: "tc_013" },
      { toolName: "grep", success: true, isComplete: true, durationMs: 45, arguments: { pattern: "export.*function", path: "src/auth", glob: "*.ts" }, toolCallId: "tc_014" },
      { toolName: "task", success: true, isComplete: true, durationMs: 12000, arguments: { description: "Review auth module", agent_type: "code-review", prompt: "Review auth module for security issues" }, toolCallId: "tc_015" },
    ],
    durationMs: 72000,
    isComplete: true,
    timestamp: new Date(Date.now() - 82800000).toISOString(),
  },
  {
    turnIndex: 2,
    userMessage: "Can you also add the session refresh endpoint?",
    assistantMessages: ["Adding the session refresh endpoint now. This will handle token rotation with sliding window expiry."],
    model: "gpt-5.4",
    toolCalls: [
      { toolName: "edit", success: true, isComplete: true, durationMs: 310, arguments: { path: "src/auth/refresh.ts" }, toolCallId: "tc_020" },
      { toolName: "web_search", success: true, isComplete: true, durationMs: 4500, arguments: { query: "JWT refresh token best practices 2025" }, toolCallId: "tc_021" },
      { toolName: "sql", success: true, isComplete: true, durationMs: 15, arguments: { query: "UPDATE todos SET status = 'done' WHERE id = 'refresh-endpoint'", description: "Mark todo done" }, toolCallId: "tc_022" },
    ],
    durationMs: 28000,
    isComplete: false,
    timestamp: new Date(Date.now() - 79200000).toISOString(),
  },
];

export const MOCK_EVENTS: EventsResponse = {
  events: [
    { eventType: "session.start", timestamp: new Date(Date.now() - 86400000).toISOString(), id: "evt-001", data: {} },
    { eventType: "user.message", timestamp: new Date(Date.now() - 86399000).toISOString(), id: "evt-002", data: {} },
    { eventType: "assistant.turn_start", timestamp: new Date(Date.now() - 86398000).toISOString(), id: "evt-003", data: {} },
    { eventType: "tool.execution_start", timestamp: new Date(Date.now() - 86397000).toISOString(), id: "evt-004", data: {} },
    { eventType: "tool.execution_complete", timestamp: new Date(Date.now() - 86396000).toISOString(), id: "evt-005", data: {} },
    { eventType: "assistant.message", timestamp: new Date(Date.now() - 86395000).toISOString(), id: "evt-006", data: {} },
    { eventType: "tool.execution_start", timestamp: new Date(Date.now() - 86394000).toISOString(), id: "evt-007", data: {} },
    { eventType: "tool.execution_complete", timestamp: new Date(Date.now() - 86393000).toISOString(), id: "evt-008", data: {} },
    { eventType: "assistant.turn_end", timestamp: new Date(Date.now() - 86392000).toISOString(), id: "evt-009", data: {} },
    { eventType: "session.plan_changed", timestamp: new Date(Date.now() - 86391000).toISOString(), id: "evt-010", data: {} },
  ],
  totalCount: 2450,
  hasMore: true,
};

export const MOCK_TODOS: TodosResponse = {
  todos: [
    { id: "user-auth", title: "Create user auth module", description: "Implement JWT-based authentication in src/auth/", status: "done", createdAt: "", updatedAt: "" },
    { id: "api-routes", title: "Add API routes", description: "Create REST endpoints for login, logout, refresh", status: "done", createdAt: "", updatedAt: "" },
    { id: "oauth-provider", title: "OAuth provider integration", description: "Add GitHub and Google OAuth providers", status: "in_progress", createdAt: "", updatedAt: "" },
    { id: "session-mgmt", title: "Session management", description: "Implement session storage and token refresh logic", status: "pending", createdAt: "", updatedAt: "" },
    { id: "integration-tests", title: "Write integration tests", description: "End-to-end tests for all auth flows", status: "blocked", createdAt: "", updatedAt: "" },
  ],
  deps: [
    { todoId: "api-routes", dependsOn: "user-auth" },
    { todoId: "session-mgmt", dependsOn: "oauth-provider" },
    { todoId: "integration-tests", dependsOn: "api-routes" },
    { todoId: "integration-tests", dependsOn: "session-mgmt" },
  ],
};

export const MOCK_CHECKPOINTS: CheckpointEntry[] = [
  { number: 1, title: "Initial project scaffolding", filename: "001-initial-scaffolding.md" },
  { number: 2, title: "Auth module implementation", filename: "002-auth-module.md" },
  { number: 3, title: "Unit test coverage", filename: "003-unit-tests.md" },
];

export const MOCK_SHUTDOWN_METRICS: ShutdownMetrics = {
  shutdownType: "normal",
  totalPremiumRequests: 1.33,
  totalApiDurationMs: 154200,
  currentModel: "claude-opus-4.6",
  codeChanges: { linesAdded: 342, linesRemoved: 56, filesModified: ["src/auth/login.ts", "src/auth/oauth.ts", "src/auth/index.ts", "tests/auth.test.ts"] },
  modelMetrics: {
    "claude-opus-4.6": { requests: { count: 32, cost: 0.87 }, usage: { inputTokens: 892300, outputTokens: 45200, cacheReadTokens: 234000, cacheWriteTokens: 12000 } },
    "gpt-5.4": { requests: { count: 15, cost: 0.46 }, usage: { inputTokens: 234100, outputTokens: 23400, cacheReadTokens: 89000, cacheWriteTokens: 5600 } },
  },
};

// ===== New mock data for analytics pages =====

export const MOCK_ANALYTICS: AnalyticsData = {
  totalSessions: 47,
  totalTokens: 2847000,
  totalCost: 12.47,
  averageHealthScore: 0.73,
  tokenUsageByDay: Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.now() - (13 - i) * 86400000).toISOString().split('T')[0],
    tokens: Math.floor(150000 + Math.random() * 100000),
  })),
  sessionsPerDay: Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.now() - (13 - i) * 86400000).toISOString().split('T')[0],
    count: Math.floor(2 + Math.random() * 6),
  })),
  modelDistribution: [
    { model: 'Claude Sonnet 4', tokens: 1200000, percentage: 42.1 },
    { model: 'GPT-4.1', tokens: 850000, percentage: 29.9 },
    { model: 'Claude Haiku 3.5', tokens: 497000, percentage: 17.5 },
    { model: 'Gemini 2.5 Pro', tokens: 300000, percentage: 10.5 },
  ],
  costByDay: Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.now() - (13 - i) * 86400000).toISOString().split('T')[0],
    cost: +(0.5 + Math.random() * 1.5).toFixed(2),
  })),
};

export const MOCK_TOOL_ANALYSIS: ToolAnalysisData = {
  totalCalls: 127,
  successRate: 0.945,
  avgDurationMs: 1200,
  mostUsedTool: 'powershell',
  tools: [
    { name: 'edit', callCount: 342, successRate: 0.98, avgDurationMs: 450, totalDurationMs: 153900 },
    { name: 'view', callCount: 267, successRate: 0.99, avgDurationMs: 120, totalDurationMs: 32040 },
    { name: 'create', callCount: 178, successRate: 0.95, avgDurationMs: 380, totalDurationMs: 67640 },
    { name: 'powershell', callCount: 152, successRate: 0.88, avgDurationMs: 2100, totalDurationMs: 319200 },
    { name: 'grep', callCount: 121, successRate: 0.97, avgDurationMs: 340, totalDurationMs: 41140 },
    { name: 'glob', callCount: 76, successRate: 0.99, avgDurationMs: 180, totalDurationMs: 13680 },
    { name: 'task', callCount: 56, successRate: 0.91, avgDurationMs: 8500, totalDurationMs: 476000 },
  ],
  activityHeatmap: Array.from({ length: 168 }, (_, i) => ({
    day: Math.floor(i / 24),
    hour: i % 24,
    count: Math.floor(Math.random() * 15),
  })),
};

export const MOCK_CODE_IMPACT: CodeImpactData = {
  filesModified: 47,
  linesAdded: 2847,
  linesRemoved: 892,
  netChange: 1955,
  fileTypeBreakdown: [
    { extension: '.ts', count: 18, percentage: 38.3 },
    { extension: '.vue', count: 12, percentage: 25.5 },
    { extension: '.css', count: 7, percentage: 14.9 },
    { extension: '.json', count: 6, percentage: 12.8 },
    { extension: '.md', count: 4, percentage: 8.5 },
  ],
  mostModifiedFiles: [
    { path: 'src/components/SessionCard.vue', additions: 145, deletions: 67 },
    { path: 'src/stores/sessions.ts', additions: 89, deletions: 34 },
    { path: 'src/views/SessionListView.vue', additions: 234, deletions: 112 },
    { path: 'src/styles.css', additions: 567, deletions: 189 },
    { path: 'src/router/index.ts', additions: 78, deletions: 23 },
    { path: 'src/App.vue', additions: 156, deletions: 89 },
    { path: 'packages/types/src/index.ts', additions: 200, deletions: 0 },
    { path: 'packages/client/src/index.ts', additions: 120, deletions: 45 },
  ],
  changesByDay: Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.now() - (13 - i) * 86400000).toISOString().split('T')[0],
    additions: Math.floor(100 + Math.random() * 300),
    deletions: Math.floor(30 + Math.random() * 100),
  })),
};

export const MOCK_HEALTH_SCORING: HealthScoringData = {
  overallScore: 0.73,
  healthyCount: 5,
  attentionCount: 3,
  criticalCount: 1,
  attentionSessions: [
    { sessionId: 'sess-1', sessionName: 'Auth refactor', score: 0.62, flags: [{ name: 'High retry rate', severity: 'warning' }, { name: 'Long duration', severity: 'warning' }] },
    { sessionId: 'sess-2', sessionName: 'Database migration', score: 0.45, flags: [{ name: 'Many errors', severity: 'danger' }, { name: 'High token usage', severity: 'warning' }] },
    { sessionId: 'sess-3', sessionName: 'CSS cleanup', score: 0.71, flags: [{ name: 'Excessive tool calls', severity: 'warning' }] },
    { sessionId: 'sess-4', sessionName: 'API integration', score: 0.38, flags: [{ name: 'Session timeout', severity: 'danger' }, { name: 'Lost context', severity: 'danger' }] },
  ],
  healthFlags: [
    { name: 'High retry rate', count: 12, severity: 'warning', description: 'Session had more than 3 consecutive retries' },
    { name: 'Long duration', count: 8, severity: 'warning', description: 'Session exceeded 2 hour duration' },
    { name: 'Many errors', count: 5, severity: 'danger', description: 'More than 10 tool call failures' },
    { name: 'High token usage', count: 7, severity: 'warning', description: 'Token usage exceeded 500K' },
    { name: 'Excessive tool calls', count: 4, severity: 'warning', description: 'More than 200 tool calls in session' },
    { name: 'Session timeout', count: 2, severity: 'danger', description: 'Session was forcefully terminated' },
    { name: 'Lost context', count: 3, severity: 'danger', description: 'Context window exceeded, information lost' },
    { name: 'Low success rate', count: 6, severity: 'warning', description: 'Tool success rate below 85%' },
  ],
};

export const MOCK_EXPORT_RESULT: ExportResult = {
  success: true,
  filePath: '/tmp/tracepilot-export.json',
  sessionsExported: 1,
};
