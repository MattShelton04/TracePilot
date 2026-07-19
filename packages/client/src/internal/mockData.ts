import type {
  ContextTimeline,
  ContextTimelineResponse,
  ExportPreviewResult,
  FreshnessResponse,
  ImportPreviewResult,
  ImportResult,
  SearchFacetsResponse,
  SearchResultsResponse,
  SearchStatsResponse,
  SessionSectionsInfo,
  TurnsResponse,
} from "@tracepilot/types";
import { createDefaultConfig } from "@tracepilot/types";

import type { GitInfo, UpdateCheckResult } from "../generated/bindings.js";

import type { ContextSnippet, FtsHealthInfo } from "../search.js";

const MOCK_EVENTS_MTIME = 1_735_728_400_000;

// Numeric shape sampled from a real 90-turn Copilot CLI session. Content and
// identifiers are intentionally omitted; browser development only needs the
// chart geometry and observed/estimated transitions.
const MOCK_CONTEXT_TIMELINE: ContextTimeline = {
  turnCount: 90,
  observedPointCount: 2,
  estimatedPointCount: 8,
  compactionStartCount: 1,
  compactionCompleteCount: 1,
  pairedCompactionCount: 1,
  methodology:
    "Top-level layers are observed at Copilot compaction/shutdown anchors; between-anchor conversation totals are calibrated estimates.",
  reportedTokenLimit: 200_000,
  events: [
    {
      turn: 0,
      timestamp: null,
      kind: "userMessage",
      label: "User message",
      preview: "Investigate the session context behavior.",
    },
    {
      turn: 63,
      timestamp: null,
      kind: "sessionResume",
      label: "Session resumed",
      preview: "claude-sonnet",
    },
  ],
  points: [
    [0, "turn", 8756, 11012, 14218, "estimated"],
    [14, "turn", 8756, 11012, 64360, "estimated"],
    [29, "turn", 8756, 11012, 86154, "estimated"],
    [44, "turn", 8756, 11012, 93414, "estimated"],
    [59, "turn", 8756, 11012, 109898, "estimated"],
    [71, "turn", 8756, 11145, 140579, "estimated"],
    [72, "preCompaction", 8756, 11145, 141166, "observed"],
    [72, "postCompaction", 8756, 11145, 2130, "estimated"],
    [74, "turn", 8756, 11012, 5115, "estimated"],
    [89, "shutdown", 8756, 11012, 26021, "observed"],
  ].map(([turn, phase, system, definitions, conversation, source]) => ({
    turn: turn as number,
    phase: phase as ContextTimeline["points"][number]["phase"],
    timestamp: null,
    systemTokens: system as number,
    toolDefinitionTokens: definitions as number,
    conversationTokens: conversation as number,
    contextChangeTokens: null,
    totalTokens: (system as number) + (definitions as number) + (conversation as number),
    source: source as ContextTimeline["points"][number]["source"],
  })),
  compactions: [
    {
      startTurn: 72,
      completeTurn: 72,
      timestamp: null,
      success: true,
      checkpointNumber: 1,
      beforeTokens: 161067,
      afterTokens: 22031,
      tokensRemoved: 139036,
      afterSource: "estimated",
      summaryTokens: 2130,
    },
  ],
  topToolCalls: [
    {
      turn: 0,
      toolName: "web_fetch",
      argumentTokens: 25,
      resultTokens: 10249,
      totalTokens: 10274,
      success: true,
    },
    {
      turn: 63,
      toolName: "powershell",
      argumentTokens: 54,
      resultTokens: 9279,
      totalTokens: 9333,
      success: true,
    },
    {
      turn: 63,
      toolName: "view",
      argumentTokens: 18,
      resultTokens: 9290,
      totalTokens: 9308,
      success: true,
    },
  ],
  toolTypes: [
    {
      toolName: "view",
      callCount: 89,
      errorCount: 1,
      argumentTokens: 2023,
      resultTokens: 226448,
      totalTokens: 228471,
      percentage: 49.1841,
    },
    {
      toolName: "powershell",
      callCount: 84,
      errorCount: 0,
      argumentTokens: 4731,
      resultTokens: 92543,
      totalTokens: 97274,
      percentage: 20.9407,
    },
    {
      toolName: "rg",
      callCount: 33,
      errorCount: 0,
      argumentTokens: 1735,
      resultTokens: 59737,
      totalTokens: 61472,
      percentage: 13.2334,
    },
  ],
};

// Note: the import above is `type`-only, so there is no runtime cycle with
// `search.ts` which imports the shared `invoke` helper from `./internal/core.js`.

let mocksModule: typeof import("../mock/index.js") | null = null;
async function getMocks() {
  if (!mocksModule) {
    mocksModule = await import("../mock/index.js");
  }
  return mocksModule;
}

/** Used by client modules that need direct access to mock datasets. */
export { getMocks };

/**
 * Fallback mock data source used when running outside the Tauri webview.
 * Extracted from the original `packages/client/src/index.ts`.
 */
export async function getMockData<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const mocks = await getMocks();
  const mockSessionId = typeof args?.sessionId === "string" ? args.sessionId : "mock-id";

  const searchQuery = typeof args?.query === "string" ? args.query.toLowerCase() : "";

  const mockMap: Record<string, unknown> = {
    list_sessions: mocks.MOCK_SESSIONS,
    get_session_detail: mocks.getMockSessionDetail(mockSessionId),
    get_session_incidents: [
      {
        eventType: "error",
        sourceEventType: "session.error",
        timestamp: "2025-01-15T10:30:00Z",
        severity: "error" as const,
        summary: "Rate limit exceeded (429)",
        detailJson: { statusCode: 429, errorCode: "rate_limit" },
      },
      {
        eventType: "compaction",
        sourceEventType: "session.compaction_complete",
        timestamp: "2025-01-15T11:00:00Z",
        severity: "info" as const,
        summary: "Compaction: 45000 → 12000 tokens",
        detailJson: { preCompactionTokens: 45000, postCompactionTokens: 12000 },
      },
    ],
    get_session_turns: {
      turns: mocks.MOCK_TURNS,
      eventsFileSize: 1024,
      eventsFileMtime: Date.now(),
    } as TurnsResponse,
    get_session_context_timeline: {
      timeline: MOCK_CONTEXT_TIMELINE,
      eventsFileSize: 1024,
      eventsFileMtime: MOCK_EVENTS_MTIME,
    } as ContextTimelineResponse,
    check_session_freshness: {
      eventsFileSize: 1024,
      eventsFileMtime: MOCK_EVENTS_MTIME,
    } as FreshnessResponse,
    get_session_events: mocks.MOCK_EVENTS,
    get_session_todos: mocks.MOCK_TODOS,
    get_session_checkpoints: mocks.MOCK_CHECKPOINTS,
    get_session_plan: { content: "# Mock Plan\n\n1. Task one\n2. Task two" },
    get_shutdown_metrics: mocks.MOCK_SHUTDOWN_METRICS,
    search_sessions: searchQuery
      ? mocks.MOCK_SESSIONS.filter((s) =>
          [s.summary, s.repository, s.branch, s.id].some((f) =>
            f?.toLowerCase().includes(searchQuery),
          ),
        )
      : mocks.MOCK_SESSIONS,
    reindex_sessions: [0, 0] as [number, number],
    reindex_sessions_full: [0, 0] as [number, number],
    get_analytics: mocks.MOCK_ANALYTICS,
    get_tool_analysis: mocks.MOCK_TOOL_ANALYSIS,
    get_code_impact: mocks.MOCK_CODE_IMPACT,
    check_config_exists: true,
    get_config: createDefaultConfig({
      paths: {
        sessionStateDir: "~/.copilot/session-state",
        indexDbPath: "~/.copilot/tracepilot/index.db",
      },
      general: {
        setupComplete: true,
      },
    }),
    save_config: undefined,
    validate_session_dir: { valid: true, sessionCount: 47, error: null },
    get_db_size: 44564480,
    get_session_count: 47,
    factory_reset: undefined,
    get_tool_result: (() => {
      const toolCallId = typeof args?.toolCallId === "string" ? args.toolCallId : "";
      for (const turn of mocks.MOCK_TURNS) {
        const tc = turn.toolCalls?.find((t) => t.toolCallId === toolCallId);
        if (tc && tc.resultContent != null) return tc.resultContent;
      }
      return null;
    })(),
    resume_session_in_terminal: undefined,
    check_for_updates: {
      currentVersion: "0.1.0",
      latestVersion: "0.1.0",
      hasUpdate: false,
      releaseUrl: null,
      publishedAt: null,
    } as UpdateCheckResult,
    get_git_info: { commitHash: "abc1234", branch: "main" } as GitInfo,
    is_session_running: false,
    get_log_path: "~/.local/share/dev.tracepilot.app/logs",
    export_logs: "Exported 1 log file(s) to /tmp/tracepilot-logs.txt",
    // Search commands
    search_content: {
      results: [],
      totalCount: 0,
      hasMore: false,
      query: "",
      latencyMs: 0,
    } as SearchResultsResponse,
    get_search_facets: {
      byContentType: [],
      byRepository: [],
      byToolName: [],
      totalMatches: 0,
      sessionCount: 0,
    } as SearchFacetsResponse,
    get_search_stats: {
      totalRows: 0,
      indexedSessions: 0,
      totalSessions: 0,
      contentTypeCounts: [],
    } as SearchStatsResponse,
    get_search_repositories: [] as string[],
    get_search_tool_names: [] as string[],
    rebuild_search_index: [0, 0] as [number, number],
    // FTS maintenance commands
    fts_integrity_check: "ok",
    fts_optimize: "ok",
    fts_health: {
      totalContentRows: 332,
      ftsIndexRows: 332,
      indexedSessions: 47,
      totalSessions: 47,
      pendingSessions: 0,
      inSync: true,
      contentTypes: [
        ["user_message", 120],
        ["assistant_message", 118],
        ["tool_result", 94],
      ] as [string, number][],
      dbSizeBytes: 44_564_480,
    } as FtsHealthInfo,
    get_result_context: [[], []] as [ContextSnippet[], ContextSnippet[]],
    // Export / Import commands
    export_sessions: mocks.MOCK_EXPORT_RESULT,
    preview_export: {
      content: "# Export Preview\n\nNo content selected.",
      format: "markdown",
      estimatedSizeBytes: 42,
      sectionCount: 0,
    } as ExportPreviewResult,
    get_session_sections: {
      sessionId: mockSessionId,
      hasConversation: true,
      hasEvents: true,
      hasTodos: true,
      hasPlan: true,
      hasCheckpoints: true,
      hasMetrics: true,
      hasIncidents: true,
      hasRewindSnapshots: false,
      hasCustomTables: false,
      eventCount: 240,
      turnCount: 8,
    } as SessionSectionsInfo,
    preview_import: {
      valid: true,
      issues: [],
      sessions: [
        {
          id: "sess-imported-1",
          summary: "Imported session",
          repository: "tracepilot/app",
          createdAt: "2026-01-15T10:00:00Z",
          sectionCount: 5,
          alreadyExists: false,
        },
      ],
      schemaVersion: "1.0",
      needsMigration: false,
    } as ImportPreviewResult,
    import_sessions: {
      importedCount: 1,
      skippedCount: 0,
      warnings: [],
    } as ImportResult,
    // System info
    get_install_type: "source",
  };
  if (!(cmd in mockMap)) {
    throw new Error(`[STUB] No mock data for command: ${cmd}`);
  }
  return mockMap[cmd] as T;
}
