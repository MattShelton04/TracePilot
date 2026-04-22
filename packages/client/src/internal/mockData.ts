import type {
  AttributionSnapshot,
  ExportPreviewResult,
  FreshnessResponse,
  HealthCheckResult,
  ImportPreviewResult,
  ImportResult,
  Job,
  OrchestratorHandle,
  SearchFacetsResponse,
  SearchResultsResponse,
  SearchStatsResponse,
  SessionSectionsInfo,
  Task,
  TaskPreset,
  TaskStats,
  TurnsResponse,
} from "@tracepilot/types";
import { createDefaultConfig } from "@tracepilot/types";

import type { GitInfo, UpdateCheckResult } from "../generated/bindings.js";

import type { ContextSnippet, FtsHealthInfo } from "../search.js";
// Note: the import above is `type`-only, so there is no runtime cycle with
// `search.ts` which imports the shared `invoke` helper from `./internal/core.js`.

let mocksModule: typeof import("../mock/index.js") | null = null;
async function getMocks() {
  if (!mocksModule) {
    mocksModule = await import("../mock/index.js");
  }
  return mocksModule;
}

/** Used by `search.ts`/`analytics.ts` to return `MOCK_HEALTH_SCORING`. */
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
    check_session_freshness: {
      eventsFileSize: 1024,
      eventsFileMtime: Date.now(),
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
      hasHealth: true,
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
    // Task system
    task_create: {
      id: "mock-task-id",
      jobId: null,
      taskType: "session_summary",
      presetId: "session-summary",
      status: "pending",
      priority: "normal",
      inputParams: {},
      contextHash: null,
      attemptCount: 0,
      maxRetries: 3,
      orchestratorSessionId: null,
      resultSummary: null,
      resultParsed: null,
      schemaValid: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    } as Task,
    task_create_batch: {
      id: "mock-job-id",
      name: "mock-batch",
      presetId: "session-summary",
      status: "pending",
      taskCount: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
      orchestratorSessionId: null,
    } as Job,
    task_get: {
      id: "mock-task-id",
      jobId: null,
      taskType: "session_summary",
      presetId: "session-summary",
      status: "pending",
      priority: "normal",
      inputParams: {},
      contextHash: null,
      attemptCount: 0,
      maxRetries: 3,
      orchestratorSessionId: null,
      resultSummary: null,
      resultParsed: null,
      schemaValid: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    } as Task,
    task_list: [] as Task[],
    task_cancel: undefined,
    task_retry: undefined,
    task_delete: undefined,
    task_stats: {
      total: 0,
      pending: 0,
      claimed: 0,
      inProgress: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
      expired: 0,
      deadLetter: 0,
    } as TaskStats,
    task_list_jobs: [] as Job[],
    task_cancel_job: undefined,
    task_list_presets: [] as TaskPreset[],
    task_get_preset: {
      id: "mock-preset",
      name: "Mock Preset",
      taskType: "mock_task",
      version: 1,
      description: "A mock preset",
      prompt: { system: "", user: "", variables: [] },
      context: { sources: [], maxChars: 50000, format: "markdown" },
      output: { schema: {}, format: "json", validation: "warn" },
      execution: { modelOverride: null, timeoutSeconds: 300, maxRetries: 3, priority: "normal" },
      tags: [],
      enabled: true,
      builtin: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as TaskPreset,
    task_save_preset: undefined,
    task_delete_preset: undefined,
    task_orchestrator_health: {
      health: "stopped",
      heartbeatAgeSecs: null,
      lastCycle: null,
      activeTasks: [],
      needsRestart: false,
      sessionUuid: null,
      sessionPath: null,
    } as HealthCheckResult,
    task_orchestrator_start: {
      pid: 0,
      sessionUuid: null,
      manifestPath: "",
      jobsDir: "",
      launchedAt: new Date().toISOString(),
    } as OrchestratorHandle,
    task_orchestrator_stop: undefined,
    task_ingest_results: 0,
    task_attribution: {
      subagents: [],
      eventsScanned: 0,
    } as AttributionSnapshot,
  };
  if (!(cmd in mockMap)) {
    throw new Error(`[STUB] No mock data for command: ${cmd}`);
  }
  return mockMap[cmd] as T;
}
