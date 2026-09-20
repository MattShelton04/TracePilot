// Loaded ONLY by the visual harness's Vite transform. Not shipped in the app.
// Existing typed browser fixtures supply sessions, turns, metrics and charts.
// These additions cover domains whose normal browser mode has no fallback.
import { configureVisualFeatures } from "./feature-policy.mjs";

export const skill = {
  name: "visual-review",
  description: "Review a change for clarity, correctness, and useful tests.",
  scope: "global",
  directory: "/visual-fixtures/skills/visual-review",
  frontmatterTokens: 28,
  instructionTokens: 180,
  enabled: true,
  hasAssets: false,
  assetCount: 0,
  modifiedAt: "2026-09-10T09:00:00Z",
  contentSha256: "visual-review-sha",
};

/** Deterministic daily counts, so the sparkline is identical every run. */
const skillDays = Array.from({ length: 12 }, (_, index) => ({
  date: `2026-09-${String(index + 4).padStart(2, "0")}`,
  uses: [3, 1, 4, 2, 6, 5, 2, 7, 4, 3, 8, 5][index],
}));

/**
 * Usage for `visual-review`, with the coverage gaps the real corpus has: no
 * trigger on most invocations and a handful of tool-call-only rows. The
 * second row has no install behind it, which is the "missing skill" card.
 */
const skillUsage = {
  name: skill.name,
  normalizedName: skill.name,
  description: skill.description,
  uses: 50,
  sessions: 14,
  repositories: 2,
  firstUsed: "2026-09-04T08:15:00Z",
  lastUsed: "2026-09-15T17:40:00Z",
  userInvoked: 6,
  agentInvoked: 12,
  unknownTrigger: 32,
  mainAgentUses: 41,
  subagentUses: 9,
  fallbackUses: 4,
  medianContentTokens: 1840,
  usesWithContent: 46,
  latestContentSha256: "visual-review-sha",
  contentVersions: 2,
  paths: [{ path: `${skill.directory}/SKILL.md`, directory: skill.directory, uses: 50 }],
  topModels: [{ label: "claude-opus-5", uses: 34 }],
  topRepositories: [{ label: "tracepilot/app", uses: 38 }],
  dailyUses: skillDays,
  pluginName: null,
  source: "personal",
};

const missingSkillUsage = {
  ...skillUsage,
  name: "retired-migration-helper",
  normalizedName: "retired-migration-helper",
  description: "A skill that ran in past sessions but is no longer installed.",
  uses: 9,
  sessions: 3,
  repositories: 1,
  userInvoked: 0,
  agentInvoked: 0,
  unknownTrigger: 9,
  mainAgentUses: 9,
  subagentUses: 0,
  fallbackUses: 0,
  medianContentTokens: 620,
  usesWithContent: 9,
  latestContentSha256: "retired-sha",
  contentVersions: 1,
  paths: [
    {
      path: "/visual-fixtures/skills/retired-migration-helper/SKILL.md",
      directory: "/visual-fixtures/skills/retired-migration-helper",
      uses: 9,
    },
  ],
  topModels: [],
  topRepositories: [{ label: "tracepilot/app", uses: 9 }],
  dailyUses: skillDays.slice(0, 4),
  source: "project",
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
  skills_usage_summary: {
    totalUses: 59,
    totalSessions: 16,
    unknownTriggerUses: 41,
    fallbackUses: 4,
    totalContentTokens: 98_420,
    usesWithContent: 55,
    skills: [skillUsage, missingSkillUsage],
  },
  skills_usage_detail: {
    stats: skillUsage,
    invokedBy: [
      { label: "Main agent", uses: 41 },
      { label: "explore", uses: 9 },
    ],
    models: [{ label: "claude-opus-5", uses: 34 }],
    repositories: [
      { label: "tracepilot/app", uses: 38 },
      { label: "tracepilot/docs", uses: 12 },
    ],
    recentInvocations: [
      {
        sessionId: "sess-auth-refactor",
        sessionSummary: "Refactor the auth module into plugins",
        repository: "tracepilot/app",
        turnIndex: 12,
        eventIndex: 88,
        timestamp: "2026-09-15T17:40:00Z",
        skillName: skill.name,
        path: `${skill.directory}/SKILL.md`,
        trigger: "user-invoked",
        agentName: null,
        model: "claude-opus-5",
        contentTokens: 1840,
        contentSha256: "visual-review-sha",
        origin: "event",
      },
      {
        sessionId: "sess-auth-refactor",
        sessionSummary: "Refactor the auth module into plugins",
        repository: "tracepilot/app",
        turnIndex: 9,
        eventIndex: 61,
        timestamp: "2026-09-14T11:05:00Z",
        skillName: skill.name,
        path: null,
        trigger: null,
        agentName: "explore",
        model: null,
        contentTokens: null,
        contentSha256: null,
        origin: "tool_call_fallback",
      },
    ],
  },
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
