// Loaded ONLY by the visual harness's Vite transform. Not shipped in the app.
// Existing typed browser fixtures supply sessions, turns, metrics and charts.
// These additions cover domains whose normal browser mode has no fallback.
import { configureVisualFeatures } from "./feature-policy.mjs";

const skill = {
  name: "visual-review",
  description: "Review a change for clarity, correctness, and useful tests.",
  scope: "global",
  directory: "/visual-fixtures/skills/visual-review",
  frontmatterTokens: 28,
  instructionTokens: 180,
  enabled: true,
  hasAssets: false,
  assetCount: 0,
};
const disconnected = {
  state: "disconnected",
  sdkAvailable: true,
  enabledByPreference: false,
  cliVersion: null,
  protocolVersion: null,
  activeSessions: 0,
  error: null,
  connectionMode: null,
};
const agentFields = {
  name: null,
  displayName: null,
  description: null,
  models: [],
  modelPolicy: null,
  reasoningEffort: null,
  contextTier: null,
  tools: null,
  includeCustomInstructions: null,
  deferredToolLoading: null,
  disableModelInvocation: null,
  userInvocable: null,
  infer: null,
};
const agent = {
  id: "/visual-fixtures/agents/visual-explore.agent.md",
  name: "visual-explore",
  fileStem: "visual-explore",
  displayName: "Visual Explore",
  description: "Fast codebase exploration and answering questions in a separate context window.",
  scope: "personal",
  format: "markdown",
  path: "/visual-fixtures/agents/visual-explore.agent.md",
  sourceLabel: "Personal",
  repoRoot: null,
  fields: {
    ...agentFields,
    name: "visual-explore",
    displayName: "Visual Explore",
    description: "Fast codebase exploration and answering questions in a separate context window.",
    models: ["gpt-5.4-mini", "claude-haiku-4.5"],
    reasoningEffort: "low",
    tools: ["grep", "glob", "view"],
  },
  hasMcpServers: false,
  readOnlyReason: null,
  modifiedAt: "2026-02-01T09:00:00.000Z",
};
const agentDistribution = (p50) => ({
  count: 240,
  min: Math.round(p50 / 4),
  p25: Math.round(p50 / 2),
  p50,
  p75: Math.round(p50 * 1.4),
  p90: Math.round(p50 * 1.8),
  max: Math.round(p50 * 3),
});
const agentStats = {
  name: "visual-explore",
  agentType: "visual-explore",
  displayName: "Visual Explore",
  description: agent.description,
  runs: 240,
  sessions: 36,
  completed: 228,
  failed: 8,
  cancelled: 4,
  incomplete: 0,
  durationMs: agentDistribution(38_000),
  totalTokens: agentDistribution(42_000),
  toolCalls: agentDistribution(14),
  previousMedianDurationMs: 36_000,
  runsWithCredits: 60,
  ownNanoAiu: 4_200_000_000,
  firstUsed: "2026-02-20T09:00:00.000Z",
  lastUsed: "2026-03-19T16:30:00.000Z",
  topModels: [
    { label: "gpt-5.4-mini", runs: 196 },
    { label: "claude-haiku-4.5", runs: 44 },
  ],
  mismatchRuns: 0,
  runsWithConfiguration: 240,
  maxDepth: 2,
  peakSiblings: 4,
  followUps: 6,
  multiTurnRuns: 3,
  dailyRuns: Array.from({ length: 28 }, (_, index) => ({
    date: `2026-0${index < 9 ? 2 : 3}-${String(index < 9 ? index + 21 : index - 8).padStart(2, "0")}`,
    runs: 4 + ((index * 3) % 9),
  })),
};

const overrides = {
  get_search_stats: {
    totalRows: 332,
    indexedSessions: 3,
    totalSessions: 3,
    contentTypeCounts: [
      ["user_message", 120],
      ["assistant_message", 118],
      ["tool_result", 94],
    ],
  },
  get_search_repositories: ["tracepilot/app"],
  get_search_tool_names: ["edit", "grep"],
  get_search_facets: {
    byContentType: [
      ["user_message", 1],
      ["assistant_message", 1],
    ],
    byRepository: [["tracepilot/app", 2]],
    byToolName: [],
    totalMatches: 2,
    sessionCount: 1,
  },
  search_content: {
    results: [
      "Please refactor the <mark>auth</mark> module into plugins and keep JWT refresh working.",
      "The <mark>auth</mark> plugin registry preserves refresh token behavior.",
    ].map((snippet, i) => ({
      id: i + 1,
      sessionId: "sess-auth-refactor",
      contentType: i ? "assistant_message" : "user_message",
      turnNumber: 0,
      eventIndex: null,
      timestampUnix: 1774008000,
      toolName: null,
      snippet,
      metadataJson: null,
      sessionSummary: "Auth plugin refactor",
      sessionRepository: "tracepilot/app",
      sessionBranch: "main",
      sessionUpdatedAt: "2026-03-20T10:00:00Z",
    })),
    totalCount: 2,
    hasMore: false,
    query: "auth",
    latencyMs: 3,
  },
  mcp_list_servers: [
    [
      "visual-files",
      {
        command: "node",
        args: ["fixture-server.js"],
        type: "stdio",
        enabled: true,
        description: "Read-only project files (synthetic fixture)",
      },
    ],
  ],
  mcp_check_health: {},
  agents_list: {
    definitions: [
      agent,
      {
        ...agent,
        id: "/visual-fixtures/agents/visual-reviewer.agent.md",
        name: "visual-reviewer",
        fileStem: "visual-reviewer",
        displayName: "Visual Reviewer",
        description:
          "A longer description to exercise wrapping, truncation and card alignment in a realistic agent list.",
        path: "/visual-fixtures/agents/visual-reviewer.agent.md",
        scope: "project",
        sourceLabel: "Project",
        repoRoot: "/visual-fixtures/repo",
        fields: { ...agent.fields, name: "visual-reviewer", models: ["claude-opus-5"] },
      },
    ],
    diagnostics: [],
    settings: {
      settingsPath: "/visual-fixtures/.copilot/settings.json",
      overrides: {},
      disabled: [],
      maxConcurrency: null,
      maxDepth: null,
      sessionModel: "gpt-5.6-luna",
      sessionEffort: "high",
      shapeError: null,
      raw: null,
    },
    cliVersion: "1.0.86",
    personalDir: "/visual-fixtures/agents",
    repoRoots: ["/visual-fixtures/repo"],
  },
  agents_usage_summary: {
    totalRuns: 240,
    totalSessions: 36,
    failedRuns: 8,
    cancelledRuns: 4,
    incompleteRuns: 0,
    maxDepth: 2,
    peakParallelism: 4,
    runsWithCredits: 60,
    totalOwnNanoAiu: 4_200_000_000,
    agents: [agentStats],
    mainAgentSelections: [],
  },
  agents_get: {
    summary: agent,
    rawContent: [
      "---",
      "name: visual-explore",
      "description: Fast codebase exploration",
      "model: [gpt-5.4-mini, claude-haiku-4.5]",
      "---",
      "You are an exploration agent.",
    ].join("\n"),
    body: [
      "You are an exploration agent. Answer the question as fast as possible, then stop.",
      "",
      "## Rules",
      "",
      "- Stop searching as soon as you can answer.",
      "- Cite file paths and line numbers.",
      "- Use {{grepToolName}} for content and {{globToolName}} for names.",
    ].join("\n"),
    otherFields: [],
    mcpServers: null,
    diagnostics: [],
  },
  agents_usage_detail: {
    stats: agentStats,
    outcomesByDay: agentStats.dailyRuns.map((day) => ({
      date: day.date,
      completed: day.runs,
      failed: 0,
      cancelled: 0,
      incomplete: 0,
    })),
    dispatch: [
      {
        configuredModel: "gpt-5.4-mini",
        firstDispatchedModel: "gpt-5.4-mini",
        actualModel: "gpt-5.4-mini",
        overrideReason: null,
        runs: 240,
      },
    ],
    invokedBy: [{ parent: null, runs: 240 }],
    depths: [
      { value: 0, runs: 220 },
      { value: 1, runs: 20 },
    ],
    parallelism: [
      { value: 1, runs: 180 },
      { value: 4, runs: 60 },
    ],
    failureReasons: [
      {
        reason: "Tool call timed out",
        example: "grep exceeded the 120s limit",
        runs: 8,
        lastSeen: "2026-03-18T11:00:00.000Z",
      },
    ],
    executionModes: [{ label: "sync", runs: 240 }],
    repositories: [{ label: "tracepilot/app", runs: 240 }],
    recentRuns: [
      {
        sessionId: "sess-search-polish",
        sessionSummary: "Search preset cleanup",
        repository: "tracepilot/app",
        runKey: "agent-1",
        toolCallId: "call-1",
        displayName: "Visual Explore",
        description: "Find the preset loader",
        startedAt: "2026-03-19T16:30:00.000Z",
        outcome: "completed",
        errorText: null,
        model: "gpt-5.4-mini",
        durationMs: 38_000,
        totalTokens: 42_000,
        totalToolCalls: 14,
        ownNanoAiu: 70_000_000,
        depth: 0,
        parentAgentName: null,
        turnIndex: 2,
        eventIndex: 18,
      },
    ],
  },
  skills_list_all: {
    skills: [
      skill,
      {
        ...skill,
        name: "visual-long-name-for-project-quality-review",
        description:
          "A longer description to exercise wrapping, truncation, and card alignment in a realistic installed skill list.",
        enabled: false,
      },
    ],
    diagnostics: [],
  },
  skills_encountered_project: [],
  skills_list_assets: [],
  skills_repos_with_skills: [],
  skills_get_skill: {
    ...skill,
    frontmatter: { name: skill.name, description: skill.description },
    body: "# Review a change\n\n1. Read the affected workflow.\n2. Check behavior and failure recovery.\n3. Explain findings with concrete evidence.\n\n```ts\nconst result = await review(change);\n```",
    rawContent:
      "---\nname: visual-review\ndescription: Review a change\n---\n# Review a change\n\nInspect behavior and failure recovery.",
  },
  sdk_status: disconnected,
  sdk_cli_status: disconnected,
  sdk_connect: disconnected,
  sdk_hydrate: {
    status: disconnected,
    sessions: [],
    sessionStates: [],
    metrics: {
      eventsForwarded: 0,
      eventsDroppedDueToLag: 0,
      lagOccurrences: 0,
      stateEventsDroppedDueToLag: 0,
      stateLagOccurrences: 0,
    },
  },
  sdk_list_sessions: [],
  sdk_list_session_states: [],
  sdk_get_session_state: null,
  sdk_list_servers: [],
  sdk_get_foreground_session: null,
  session_list_files: [
    {
      name: "plan.md",
      path: "plan.md",
      fileType: "markdown",
      isDirectory: false,
      sizeBytes: 84,
      modifiedAt: "2026-03-20T10:00:00Z",
      children: [],
    },
  ],
  session_read_file:
    "# Session plan\n\n- Extract the authentication plugin.\n- Add regression coverage.",
};

export async function visualInvoke(cmd, args, fallback) {
  window.__TRACEPILOT_VISUAL__ ??= { pending: 0, calls: {}, missing: [] };
  const state = window.__TRACEPILOT_VISUAL__;
  state.pending++;
  state.calls[cmd] = (state.calls[cmd] ?? 0) + 1;
  try {
    if (Object.hasOwn(overrides, cmd)) return structuredClone(overrides[cmd]);
    if (cmd === "preview_export") {
      const content =
        args.format === "markdown"
          ? "# Auth plugin refactor\n\nSynthetic TracePilot session export.\n\n## Conversation\n\n**User:** Refactor authentication into plugins while preserving token refresh.\n\n**Assistant:** The plugin registry now loads authentication providers independently.\n\n## Session plan\n\n- Extract the authentication provider.\n- Preserve refresh-token behavior.\n- Add regression coverage.\n\n## Todos\n\n- [x] Write browse presets\n- [ ] Add GitHub auth provider"
          : JSON.stringify(
              {
                session: { id: args.sessionId, summary: "Auth plugin refactor" },
                conversation: [
                  { role: "user", content: "Refactor authentication into plugins." },
                  { role: "assistant", content: "The plugin registry preserves token refresh." },
                ],
              },
              null,
              2,
            );
      return {
        content,
        format: args.format,
        estimatedSizeBytes: content.length,
        sectionCount: args.sections?.length ?? 0,
      };
    }
    if (!fallback) throw new Error(`Visual fixture missing: ${cmd}`);
    const result = structuredClone(await fallback(cmd, args));
    if (cmd === "get_session_detail") {
      result.summary =
        args.sessionId === "sess-search-polish" ? "Search preset cleanup" : "Auth plugin refactor";
    }
    if (cmd === "get_shutdown_metrics" && args.sessionId === "sess-search-polish") {
      result.codeChanges = { filesModified: [], linesAdded: 0, linesRemoved: 0 };
    }
    if (cmd === "get_config") {
      result.ui.theme = "dark";
      result.ui.autoRefreshEnabled = false;
      result.ui.checkForUpdates = false;
      result.ui.uiScale = 1;
      configureVisualFeatures(result, window.__TRACEPILOT_VISUAL_FEATURES__ ?? []);
    }
    return result;
  } catch (error) {
    state.missing.push({ command: cmd, message: String(error.message).slice(0, 200) });
    throw error;
  } finally {
    state.pending--;
  }
}
