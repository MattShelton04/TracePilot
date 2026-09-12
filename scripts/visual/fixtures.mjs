// Loaded ONLY by the visual harness's Vite transform. Not shipped in the app.
// Existing typed browser fixtures supply sessions, turns, metrics and charts.
// These additions cover domains whose normal browser mode has no fallback.
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
      for (const key of Object.keys(result.features)) result.features[key] = true;
    }
    return result;
  } catch (error) {
    state.missing.push({ command: cmd, message: String(error.message).slice(0, 200) });
    throw error;
  } finally {
    state.pending--;
  }
}
