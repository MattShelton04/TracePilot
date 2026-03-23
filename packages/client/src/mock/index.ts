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
    isRunning: false,
    errorCount: 2,
    rateLimitCount: 1,
    compactionCount: 0,
    truncationCount: 0,
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
    isRunning: false,
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
    isRunning: false,
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
    assistantMessages: [{ content: "I'll implement the login feature with OAuth support. Let me start by examining the current project structure and setting up the authentication module.\n\nFirst, I'll create the base auth module with JWT token handling, then add the OAuth provider integrations." }],
    model: "claude-opus-4.6",
    reasoningTexts: [
      { content: "The user wants OAuth support with GitHub and Google. I need to:\n1. Check if there's an existing auth module\n2. Look for any OAuth libraries already installed\n3. Understand the project's middleware patterns\n\nI'll launch parallel explore agents — one for auth patterns, one for OAuth libraries — to gather context before making changes." },
      { content: "Based on the exploration results, the project already has a basic auth stub in src/auth/login.ts with a TODO comment. passport and passport-github2 are in package.json but not configured. I should:\n- Set up passport strategies for GitHub and Google\n- Wire them into the existing Express middleware chain\n- Create the callback routes\n- Add JWT token generation after successful OAuth flow" }
    ],
    outputTokens: 4820,
    toolCalls: [
      { toolName: "report_intent", success: true, isComplete: true, durationMs: 10, arguments: { intent: "Exploring codebase" }, toolCallId: "tc_000", startedAt: new Date(Date.now() - 86400000).toISOString(), completedAt: new Date(Date.now() - 86399990).toISOString(), intentionSummary: "Setting exploration intent" },
      { toolName: "view", success: true, isComplete: true, durationMs: 120, arguments: { path: "src/auth/index.ts" }, toolCallId: "tc_001", startedAt: new Date(Date.now() - 86399980).toISOString(), completedAt: new Date(Date.now() - 86399860).toISOString(), intentionSummary: "Examine the existing auth module structure", resultContent: "export { login } from './login';\nexport { logout } from './logout';\n// TODO: Add OAuth providers" },
      { toolName: "explore", success: true, isComplete: true, durationMs: 25200, arguments: { description: "Explore auth patterns", agent_type: "explore", prompt: "Find all auth-related files" }, toolCallId: "tc_002", startedAt: new Date(Date.now() - 86399800).toISOString(), completedAt: new Date(Date.now() - 86374600).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5", intentionSummary: "Find all authentication-related files and patterns" },
      { toolName: "view", success: true, isComplete: true, durationMs: 80, arguments: { path: "src/auth/login.ts" }, toolCallId: "tc_002a", parentToolCallId: "tc_002", startedAt: new Date(Date.now() - 86399700).toISOString(), completedAt: new Date(Date.now() - 86399620).toISOString(), resultContent: "import { hash } from 'bcrypt';\n\nexport async function login(email: string, password: string) {\n  // TODO: implement\n  throw new Error('Not implemented');\n}" },
      { toolName: "grep", success: true, isComplete: true, durationMs: 45, arguments: { pattern: "OAuth", path: "src/" }, toolCallId: "tc_002b", parentToolCallId: "tc_002", startedAt: new Date(Date.now() - 86399500).toISOString(), completedAt: new Date(Date.now() - 86399455).toISOString(), resultContent: "src/config/providers.ts:3: // OAuth provider configuration\nsrc/config/providers.ts:8: oauthCallbackUrl: process.env.OAUTH_CALLBACK …[truncated]" },
      { toolName: "view", success: true, isComplete: true, durationMs: 95, arguments: { path: "src/config/providers.ts" }, toolCallId: "tc_002c", parentToolCallId: "tc_002", startedAt: new Date(Date.now() - 86399300).toISOString(), completedAt: new Date(Date.now() - 86399205).toISOString() },
      { toolName: "glob", success: true, isComplete: true, durationMs: 30, arguments: { pattern: "**/*.auth.*" }, toolCallId: "tc_002d", parentToolCallId: "tc_002", startedAt: new Date(Date.now() - 86399100).toISOString(), completedAt: new Date(Date.now() - 86399070).toISOString() },
      { toolName: "explore", success: true, isComplete: true, durationMs: 22100, arguments: { description: "Explore OAuth libraries", agent_type: "explore", prompt: "Find OAuth library usage" }, toolCallId: "tc_003", startedAt: new Date(Date.now() - 86399800).toISOString(), completedAt: new Date(Date.now() - 86377700).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5", intentionSummary: "Find OAuth library usage and configuration" },
      { toolName: "view", success: true, isComplete: true, durationMs: 110, arguments: { path: "package.json" }, toolCallId: "tc_003a", parentToolCallId: "tc_003", startedAt: new Date(Date.now() - 86399600).toISOString(), completedAt: new Date(Date.now() - 86399490).toISOString(), resultContent: "{\n  \"dependencies\": {\n    \"passport\": \"^0.7.0\",\n    \"passport-github2\": \"^0.1.12\",\n    \"jsonwebtoken\": \"^9.0.2\",\n    \"bcrypt\": \"^5.1.1\"\n  }\n}" },
      { toolName: "grep", success: true, isComplete: true, durationMs: 55, arguments: { pattern: "passport|oauth", path: "node_modules" }, toolCallId: "tc_003b", parentToolCallId: "tc_003", startedAt: new Date(Date.now() - 86399200).toISOString(), completedAt: new Date(Date.now() - 86399145).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 75, arguments: { path: "src/middleware/auth.ts" }, toolCallId: "tc_003c", parentToolCallId: "tc_003", startedAt: new Date(Date.now() - 86398800).toISOString(), completedAt: new Date(Date.now() - 86398725).toISOString() },
      { toolName: "read_agent", success: true, isComplete: true, durationMs: 18000, arguments: { agent_id: "agent-1" }, toolCallId: "tc_004", startedAt: new Date(Date.now() - 86377000).toISOString(), completedAt: new Date(Date.now() - 86359000).toISOString() },
      { toolName: "read_agent", success: true, isComplete: true, durationMs: 15000, arguments: { agent_id: "agent-2" }, toolCallId: "tc_005", startedAt: new Date(Date.now() - 86359000).toISOString(), completedAt: new Date(Date.now() - 86344000).toISOString() },
      { toolName: "edit", success: true, isComplete: true, durationMs: 340, arguments: { path: "src/auth/login.ts", old_str: "// TODO: implement", new_str: "export async function login(credentials: Credentials) { ... }" }, toolCallId: "tc_006", intentionSummary: "Implement the login function with credential validation" },
      { toolName: "powershell", success: false, isComplete: true, durationMs: 2100, arguments: { command: "npm test -- --filter auth", description: "Run auth tests" }, error: "Test failed: expected 200 got 401", toolCallId: "tc_007", intentionSummary: "Validate auth implementation with tests", resultContent: "FAIL tests/auth.test.ts\n  ● login › should return 200 for valid credentials\n    Expected: 200\n    Received: 401\n\nTests: 1 failed, 3 passed, 4 total …[truncated]" },
      { toolName: "edit", success: true, isComplete: true, durationMs: 280, arguments: { path: "src/auth/login.ts" }, toolCallId: "tc_008", intentionSummary: "Fix the 401 response by correcting token generation" },
      { toolName: "powershell", success: true, isComplete: true, durationMs: 1800, arguments: { command: "npm test -- --filter auth", description: "Run auth tests" }, toolCallId: "tc_009", intentionSummary: "Re-run auth tests to confirm fix", resultContent: "PASS tests/auth.test.ts\n  ✓ login › should return 200 for valid credentials (45ms)\n  ✓ login › should reject invalid password (12ms)\n  ✓ login › should handle missing fields (8ms)\n  ✓ login › should rate limit (22ms)\n\nTests: 4 passed, 4 total" },
    ],
    durationMs: 154000,
    isComplete: true,
    timestamp: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    turnIndex: 1,
    userMessage: "Great work! Now add unit tests for the login module and make sure all edge cases are covered.",
    assistantMessages: [{ content: "I'll write comprehensive unit tests for the login module. Let me cover the main flows and edge cases including expired tokens, invalid credentials, and rate limiting." }],
    model: "claude-opus-4.6",
    reasoningTexts: [
      { content: "I need to write thorough unit tests. The login module handles:\n- Normal login flow\n- Expired tokens\n- Invalid credentials\n- Rate limiting\n- Missing fields\n\nI'll launch a general-purpose agent for the actual test writing, an explore agent to find existing test patterns, and a code-review agent to check the auth module for security concerns while I work." }
    ],
    outputTokens: 6100,
    toolCalls: [
      { toolName: "report_intent", success: true, isComplete: true, durationMs: 10, arguments: { intent: "Writing auth tests" }, toolCallId: "tc_100", intentionSummary: "Setting test-writing intent" },
      // General-purpose subagent
      { toolName: "general-purpose", success: true, isComplete: true, durationMs: 54300, arguments: { description: "Implement test suite", agent_type: "general-purpose", prompt: "Write comprehensive unit tests" }, toolCallId: "tc_101", startedAt: new Date(Date.now() - 82800000).toISOString(), completedAt: new Date(Date.now() - 82745700).toISOString(), isSubagent: true, agentDisplayName: "General Purpose Agent", agentDescription: "Full-capability agent for complex multi-step tasks", model: "claude-opus-4.6", intentionSummary: "Write comprehensive unit tests for login module" },
      { toolName: "view", success: true, isComplete: true, durationMs: 90, arguments: { path: "src/auth/login.ts" }, toolCallId: "tc_101a", parentToolCallId: "tc_101", startedAt: new Date(Date.now() - 82799000).toISOString(), completedAt: new Date(Date.now() - 82798910).toISOString() },
      { toolName: "create", success: true, isComplete: true, durationMs: 450, arguments: { path: "tests/auth.test.ts" }, toolCallId: "tc_101b", parentToolCallId: "tc_101", startedAt: new Date(Date.now() - 82798000).toISOString(), completedAt: new Date(Date.now() - 82797550).toISOString() },
      { toolName: "powershell", success: true, isComplete: true, durationMs: 3200, arguments: { command: "npm test -- --verbose" }, toolCallId: "tc_101c", parentToolCallId: "tc_101", startedAt: new Date(Date.now() - 82797000).toISOString(), completedAt: new Date(Date.now() - 82793800).toISOString() },
      { toolName: "edit", success: true, isComplete: true, durationMs: 380, arguments: { path: "tests/auth.test.ts" }, toolCallId: "tc_101d", parentToolCallId: "tc_101", startedAt: new Date(Date.now() - 82793000).toISOString(), completedAt: new Date(Date.now() - 82792620).toISOString() },
      { toolName: "powershell", success: true, isComplete: true, durationMs: 2800, arguments: { command: "npm test" }, toolCallId: "tc_101e", parentToolCallId: "tc_101", startedAt: new Date(Date.now() - 82792000).toISOString(), completedAt: new Date(Date.now() - 82789200).toISOString() },
      // Explore subagent (parallel with general-purpose)
      { toolName: "explore", success: true, isComplete: true, durationMs: 18200, arguments: { description: "Find test patterns", agent_type: "explore", prompt: "Find existing test patterns and conventions used in the test suite, including describe/it structure and setup helpers" }, toolCallId: "tc_102", startedAt: new Date(Date.now() - 82800000).toISOString(), completedAt: new Date(Date.now() - 82781800).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5" },
      { toolName: "glob", success: true, isComplete: true, durationMs: 25, arguments: { pattern: "**/*.test.ts" }, toolCallId: "tc_102a", parentToolCallId: "tc_102", startedAt: new Date(Date.now() - 82799500).toISOString(), completedAt: new Date(Date.now() - 82799475).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 110, arguments: { path: "tests/setup.ts" }, toolCallId: "tc_102b", parentToolCallId: "tc_102", startedAt: new Date(Date.now() - 82799000).toISOString(), completedAt: new Date(Date.now() - 82798890).toISOString() },
      { toolName: "grep", success: true, isComplete: true, durationMs: 40, arguments: { pattern: "describe|it\\(", path: "tests/" }, toolCallId: "tc_102c", parentToolCallId: "tc_102", startedAt: new Date(Date.now() - 82798500).toISOString(), completedAt: new Date(Date.now() - 82798460).toISOString() },
      // Code review subagent
      { toolName: "code-review", success: true, isComplete: true, durationMs: 32500, arguments: { description: "Review auth module", agent_type: "code-review", prompt: "Review the authentication module for security issues, proper error handling, and adherence to best practices. Check for credential leaks, improper token validation, and missing input sanitization." }, toolCallId: "tc_103", startedAt: new Date(Date.now() - 82780000).toISOString(), completedAt: new Date(Date.now() - 82747500).toISOString(), isSubagent: true, agentDisplayName: "Code Review Agent", agentDescription: "Agent for reviewing code changes", model: "claude-opus-4.6" },
      { toolName: "view", success: true, isComplete: true, durationMs: 95, arguments: { path: "src/auth/login.ts" }, toolCallId: "tc_103a", parentToolCallId: "tc_103", startedAt: new Date(Date.now() - 82779000).toISOString(), completedAt: new Date(Date.now() - 82778905).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 85, arguments: { path: "src/auth/oauth.ts" }, toolCallId: "tc_103b", parentToolCallId: "tc_103", startedAt: new Date(Date.now() - 82778000).toISOString(), completedAt: new Date(Date.now() - 82777915).toISOString() },
      { toolName: "grep", success: true, isComplete: true, durationMs: 35, arguments: { pattern: "password|secret|token", path: "src/" }, toolCallId: "tc_103c", parentToolCallId: "tc_103", startedAt: new Date(Date.now() - 82777000).toISOString(), completedAt: new Date(Date.now() - 82776965).toISOString() },
      // read_agent calls
      { toolName: "read_agent", success: true, isComplete: true, durationMs: 5000, arguments: { agent_id: "agent-3" }, toolCallId: "tc_104" },
      { toolName: "read_agent", success: true, isComplete: true, durationMs: 3000, arguments: { agent_id: "agent-4" }, toolCallId: "tc_105" },
      { toolName: "read_agent", success: true, isComplete: true, durationMs: 8000, arguments: { agent_id: "agent-5" }, toolCallId: "tc_106" },
    ],
    durationMs: 72000,
    isComplete: true,
    timestamp: new Date(Date.now() - 82800000).toISOString(),
    sessionEvents: [
      { eventType: "session.compaction_start", timestamp: new Date(Date.now() - 82770000).toISOString(), severity: "info", summary: "Context compaction started" },
      { eventType: "session.compaction_complete", timestamp: new Date(Date.now() - 82765000).toISOString(), severity: "info", summary: "Compaction complete (48000 tokens)" },
    ],
  },
  {
    turnIndex: 2,
    userMessage: "Can you also add the session refresh endpoint?",
    assistantMessages: [{ content: "Adding the session refresh endpoint now. This will handle token rotation with sliding window expiry." }],
    model: "gpt-5.4",
    outputTokens: 2150,
    toolCalls: [
      { toolName: "edit", success: true, isComplete: true, durationMs: 310, arguments: { path: "src/auth/refresh.ts" }, toolCallId: "tc_200" },
      { toolName: "web_search", success: true, isComplete: true, durationMs: 4500, arguments: { query: "JWT refresh token best practices 2025" }, toolCallId: "tc_201" },
      { toolName: "sql", success: true, isComplete: true, durationMs: 15, arguments: { query: "UPDATE todos SET status = 'done' WHERE id = 'refresh-endpoint'", description: "Mark todo done" }, toolCallId: "tc_202" },
    ],
    durationMs: 28000,
    isComplete: false,
    timestamp: new Date(Date.now() - 79200000).toISOString(),
  },
  // ── Turn 3: 6 subagents (complex multi-agent scenario) ──
  {
    turnIndex: 3,
    userMessage: "Now refactor the entire auth module to use a plugin architecture and ensure backward compatibility.",
    assistantMessages: [{ content: "This is a significant refactor. I'll launch multiple agents in parallel to explore the codebase, implement changes, and review the result for quality." }],
    model: "claude-opus-4.6",
    reasoningTexts: [
      { content: "This is a large refactor with backward compatibility requirements. I need to:\n1. Understand the current public API surface (what consumers depend on)\n2. Identify existing plugin/middleware patterns in the codebase\n3. Map all imports/exports from auth module\n4. Design a plugin registry that preserves the existing API" },
      { content: "Four explore agents finished. Key findings:\n- src/plugins/index.ts has a basic plugin registry pattern I can extend\n- Auth module exports: login, logout, refresh, AuthProvider interface\n- 3 test files depend on auth: auth.test.ts, auth.integration.ts, e2e/login.spec.ts\n- The middleware chain uses express middleware pattern\n\nI'll create a plugin registry, refactor providers to be plugins, and keep the existing exports as facades." },
      { content: "The general-purpose agent completed the refactor and tests pass. The code review agent found one concern: the plugin registry doesn't validate duplicate registrations. I should add a guard for that. Otherwise the refactor looks solid — backward compat maintained via re-exports." }
    ],
    outputTokens: 12400,
    toolCalls: [
      // Direct tools
      { toolName: "report_intent", success: true, isComplete: true, durationMs: 12, arguments: { intent: "Refactoring auth module" }, toolCallId: "tc_300", startedAt: new Date(Date.now() - 75600000).toISOString(), completedAt: new Date(Date.now() - 75599988).toISOString() },
      { toolName: "sql", success: true, isComplete: true, durationMs: 8, arguments: { query: "UPDATE todos SET status = 'in_progress' WHERE id = 'auth-refactor'", description: "Start refactor" }, toolCallId: "tc_301", startedAt: new Date(Date.now() - 75599900).toISOString(), completedAt: new Date(Date.now() - 75599892).toISOString() },
      // Explore agent 1 (parallel group)
      { toolName: "explore", success: true, isComplete: true, durationMs: 12400, arguments: { description: "Find plugin patterns", agent_type: "explore", prompt: "Find existing plugin or middleware patterns in the codebase" }, toolCallId: "tc_302", startedAt: new Date(Date.now() - 75599000).toISOString(), completedAt: new Date(Date.now() - 75586600).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5" },
      { toolName: "grep", success: true, isComplete: true, durationMs: 35, arguments: { pattern: "plugin|middleware|register", path: "src/" }, toolCallId: "tc_302a", parentToolCallId: "tc_302", startedAt: new Date(Date.now() - 75598500).toISOString(), completedAt: new Date(Date.now() - 75598465).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 90, arguments: { path: "src/plugins/index.ts" }, toolCallId: "tc_302b", parentToolCallId: "tc_302", startedAt: new Date(Date.now() - 75598000).toISOString(), completedAt: new Date(Date.now() - 75597910).toISOString() },
      // Explore agent 2 (parallel)
      { toolName: "explore", success: true, isComplete: true, durationMs: 10800, arguments: { description: "Analyze auth dependencies", agent_type: "explore", prompt: "Map all imports and exports from the auth module" }, toolCallId: "tc_303", startedAt: new Date(Date.now() - 75598800).toISOString(), completedAt: new Date(Date.now() - 75588000).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5" },
      { toolName: "grep", success: true, isComplete: true, durationMs: 42, arguments: { pattern: "import.*from.*auth", path: "src/" }, toolCallId: "tc_303a", parentToolCallId: "tc_303", startedAt: new Date(Date.now() - 75598400).toISOString(), completedAt: new Date(Date.now() - 75598358).toISOString() },
      { toolName: "glob", success: true, isComplete: true, durationMs: 18, arguments: { pattern: "src/auth/**/*.ts" }, toolCallId: "tc_303b", parentToolCallId: "tc_303", startedAt: new Date(Date.now() - 75597800).toISOString(), completedAt: new Date(Date.now() - 75597782).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 105, arguments: { path: "src/auth/index.ts" }, toolCallId: "tc_303c", parentToolCallId: "tc_303", startedAt: new Date(Date.now() - 75597200).toISOString(), completedAt: new Date(Date.now() - 75597095).toISOString() },
      // Explore agent 3 (parallel, slightly staggered)
      { toolName: "explore", success: true, isComplete: true, durationMs: 15200, arguments: { description: "Check backward compat", agent_type: "explore", prompt: "Identify all public API surfaces that consumers depend on" }, toolCallId: "tc_304", startedAt: new Date(Date.now() - 75598000).toISOString(), completedAt: new Date(Date.now() - 75582800).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5" },
      { toolName: "grep", success: true, isComplete: true, durationMs: 50, arguments: { pattern: "export (function|class|const|interface)", path: "src/auth/" }, toolCallId: "tc_304a", parentToolCallId: "tc_304", startedAt: new Date(Date.now() - 75597500).toISOString(), completedAt: new Date(Date.now() - 75597450).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 88, arguments: { path: "src/auth/types.ts" }, toolCallId: "tc_304b", parentToolCallId: "tc_304", startedAt: new Date(Date.now() - 75596500).toISOString(), completedAt: new Date(Date.now() - 75596412).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 76, arguments: { path: "tests/auth.integration.ts" }, toolCallId: "tc_304c", parentToolCallId: "tc_304", startedAt: new Date(Date.now() - 75595500).toISOString(), completedAt: new Date(Date.now() - 75595424).toISOString() },
      { toolName: "grep", success: true, isComplete: true, durationMs: 38, arguments: { pattern: "login|logout|refresh", path: "src/routes/" }, toolCallId: "tc_304d", parentToolCallId: "tc_304", startedAt: new Date(Date.now() - 75594500).toISOString(), completedAt: new Date(Date.now() - 75594462).toISOString() },
      // Explore agent 4 (parallel)
      { toolName: "explore", success: true, isComplete: true, durationMs: 8600, arguments: { description: "Review test coverage", agent_type: "explore", prompt: "Assess current test coverage for auth module" }, toolCallId: "tc_305", startedAt: new Date(Date.now() - 75597500).toISOString(), completedAt: new Date(Date.now() - 75588900).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5" },
      { toolName: "glob", success: true, isComplete: true, durationMs: 22, arguments: { pattern: "tests/**/*auth*" }, toolCallId: "tc_305a", parentToolCallId: "tc_305", startedAt: new Date(Date.now() - 75597000).toISOString(), completedAt: new Date(Date.now() - 75596978).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 95, arguments: { path: "tests/auth.test.ts" }, toolCallId: "tc_305b", parentToolCallId: "tc_305", startedAt: new Date(Date.now() - 75596500).toISOString(), completedAt: new Date(Date.now() - 75596405).toISOString() },
      // General-purpose agent (starts after explores finish)
      { toolName: "general-purpose", success: true, isComplete: true, durationMs: 45000, arguments: { description: "Implement plugin arch", agent_type: "general-purpose", prompt: "Refactor auth module to use plugin architecture with provider registration" }, toolCallId: "tc_306", startedAt: new Date(Date.now() - 75582000).toISOString(), completedAt: new Date(Date.now() - 75537000).toISOString(), isSubagent: true, agentDisplayName: "General Purpose Agent", agentDescription: "Full-capability agent for complex multi-step tasks", model: "claude-opus-4.6", intentionSummary: "Refactor auth module into plugin architecture" },
      { toolName: "view", success: true, isComplete: true, durationMs: 85, arguments: { path: "src/auth/index.ts" }, toolCallId: "tc_306a", parentToolCallId: "tc_306", startedAt: new Date(Date.now() - 75581000).toISOString(), completedAt: new Date(Date.now() - 75580915).toISOString() },
      { toolName: "edit", success: true, isComplete: true, durationMs: 420, arguments: { path: "src/auth/plugin-registry.ts" }, toolCallId: "tc_306b", parentToolCallId: "tc_306", startedAt: new Date(Date.now() - 75580000).toISOString(), completedAt: new Date(Date.now() - 75579580).toISOString() },
      { toolName: "create", success: true, isComplete: true, durationMs: 380, arguments: { path: "src/auth/providers/github.ts" }, toolCallId: "tc_306c", parentToolCallId: "tc_306", startedAt: new Date(Date.now() - 75578000).toISOString(), completedAt: new Date(Date.now() - 75577620).toISOString() },
      { toolName: "create", success: true, isComplete: true, durationMs: 350, arguments: { path: "src/auth/providers/google.ts" }, toolCallId: "tc_306d", parentToolCallId: "tc_306", startedAt: new Date(Date.now() - 75576000).toISOString(), completedAt: new Date(Date.now() - 75575650).toISOString() },
      { toolName: "edit", success: true, isComplete: true, durationMs: 290, arguments: { path: "src/auth/index.ts" }, toolCallId: "tc_306e", parentToolCallId: "tc_306", startedAt: new Date(Date.now() - 75574000).toISOString(), completedAt: new Date(Date.now() - 75573710).toISOString() },
      { toolName: "powershell", success: true, isComplete: true, durationMs: 3400, arguments: { command: "npm test -- --filter auth", description: "Validate refactor" }, toolCallId: "tc_306f", parentToolCallId: "tc_306", startedAt: new Date(Date.now() - 75572000).toISOString(), completedAt: new Date(Date.now() - 75568600).toISOString() },
      // Code review agent (runs after general-purpose starts)
      { toolName: "code-review", success: true, isComplete: true, durationMs: 28000, arguments: { description: "Review refactored auth", agent_type: "code-review", prompt: "Review the plugin architecture refactor for correctness and backward compatibility" }, toolCallId: "tc_307", startedAt: new Date(Date.now() - 75560000).toISOString(), completedAt: new Date(Date.now() - 75532000).toISOString(), isSubagent: true, agentDisplayName: "Code Review Agent", agentDescription: "Agent for reviewing code changes with high signal-to-noise ratio", model: "claude-opus-4.6", intentionSummary: "Review refactor for correctness and backward compatibility" },
      { toolName: "view", success: true, isComplete: true, durationMs: 92, arguments: { path: "src/auth/plugin-registry.ts" }, toolCallId: "tc_307a", parentToolCallId: "tc_307", startedAt: new Date(Date.now() - 75559000).toISOString(), completedAt: new Date(Date.now() - 75558908).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 78, arguments: { path: "src/auth/index.ts" }, toolCallId: "tc_307b", parentToolCallId: "tc_307", startedAt: new Date(Date.now() - 75558000).toISOString(), completedAt: new Date(Date.now() - 75557922).toISOString() },
      { toolName: "grep", success: true, isComplete: true, durationMs: 45, arguments: { pattern: "TODO|FIXME|HACK", path: "src/auth/" }, toolCallId: "tc_307c", parentToolCallId: "tc_307", startedAt: new Date(Date.now() - 75557000).toISOString(), completedAt: new Date(Date.now() - 75556955).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 88, arguments: { path: "src/auth/providers/github.ts" }, toolCallId: "tc_307d", parentToolCallId: "tc_307", startedAt: new Date(Date.now() - 75556000).toISOString(), completedAt: new Date(Date.now() - 75555912).toISOString() },
      // read_agent (main agent collecting results)
      { toolName: "read_agent", success: true, isComplete: true, durationMs: 4000, arguments: { agent_id: "agent-6" }, toolCallId: "tc_308", startedAt: new Date(Date.now() - 75532000).toISOString(), completedAt: new Date(Date.now() - 75528000).toISOString() },
    ],
    durationMs: 72000,
    isComplete: true,
    timestamp: new Date(Date.now() - 75600000).toISOString(),
    sessionEvents: [
      { eventType: "session.error", timestamp: new Date(Date.now() - 75570000).toISOString(), severity: "error", summary: "Rate limit exceeded" },
      { eventType: "session.truncation", timestamp: new Date(Date.now() - 75545000).toISOString(), severity: "warning", summary: "Truncated 15000 tokens, 42 messages" },
      { eventType: "session.mode_changed", timestamp: new Date(Date.now() - 75540000).toISOString(), severity: "info", summary: "Mode: normal → plan" },
    ],
  },
  // ── Turn 4: 8 subagents (edge-case stress test with 2 parallel groups) ──
  {
    turnIndex: 4,
    userMessage: "Run a comprehensive audit: check all modules for security issues, performance bottlenecks, and missing tests.",
    assistantMessages: [{ content: "I'll launch a full audit across the codebase with multiple specialized agents working in parallel batches." }],
    model: "claude-opus-4.6",
    reasoningTexts: [
      { content: "A comprehensive audit requires checking multiple dimensions in parallel. I'll split into two waves:\n- Wave 1: Security audit (auth, routes, DB queries) + performance audit (N+1 queries, blocking calls)\n- Wave 2: Test coverage gaps + error handling audit + run actual test suite\n\nThen synthesize with a general-purpose agent." },
      { content: "Wave 1 results are in. The security audit found no critical issues — the auth module uses parameterized queries. The DB queries explorer failed with context window exceeded (too many files), but the grep found no raw SQL. Performance audit flagged sequential await in a forEach loop in src/db/queries.ts. Moving to wave 2." }
    ],
    outputTokens: 8900,
    toolCalls: [
      // ── Parallel group 1: first 4 explore agents (overlapping starts at ~72000000) ──
      { toolName: "explore", success: true, isComplete: true, durationMs: 14200, arguments: { description: "Audit auth security", agent_type: "explore", prompt: "Check auth module for SQL injection, XSS, and credential leaks" }, toolCallId: "tc_400", startedAt: new Date(Date.now() - 72000000).toISOString(), completedAt: new Date(Date.now() - 71985800).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5" },
      { toolName: "grep", success: true, isComplete: true, durationMs: 55, arguments: { pattern: "innerHTML|eval\\(|exec\\(", path: "src/" }, toolCallId: "tc_400a", parentToolCallId: "tc_400", startedAt: new Date(Date.now() - 71999500).toISOString(), completedAt: new Date(Date.now() - 71999445).toISOString() },
      { toolName: "grep", success: true, isComplete: true, durationMs: 48, arguments: { pattern: "password|secret|api.key", path: "src/" }, toolCallId: "tc_400b", parentToolCallId: "tc_400", startedAt: new Date(Date.now() - 71998500).toISOString(), completedAt: new Date(Date.now() - 71998452).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 92, arguments: { path: "src/auth/oauth.ts" }, toolCallId: "tc_400c", parentToolCallId: "tc_400", startedAt: new Date(Date.now() - 71997500).toISOString(), completedAt: new Date(Date.now() - 71997408).toISOString() },
      { toolName: "explore", success: true, isComplete: true, durationMs: 11500, arguments: { description: "Audit API routes", agent_type: "explore", prompt: "Check all API routes for proper input validation and error handling" }, toolCallId: "tc_401", startedAt: new Date(Date.now() - 71999500).toISOString(), completedAt: new Date(Date.now() - 71988000).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5" },
      { toolName: "glob", success: true, isComplete: true, durationMs: 20, arguments: { pattern: "src/routes/**/*.ts" }, toolCallId: "tc_401a", parentToolCallId: "tc_401", startedAt: new Date(Date.now() - 71999000).toISOString(), completedAt: new Date(Date.now() - 71998980).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 105, arguments: { path: "src/routes/api.ts" }, toolCallId: "tc_401b", parentToolCallId: "tc_401", startedAt: new Date(Date.now() - 71998200).toISOString(), completedAt: new Date(Date.now() - 71998095).toISOString() },
      { toolName: "explore", success: false, isComplete: true, durationMs: 5200, arguments: { description: "Check DB queries", agent_type: "explore", prompt: "Find all raw SQL queries that may be vulnerable to injection" }, error: "Context window exceeded", toolCallId: "tc_402", startedAt: new Date(Date.now() - 71999000).toISOString(), completedAt: new Date(Date.now() - 71993800).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5" },
      { toolName: "grep", success: true, isComplete: true, durationMs: 60, arguments: { pattern: "query\\(|execute\\(", path: "src/" }, toolCallId: "tc_402a", parentToolCallId: "tc_402", startedAt: new Date(Date.now() - 71998500).toISOString(), completedAt: new Date(Date.now() - 71998440).toISOString() },
      { toolName: "explore", success: true, isComplete: true, durationMs: 20100, arguments: { description: "Audit perf bottlenecks", agent_type: "explore", prompt: "Identify N+1 queries, missing indexes, and synchronous blocking calls" }, toolCallId: "tc_403", startedAt: new Date(Date.now() - 71998500).toISOString(), completedAt: new Date(Date.now() - 71978400).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5" },
      { toolName: "grep", success: true, isComplete: true, durationMs: 42, arguments: { pattern: "await.*for|forEach.*await", path: "src/" }, toolCallId: "tc_403a", parentToolCallId: "tc_403", startedAt: new Date(Date.now() - 71998000).toISOString(), completedAt: new Date(Date.now() - 71997958).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 78, arguments: { path: "src/db/queries.ts" }, toolCallId: "tc_403b", parentToolCallId: "tc_403", startedAt: new Date(Date.now() - 71997000).toISOString(), completedAt: new Date(Date.now() - 71996922).toISOString() },
      { toolName: "grep", success: true, isComplete: true, durationMs: 38, arguments: { pattern: "setTimeout|setInterval", path: "src/" }, toolCallId: "tc_403c", parentToolCallId: "tc_403", startedAt: new Date(Date.now() - 71996000).toISOString(), completedAt: new Date(Date.now() - 71995962).toISOString() },
      // ── Parallel group 2: 2 more explore agents + task agent (start ~71980000, after group 1 mostly done) ──
      { toolName: "explore", success: true, isComplete: true, durationMs: 9800, arguments: { description: "Find missing tests", agent_type: "explore", prompt: "Identify modules with no corresponding test files" }, toolCallId: "tc_404", startedAt: new Date(Date.now() - 71980000).toISOString(), completedAt: new Date(Date.now() - 71970200).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5" },
      { toolName: "glob", success: true, isComplete: true, durationMs: 15, arguments: { pattern: "src/**/*.ts" }, toolCallId: "tc_404a", parentToolCallId: "tc_404", startedAt: new Date(Date.now() - 71979500).toISOString(), completedAt: new Date(Date.now() - 71979485).toISOString() },
      { toolName: "glob", success: true, isComplete: true, durationMs: 14, arguments: { pattern: "tests/**/*.test.ts" }, toolCallId: "tc_404b", parentToolCallId: "tc_404", startedAt: new Date(Date.now() - 71979000).toISOString(), completedAt: new Date(Date.now() - 71978986).toISOString() },
      { toolName: "explore", success: true, isComplete: true, durationMs: 7400, arguments: { description: "Check error handling", agent_type: "explore", prompt: "Find try-catch blocks with empty catch or missing error propagation" }, toolCallId: "tc_405", startedAt: new Date(Date.now() - 71979500).toISOString(), completedAt: new Date(Date.now() - 71972100).toISOString(), isSubagent: true, agentDisplayName: "Explore Agent", agentDescription: "Fast agent for exploring codebases", model: "claude-haiku-4.5" },
      { toolName: "grep", success: true, isComplete: true, durationMs: 52, arguments: { pattern: "catch.*\\{\\s*\\}", path: "src/" }, toolCallId: "tc_405a", parentToolCallId: "tc_405", startedAt: new Date(Date.now() - 71979000).toISOString(), completedAt: new Date(Date.now() - 71978948).toISOString() },
      { toolName: "task", success: true, isComplete: true, durationMs: 12000, arguments: { description: "Run test suite", agent_type: "task", prompt: "Run full test suite and report coverage" }, toolCallId: "tc_406", startedAt: new Date(Date.now() - 71979000).toISOString(), completedAt: new Date(Date.now() - 71967000).toISOString(), isSubagent: true, agentDisplayName: "Task Agent", agentDescription: "Agent for executing commands with verbose output", model: "claude-haiku-4.5" },
      { toolName: "powershell", success: true, isComplete: true, durationMs: 8500, arguments: { command: "npm test -- --coverage", description: "Run tests with coverage" }, toolCallId: "tc_406a", parentToolCallId: "tc_406", startedAt: new Date(Date.now() - 71978500).toISOString(), completedAt: new Date(Date.now() - 71970000).toISOString() },
      { toolName: "powershell", success: true, isComplete: true, durationMs: 2200, arguments: { command: "npm run lint", description: "Run linter" }, toolCallId: "tc_406b", parentToolCallId: "tc_406", startedAt: new Date(Date.now() - 71969500).toISOString(), completedAt: new Date(Date.now() - 71967300).toISOString() },
      // ── General-purpose agent (starts last, synthesizes findings) ──
      { toolName: "general-purpose", success: true, isComplete: true, durationMs: 35000, arguments: { description: "Compile audit report", agent_type: "general-purpose", prompt: "Synthesize all audit findings into a structured report with severity ratings" }, toolCallId: "tc_407", startedAt: new Date(Date.now() - 71967000).toISOString(), completedAt: new Date(Date.now() - 71932000).toISOString(), isSubagent: true, agentDisplayName: "General Purpose Agent", agentDescription: "Full-capability agent for complex multi-step tasks", model: "claude-opus-4.6" },
      { toolName: "view", success: true, isComplete: true, durationMs: 75, arguments: { path: "src/auth/index.ts" }, toolCallId: "tc_407a", parentToolCallId: "tc_407", startedAt: new Date(Date.now() - 71966000).toISOString(), completedAt: new Date(Date.now() - 71965925).toISOString() },
      { toolName: "view", success: true, isComplete: true, durationMs: 82, arguments: { path: "src/routes/api.ts" }, toolCallId: "tc_407b", parentToolCallId: "tc_407", startedAt: new Date(Date.now() - 71965000).toISOString(), completedAt: new Date(Date.now() - 71964918).toISOString() },
      { toolName: "create", success: true, isComplete: true, durationMs: 520, arguments: { path: "docs/audit-report.md" }, toolCallId: "tc_407c", parentToolCallId: "tc_407", startedAt: new Date(Date.now() - 71964000).toISOString(), completedAt: new Date(Date.now() - 71963480).toISOString() },
      { toolName: "edit", success: true, isComplete: true, durationMs: 310, arguments: { path: "src/auth/oauth.ts" }, toolCallId: "tc_407d", parentToolCallId: "tc_407", startedAt: new Date(Date.now() - 71962000).toISOString(), completedAt: new Date(Date.now() - 71961690).toISOString() },
      { toolName: "powershell", success: true, isComplete: true, durationMs: 2800, arguments: { command: "npm test", description: "Verify fixes" }, toolCallId: "tc_407e", parentToolCallId: "tc_407", startedAt: new Date(Date.now() - 71960000).toISOString(), completedAt: new Date(Date.now() - 71957200).toISOString() },
    ],
    durationMs: 68000,
    isComplete: true,
    timestamp: new Date(Date.now() - 72000000).toISOString(),
  },
  // ── Turn 5: Rich renderer demo data for development/debugging ──
  {
    turnIndex: 5,
    userMessage: "This is a demo turn for testing all rich tool renderers.",
    assistantMessages: [{ content: "Here are examples of each tool type with rich result content for renderer testing." }],
    model: "claude-opus-4.6",
    outputTokens: 500,
    toolCalls: [
      // ── Edit: with diff data ──
      {
        toolName: "edit",
        success: true,
        isComplete: true,
        durationMs: 280,
        toolCallId: "demo_edit_1",
        startedAt: new Date(Date.now() - 60000).toISOString(),
        completedAt: new Date(Date.now() - 59720).toISOString(),
        intentionSummary: "Add error handling to login function",
        arguments: {
          path: "src/auth/login.ts",
          old_str: "export async function login(email: string, password: string) {\n  const user = await db.findUser(email);\n  const valid = await bcrypt.compare(password, user.hash);\n  return { token: jwt.sign({ id: user.id }, SECRET) };\n}",
          new_str: "export async function login(email: string, password: string) {\n  const user = await db.findUser(email);\n  if (!user) {\n    throw new AuthError('USER_NOT_FOUND', 'No account with that email');\n  }\n  const valid = await bcrypt.compare(password, user.hash);\n  if (!valid) {\n    throw new AuthError('INVALID_PASSWORD', 'Incorrect password');\n  }\n  const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '24h' });\n  return { token, expiresIn: 86400 };\n}",
        },
        resultContent: "Applied edit to src/auth/login.ts",
      },
      // ── View: code with syntax highlighting ──
      {
        toolName: "view",
        success: true,
        isComplete: true,
        durationMs: 95,
        toolCallId: "demo_view_1",
        startedAt: new Date(Date.now() - 59000).toISOString(),
        completedAt: new Date(Date.now() - 58905).toISOString(),
        intentionSummary: "Examine auth configuration",
        arguments: { path: "src/config/auth.ts", view_range: [1, 25] },
        resultContent: "import { Algorithm } from 'jsonwebtoken';\n\nexport interface AuthConfig {\n  jwtSecret: string;\n  jwtAlgorithm: Algorithm;\n  tokenExpiry: string;\n  refreshTokenExpiry: string;\n  bcryptRounds: number;\n  oauth: {\n    github: { clientId: string; clientSecret: string };\n    google: { clientId: string; clientSecret: string };\n  };\n}\n\nexport const defaultAuthConfig: AuthConfig = {\n  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',\n  jwtAlgorithm: 'HS256',\n  tokenExpiry: '24h',\n  refreshTokenExpiry: '7d',\n  bcryptRounds: 12,\n  oauth: {\n    github: { clientId: '', clientSecret: '' },\n    google: { clientId: '', clientSecret: '' },\n  },\n};",
      },
      // ── Create: new file with content ──
      {
        toolName: "create",
        success: true,
        isComplete: true,
        durationMs: 350,
        toolCallId: "demo_create_1",
        startedAt: new Date(Date.now() - 58000).toISOString(),
        completedAt: new Date(Date.now() - 57650).toISOString(),
        intentionSummary: "Create auth middleware",
        arguments: {
          path: "src/middleware/requireAuth.ts",
          file_text: "import { Request, Response, NextFunction } from 'express';\nimport jwt from 'jsonwebtoken';\nimport { AuthConfig } from '../config/auth';\n\nexport function requireAuth(config: AuthConfig) {\n  return (req: Request, res: Response, next: NextFunction) => {\n    const token = req.headers.authorization?.replace('Bearer ', '');\n    if (!token) {\n      return res.status(401).json({ error: 'Missing authorization token' });\n    }\n    try {\n      const payload = jwt.verify(token, config.jwtSecret, {\n        algorithms: [config.jwtAlgorithm],\n      });\n      req.user = payload as { id: string; role: string };\n      next();\n    } catch (err) {\n      return res.status(401).json({ error: 'Invalid or expired token' });\n    }\n  };\n}\n",
        },
        resultContent: "Created file src/middleware/requireAuth.ts",
      },
      // ── Grep: content mode with context lines ──
      {
        toolName: "grep",
        success: true,
        isComplete: true,
        durationMs: 45,
        toolCallId: "demo_grep_1",
        startedAt: new Date(Date.now() - 57000).toISOString(),
        completedAt: new Date(Date.now() - 56955).toISOString(),
        intentionSummary: "Find all JWT usage in codebase",
        arguments: {
          pattern: "jwt\\.sign|jwt\\.verify",
          path: "src/",
          output_mode: "content",
          "-n": true,
          "-A": 2,
        },
        resultContent: "src/auth/login.ts:15:  const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '24h' });\nsrc/auth/login.ts-16-  return { token, expiresIn: 86400 };\nsrc/auth/login.ts-17-}\n--\nsrc/auth/refresh.ts:22:  const decoded = jwt.verify(refreshToken, REFRESH_SECRET);\nsrc/auth/refresh.ts-23-  const user = await db.findUser(decoded.id);\nsrc/auth/refresh.ts-24-  return jwt.sign({ id: user.id }, SECRET);\n--\nsrc/middleware/requireAuth.ts:13:      const payload = jwt.verify(token, config.jwtSecret, {\nsrc/middleware/requireAuth.ts-14-        algorithms: [config.jwtAlgorithm],\nsrc/middleware/requireAuth.ts-15-      });",
      },
      // ── Glob: file tree ──
      {
        toolName: "glob",
        success: true,
        isComplete: true,
        durationMs: 25,
        toolCallId: "demo_glob_1",
        startedAt: new Date(Date.now() - 56000).toISOString(),
        completedAt: new Date(Date.now() - 55975).toISOString(),
        intentionSummary: "Find all TypeScript files in auth module",
        arguments: { pattern: "**/*.ts", path: "src/auth" },
        resultContent: "src/auth/index.ts\nsrc/auth/login.ts\nsrc/auth/logout.ts\nsrc/auth/refresh.ts\nsrc/auth/oauth.ts\nsrc/auth/types.ts\nsrc/auth/errors.ts\nsrc/auth/utils/hash.ts\nsrc/auth/utils/token.ts\nsrc/auth/providers/github.ts\nsrc/auth/providers/google.ts",
      },
      // ── Powershell: terminal output ──
      {
        toolName: "powershell",
        success: true,
        isComplete: true,
        durationMs: 3200,
        toolCallId: "demo_shell_1",
        startedAt: new Date(Date.now() - 55000).toISOString(),
        completedAt: new Date(Date.now() - 51800).toISOString(),
        intentionSummary: "Run auth test suite",
        arguments: { command: "npm test -- --filter auth --verbose", description: "Run auth tests" },
        resultContent: "> project@1.0.0 test\n> vitest run --filter auth --verbose\n\n ✓ tests/auth/login.test.ts (6 tests) 245ms\n   ✓ login › should return token for valid credentials (45ms)\n   ✓ login › should throw for invalid password (12ms)\n   ✓ login › should throw for missing user (8ms)\n   ✓ login › should include role in token payload (22ms)\n   ✓ login › should set 24h expiry (15ms)\n   ✓ login › should hash comparison be timing-safe (18ms)\n ✓ tests/auth/refresh.test.ts (3 tests) 89ms\n   ✓ refresh › should return new token (32ms)\n   ✓ refresh › should reject expired refresh token (15ms)\n   ✓ refresh › should reject invalid refresh token (12ms)\n ✗ tests/auth/oauth.test.ts (4 tests) 312ms\n   ✓ oauth › github › should redirect to GitHub (42ms)\n   ✓ oauth › github › should handle callback (58ms)\n   ✗ oauth › google › should redirect to Google (85ms)\n     Error: GOOGLE_CLIENT_ID not configured\n   ✓ oauth › google › should handle callback (62ms)\n\n Tests: 12 passed, 1 failed, 13 total\n Time:  0.65s",
      },
      // ── SQL: query with table result ──
      {
        toolName: "sql",
        success: true,
        isComplete: true,
        durationMs: 12,
        toolCallId: "demo_sql_1",
        startedAt: new Date(Date.now() - 51000).toISOString(),
        completedAt: new Date(Date.now() - 50988).toISOString(),
        intentionSummary: "Check todo status",
        arguments: {
          query: "SELECT id, title, status FROM todos ORDER BY status, id",
          description: "List all todos with status",
        },
        resultContent: "| id | title | status |\n|---|---|---|\n| api-routes | Add API routes | done |\n| user-auth | Create user auth module | done |\n| oauth-provider | OAuth provider integration | in_progress |\n| session-mgmt | Session management | pending |\n| integration-tests | Write integration tests | blocked |",
      },
      // ── Web Search: with citations ──
      {
        toolName: "web_search",
        success: true,
        isComplete: true,
        durationMs: 4500,
        toolCallId: "demo_websearch_1",
        startedAt: new Date(Date.now() - 50000).toISOString(),
        completedAt: new Date(Date.now() - 45500).toISOString(),
        intentionSummary: "Research JWT security best practices",
        arguments: { query: "JWT refresh token rotation best practices 2025" },
        resultContent: "## JWT Refresh Token Best Practices\n\nRefresh token rotation is now considered the **gold standard** for secure token management [1]. Here are the key recommendations:\n\n### Token Rotation\n- Issue a new refresh token with every access token refresh [2]\n- Invalidate the old refresh token immediately\n- Use **one-time-use** refresh tokens to detect token theft\n\n### Storage\n- Store refresh tokens in `httpOnly` cookies, never in `localStorage` [3]\n- Use `Secure` and `SameSite=Strict` flags\n- Encrypt tokens at rest in the database\n\n### Expiry\n- Access tokens: 15 minutes to 1 hour\n- Refresh tokens: 7 to 30 days with sliding window\n- Implement **absolute timeout** regardless of activity [1]\n\n> \"Refresh token rotation provides automatic reuse detection. If a previously used refresh token is presented, the authorization server should treat this as a sign that a refresh token has been compromised.\" — [OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics) [2]\n\nFor implementation, consider using libraries like `jose` for token handling and `ioredis` for token blacklisting.\n\nSources:\n[1] [OAuth 2.0 Security Best Current Practice](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics)\n[2] [Auth0 - Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)\n[3] [OWASP Token Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)",
      },
      // ── Ask User: with choices (selected) ──
      {
        toolName: "ask_user",
        success: true,
        isComplete: true,
        durationMs: 15000,
        toolCallId: "demo_askuser_1",
        startedAt: new Date(Date.now() - 45000).toISOString(),
        completedAt: new Date(Date.now() - 30000).toISOString(),
        intentionSummary: "Ask about token storage strategy",
        arguments: {
          question: "What token storage strategy should I use for the refresh tokens?",
          choices: ["httpOnly cookies (Recommended)", "Redis with TTL", "Database with cleanup job"],
          allow_freeform: true,
        },
        resultContent: "httpOnly cookies (Recommended)",
      },
      // ── Ask User: freeform response ──
      {
        toolName: "ask_user",
        success: true,
        isComplete: true,
        durationMs: 25000,
        toolCallId: "demo_askuser_2",
        startedAt: new Date(Date.now() - 29000).toISOString(),
        completedAt: new Date(Date.now() - 4000).toISOString(),
        intentionSummary: "Ask about additional OAuth providers",
        arguments: {
          question: "Are there any other OAuth providers you'd like me to support besides GitHub and Google?",
          choices: ["No, just GitHub and Google", "Add Microsoft/Azure AD", "Add Apple Sign-In"],
          allow_freeform: true,
        },
        resultContent: "Please additionally add support for Microsoft Azure AD and also Okta for enterprise SSO use cases",
      },
      // ── Task/Subagent ──
      {
        toolName: "task",
        success: true,
        isComplete: true,
        durationMs: 45000,
        toolCallId: "demo_task_1",
        startedAt: new Date(Date.now() - 50000).toISOString(),
        completedAt: new Date(Date.now() - 5000).toISOString(),
        intentionSummary: "Research OAuth provider SDKs",
        isSubagent: true,
        agentDisplayName: "Explore Agent",
        agentDescription: "Fast codebase exploration agent",
        model: "claude-haiku-4.5",
        arguments: {
          description: "Research OAuth SDKs",
          prompt: "Research the best Node.js SDKs for Microsoft Azure AD and Okta OAuth integration",
          agent_type: "explore",
        },
        resultContent: "## OAuth Provider SDK Research\n\n### Microsoft Azure AD\n- **@azure/msal-node** — Official Microsoft Authentication Library\n  - Full OAuth 2.0 + OpenID Connect support\n  - 2.1M weekly downloads\n\n### Okta\n- **@okta/okta-auth-js** — Official Okta SDK\n  - PKCE flow support, token management\n  - 280K weekly downloads",
      },
      // ── Store Memory ──
      {
        toolName: "store_memory",
        success: true,
        isComplete: true,
        durationMs: 8,
        toolCallId: "demo_memory_1",
        startedAt: new Date(Date.now() - 3000).toISOString(),
        completedAt: new Date(Date.now() - 2992).toISOString(),
        intentionSummary: "Remember auth decision",
        arguments: {
          subject: "authentication",
          fact: "Project uses httpOnly cookies for refresh token storage with Redis blacklisting.",
          citations: "User input: token storage strategy discussion",
          reason: "Important architectural decision that affects future auth-related tasks.",
          category: "general",
        },
        resultContent: "Memory stored successfully",
      },
      // ── Report Intent ──
      {
        toolName: "report_intent",
        success: true,
        isComplete: true,
        durationMs: 5,
        toolCallId: "demo_intent_1",
        startedAt: new Date(Date.now() - 2000).toISOString(),
        completedAt: new Date(Date.now() - 1995).toISOString(),
        arguments: { intent: "Implementing OAuth providers" },
      },
      // ── Read Powershell ──
      {
        toolName: "read_powershell",
        success: true,
        isComplete: true,
        durationMs: 15,
        toolCallId: "demo_readshell_1",
        startedAt: new Date(Date.now() - 1500).toISOString(),
        completedAt: new Date(Date.now() - 1485).toISOString(),
        arguments: { shellId: "shell_auth_test", delay: 5 },
        resultContent: "Build successful. 0 errors, 2 warnings.\nwarning: unused import `Debug` in src/auth/types.ts:3\nwarning: field `expires_at` is never read in src/auth/types.ts:18",
      },
      // ── Write Powershell ──
      {
        toolName: "write_powershell",
        success: true,
        isComplete: true,
        durationMs: 22,
        toolCallId: "demo_writeshell_1",
        startedAt: new Date(Date.now() - 1000).toISOString(),
        completedAt: new Date(Date.now() - 978).toISOString(),
        arguments: { shellId: "shell_interactive", input: "y{enter}", delay: 10 },
        resultContent: "Proceeding with migration...\nMigration 001_create_users applied successfully.\nMigration 002_create_sessions applied successfully.\nAll migrations complete.",
      },
    ],
    durationMs: 60000,
    isComplete: true,
    timestamp: new Date(Date.now() - 60000).toISOString(),
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
  allEventTypes: ["assistant.message", "assistant.turn_end", "assistant.turn_start", "session.plan_changed", "session.start", "tool.execution_complete", "tool.execution_start", "user.message"],
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
  totalPremiumRequests: 120,
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
    { model: 'Claude Sonnet 4', tokens: 1200000, percentage: 42.1, inputTokens: 600000, outputTokens: 400000, cacheReadTokens: 200000, premiumRequests: 15, requestCount: 312 },
    { model: 'GPT-4.1', tokens: 850000, percentage: 29.9, inputTokens: 425000, outputTokens: 300000, cacheReadTokens: 125000, premiumRequests: 10, requestCount: 198 },
    { model: 'Claude Haiku 3.5', tokens: 497000, percentage: 17.5, inputTokens: 250000, outputTokens: 150000, cacheReadTokens: 97000, premiumRequests: 8, requestCount: 143 },
    { model: 'Gemini 2.5 Pro', tokens: 300000, percentage: 10.5, inputTokens: 150000, outputTokens: 100000, cacheReadTokens: 50000, premiumRequests: 5, requestCount: 87 },
  ],
  costByDay: Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.now() - (13 - i) * 86400000).toISOString().split('T')[0],
    cost: +(0.5 + Math.random() * 1.5).toFixed(2),
  })),
  apiDurationStats: {
    avgMs: 154_200,
    medianMs: 98_400,
    p95Ms: 480_000,
    minMs: 8_500,
    maxMs: 620_000,
    totalSessionsWithDuration: 42,
  },
  productivityMetrics: {
    avgTurnsPerSession: 8.5,
    avgToolCallsPerTurn: 4.2,
    avgTokensPerTurn: 60_489,
    avgTokensPerApiSecond: 3_420,
  },
  cacheStats: {
    totalCacheReadTokens: 472_000,
    totalInputTokens: 1_425_000,
    cacheHitRate: 33.1,
    nonCachedInputTokens: 953_000,
  },
  healthDistribution: {
    healthyCount: 28,
    attentionCount: 14,
    criticalCount: 5,
  },
  sessionsWithErrors: 3,
  totalRateLimits: 7,
  totalCompactions: 12,
  totalTruncations: 2,
  incidentsByDay: [
    { date: "2026-03-15", errors: 1, rateLimits: 1, compactions: 2, truncations: 0 },
    { date: "2026-03-16", errors: 0, rateLimits: 0, compactions: 3, truncations: 1 },
    { date: "2026-03-17", errors: 2, rateLimits: 2, compactions: 1, truncations: 0 },
    { date: "2026-03-18", errors: 0, rateLimits: 0, compactions: 4, truncations: 1 },
    { date: "2026-03-19", errors: 1, rateLimits: 1, compactions: 2, truncations: 0 },
  ],
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
