import type {
  AnalyticsData,
  AttributionSnapshot,
  CheckpointEntry,
  CodeImpactData,
  EventsResponse,
  ExportConfig,
  ExportPreviewRequest,
  ExportPreviewResult,
  ExportResult,
  FreshnessResponse,
  GitInfo,
  HealthCheckResult,
  HealthScoringData,
  ImportConfig,
  ImportPreviewResult,
  ImportResult,
  Job,
  NewTask,
  OrchestratorHandle,
  SearchFacetsResponse,
  SearchFilters,
  SearchResultsResponse,
  SearchStatsResponse,
  SessionDetail,
  SessionHealth,
  SessionIncident,
  SessionListItem,
  SessionPlan,
  SessionSectionsInfo,
  ShutdownMetrics,
  Task,
  TaskFilter,
  TaskPreset,
  TaskStats,
  TodosResponse,
  ToolAnalysisData,
  TracePilotConfig,
  TurnsResponse,
  UpdateCheckResult,
  ValidateSessionDirResult,
} from "@tracepilot/types";
import { createDefaultConfig } from "@tracepilot/types";

import { invokePlugin, isTauri } from "./invoke.js";

// Re-export IPC performance instrumentation utilities
export { clearIpcPerfLog, getIpcPerfLog } from "./invoke.js";

// Lazy-load mocks only when needed (non-Tauri / dev mode)
let mocksModule: typeof import("./mock/index.js") | null = null;
async function getMocks() {
  if (!mocksModule) {
    mocksModule = await import("./mock/index.js");
  }
  return mocksModule;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    return invokePlugin<T>(cmd, args);
  }
  console.warn(`[TracePilot] Not in Tauri — returning mock data for "${cmd}"`);
  return getMockData<T>(cmd, args);
}

async function getMockData<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const mocks = await getMocks();
  const mockSessionId = typeof args?.sessionId === "string" ? args.sessionId : "mock-id";

  // Mock search filters the session list
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
    get_session_turns: { turns: mocks.MOCK_TURNS, eventsFileSize: 1024 } as TurnsResponse,
    check_session_freshness: { eventsFileSize: 1024 } as FreshnessResponse,
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
    validate_session_dir: { valid: true, sessionCount: 47 },
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

export async function listSessions(options?: {
  limit?: number;
  repo?: string;
  branch?: string;
  hideEmpty?: boolean;
}): Promise<SessionListItem[]> {
  return invoke<SessionListItem[]>(
    "list_sessions",
    options
      ? {
          limit: options.limit,
          repo: options.repo,
          branch: options.branch,
          hideEmpty: options.hideEmpty,
        }
      : undefined,
  );
}

export async function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  return invoke<SessionDetail>("get_session_detail", { sessionId });
}

export async function getSessionIncidents(sessionId: string): Promise<SessionIncident[]> {
  return invoke<SessionIncident[]>("get_session_incidents", { sessionId });
}

export async function getSessionTurns(sessionId: string): Promise<TurnsResponse> {
  return invoke<TurnsResponse>("get_session_turns", { sessionId });
}

export async function checkSessionFreshness(sessionId: string): Promise<FreshnessResponse> {
  return invoke<FreshnessResponse>("check_session_freshness", { sessionId });
}

export async function getSessionEvents(
  sessionId: string,
  offset?: number,
  limit?: number,
  eventType?: string,
): Promise<EventsResponse> {
  return invoke<EventsResponse>("get_session_events", {
    sessionId,
    offset,
    limit,
    eventType: eventType ?? null,
  });
}

export async function getSessionTodos(sessionId: string): Promise<TodosResponse> {
  return invoke<TodosResponse>("get_session_todos", { sessionId });
}

export async function getSessionCheckpoints(sessionId: string): Promise<CheckpointEntry[]> {
  return invoke<CheckpointEntry[]>("get_session_checkpoints", { sessionId });
}

export async function getSessionPlan(sessionId: string): Promise<SessionPlan | null> {
  return invoke<SessionPlan | null>("get_session_plan", { sessionId });
}

export async function getShutdownMetrics(sessionId: string): Promise<ShutdownMetrics | null> {
  return invoke<ShutdownMetrics | null>("get_shutdown_metrics", { sessionId });
}

export async function searchSessions(query: string): Promise<SessionListItem[]> {
  return invoke<SessionListItem[]>("search_sessions", { query });
}

/** Returns [updated, total] session counts. */
export async function reindexSessions(): Promise<[number, number]> {
  return invoke<[number, number]>("reindex_sessions");
}

/** Delete the index DB and rebuild all analytics from scratch. Returns [rebuilt, total]. */
export async function reindexSessionsFull(): Promise<[number, number]> {
  return invoke<[number, number]>("reindex_sessions_full");
}

// ── Deep Search (FTS) ────────────────────────────────────────

/** Full-text search across all session content. */
export async function searchContent(
  query: string,
  filters?: SearchFilters,
): Promise<SearchResultsResponse> {
  return invoke<SearchResultsResponse>("search_content", {
    query,
    contentTypes: filters?.contentTypes,
    excludeContentTypes: filters?.excludeContentTypes,
    repositories: filters?.repositories,
    toolNames: filters?.toolNames,
    sessionId: filters?.sessionId,
    dateFromUnix: filters?.dateFromUnix,
    dateToUnix: filters?.dateToUnix,
    limit: filters?.limit,
    offset: filters?.offset,
    sortBy: filters?.sortBy,
  });
}

/** Get facet counts — pass query for result-scoped facets, omit for global. */
export async function getSearchFacets(
  query?: string,
  filters?: Pick<
    SearchFilters,
    | "contentTypes"
    | "excludeContentTypes"
    | "repositories"
    | "toolNames"
    | "sessionId"
    | "dateFromUnix"
    | "dateToUnix"
  >,
): Promise<SearchFacetsResponse> {
  return invoke<SearchFacetsResponse>("get_search_facets", {
    query,
    contentTypes: filters?.contentTypes,
    excludeContentTypes: filters?.excludeContentTypes,
    repositories: filters?.repositories,
    toolNames: filters?.toolNames,
    sessionId: filters?.sessionId,
    dateFromUnix: filters?.dateFromUnix,
    dateToUnix: filters?.dateToUnix,
  });
}

/** Get search index statistics. */
export async function getSearchStats(): Promise<SearchStatsResponse> {
  return invoke<SearchStatsResponse>("get_search_stats");
}

/** Get distinct repositories for the search filter dropdown. */
export async function getSearchRepositories(): Promise<string[]> {
  return invoke<string[]>("get_search_repositories");
}

/** Get distinct tool names for the search filter dropdown. */
export async function getSearchToolNames(): Promise<string[]> {
  return invoke<string[]>("get_search_tool_names");
}

/** Rebuild the search index from scratch. Returns [indexed, total]. */
export async function rebuildSearchIndex(): Promise<[number, number]> {
  return invoke<[number, number]>("rebuild_search_index");
}

/** Run FTS integrity check. Returns a status message. */
export async function ftsIntegrityCheck(): Promise<string> {
  return invoke<string>("fts_integrity_check");
}

/** Optimize the FTS index for better query performance. */
export async function ftsOptimize(): Promise<string> {
  return invoke<string>("fts_optimize");
}

/** FTS health information. */
export interface FtsHealthInfo {
  totalContentRows: number;
  ftsIndexRows: number;
  indexedSessions: number;
  totalSessions: number;
  pendingSessions: number;
  inSync: boolean;
  contentTypes: [string, number][];
  dbSizeBytes: number;
}

/** Get detailed FTS health information. */
export async function ftsHealth(): Promise<FtsHealthInfo> {
  return invoke<FtsHealthInfo>("fts_health");
}

/** Adjacent context snippet around a search result. */
export interface ContextSnippet {
  contentType: string;
  turnNumber: number | null;
  toolName: string | null;
  preview: string;
}

/** Get surrounding context for a search result (adjacent rows). */
export async function getResultContext(
  resultId: number,
  radius?: number,
): Promise<[ContextSnippet[], ContextSnippet[]]> {
  return invoke<[ContextSnippet[], ContextSnippet[]]>("get_result_context", {
    resultId,
    radius,
  });
}

/** Get aggregated analytics data across all sessions. */
export async function getAnalytics(options?: {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
}): Promise<AnalyticsData> {
  return invoke<AnalyticsData>("get_analytics", {
    fromDate: options?.fromDate,
    toDate: options?.toDate,
    repo: options?.repo,
    hideEmpty: options?.hideEmpty,
  });
}

/** Get tool usage analysis data across all sessions. */
export async function getToolAnalysis(options?: {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
}): Promise<ToolAnalysisData> {
  return invoke<ToolAnalysisData>("get_tool_analysis", {
    fromDate: options?.fromDate,
    toDate: options?.toDate,
    repo: options?.repo,
    hideEmpty: options?.hideEmpty,
  });
}

/** Get code impact analysis data across all sessions. */
export async function getCodeImpact(options?: {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
}): Promise<CodeImpactData> {
  return invoke<CodeImpactData>("get_code_impact", {
    fromDate: options?.fromDate,
    toDate: options?.toDate,
    repo: options?.repo,
    hideEmpty: options?.hideEmpty,
  });
}

/**
 * Get health scoring data across all sessions.
 * // STUB: Currently returns mock data. Replace with real Tauri IPC command
 * // STUB: when the health scoring backend API is implemented (Phase 6+).
 */
export async function getHealthScores(): Promise<HealthScoringData> {
  // STUB: No Tauri command exists yet for health scores.
  // STUB: When implemented, this should call: invoke('plugin:tracepilot|get_health_scores')
  const m = await getMocks();
  return m.MOCK_HEALTH_SCORING;
}

// ── Export / Import Commands ──────────────────────────────────

/** Export one or more sessions in the specified format. */
export async function exportSessions(config: ExportConfig): Promise<ExportResult> {
  return invoke<ExportResult>("export_sessions", {
    sessionIds: config.sessionIds,
    format: config.format,
    sections: config.sections,
    outputPath: config.outputPath,
    includeSubagentInternals: config.contentDetail?.includeSubagentInternals,
    includeToolDetails: config.contentDetail?.includeToolDetails,
    includeFullToolResults: config.contentDetail?.includeFullToolResults,
    anonymizePaths: config.redaction?.anonymizePaths,
    stripSecrets: config.redaction?.stripSecrets,
    stripPii: config.redaction?.stripPii,
  });
}

/** Get a live preview of what an export would look like. */
export async function previewExport(request: ExportPreviewRequest): Promise<ExportPreviewResult> {
  return invoke<ExportPreviewResult>("preview_export", {
    sessionId: request.sessionId,
    format: request.format,
    sections: request.sections,
    maxBytes: request.maxLength,
    includeSubagentInternals: request.contentDetail?.includeSubagentInternals,
    includeToolDetails: request.contentDetail?.includeToolDetails,
    includeFullToolResults: request.contentDetail?.includeFullToolResults,
    anonymizePaths: request.redaction?.anonymizePaths,
    stripSecrets: request.redaction?.stripSecrets,
    stripPii: request.redaction?.stripPii,
  });
}

/** Discover which sections have data for a given session. */
export async function getSessionSections(sessionId: string): Promise<SessionSectionsInfo> {
  return invoke<SessionSectionsInfo>("get_session_sections", { sessionId });
}

/** Preview a `.tpx.json` file before importing. */
export async function previewImport(filePath: string): Promise<ImportPreviewResult> {
  return invoke<ImportPreviewResult>("preview_import", { filePath });
}

/** Import sessions from a `.tpx.json` file. */
export async function importSessions(config: ImportConfig): Promise<ImportResult> {
  return invoke<ImportResult>("import_sessions", {
    filePath: config.filePath,
    conflictStrategy: config.conflictStrategy,
    sessionFilter: config.sessionFilter,
  });
}

/**
 * @deprecated Use `exportSessions` instead. Kept for backward compatibility.
 */
export async function exportSession(config: ExportConfig): Promise<ExportResult> {
  return exportSessions(config);
}

// ── Setup / Configuration Commands ────────────────────────────

/** Check if TracePilot config.toml exists (determines if setup is needed). */
export async function checkConfigExists(): Promise<boolean> {
  if (!isTauri()) return true; // In dev mode, skip setup
  return invoke<boolean>("check_config_exists");
}

/** Get the current TracePilot configuration. */
export async function getConfig(): Promise<TracePilotConfig> {
  return invoke<TracePilotConfig>("get_config");
}

/** Save TracePilot configuration (creates/updates config.toml). */
export async function saveConfig(config: TracePilotConfig): Promise<void> {
  return invoke<void>("save_config", { config });
}

/** Validate a session state directory path. */
export async function validateSessionDir(path: string): Promise<ValidateSessionDirResult> {
  if (!isTauri()) return { valid: true, sessionCount: 47 };
  return invoke<ValidateSessionDirResult>("validate_session_dir", { path });
}

/** Get the index database file size in bytes. */
export async function getDbSize(): Promise<number> {
  if (!isTauri()) return 44_564_480; // ~42.5 MB mock
  return invoke<number>("get_db_size");
}

/** Get the number of indexed sessions. */
export async function getSessionCount(): Promise<number> {
  if (!isTauri()) return 47;
  return invoke<number>("get_session_count");
}

/** Check if a session is currently running (has an inuse.*.lock file). */
export async function isSessionRunning(sessionId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("is_session_running", { sessionId });
}

/** Factory reset: delete config, index DB, and all app data. */
export async function factoryReset(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>("factory_reset");
}

/** Lazy-load the full result of a specific tool call. */
export async function getToolResult(
  sessionId: string,
  toolCallId: string,
): Promise<unknown | null> {
  return invoke<unknown | null>("get_tool_result", { sessionId, toolCallId });
}

/** Open a new terminal window running the configured CLI resume command. */
export async function resumeSessionInTerminal(
  sessionId: string,
  cliCommand?: string,
): Promise<void> {
  return invoke<void>("resume_session_in_terminal", { sessionId, cliCommand });
}

/** Check GitHub for a newer TracePilot release. Opt-in only. */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  return invoke<UpdateCheckResult>("check_for_updates");
}

/** Returns the install type: "source" | "installed" | "portable". */
export async function getInstallType(): Promise<string> {
  return invoke<string>("get_install_type");
}

/** Get git info (commit hash, branch) for the running instance. */
export async function getGitInfo(): Promise<GitInfo> {
  return invoke<GitInfo>("get_git_info");
}

// ── Logging Commands ──────────────────────────────────────────

/** Get the application log directory path. */
export async function getLogPath(): Promise<string> {
  return invoke<string>("get_log_path");
}

/** Export all log files to a single destination file. */
export async function exportLogs(destination: string): Promise<string> {
  return invoke<string>("export_logs", { destination });
}

// ─── Task System ──────────────────────────────────────────────────

/** Create a new task. */
export async function taskCreate(
  taskType: string,
  presetId: string,
  inputParams: Record<string, unknown> = {},
  priority?: string,
  maxRetries?: number,
): Promise<Task> {
  return invoke<Task>("task_create", {
    taskType,
    presetId,
    inputParams,
    priority,
    maxRetries,
  });
}

/** Create a batch of tasks as a job. */
export async function taskCreateBatch(
  tasks: NewTask[],
  jobName: string,
  presetId?: string,
): Promise<Job> {
  return invoke<Job>("task_create_batch", { tasks, jobName, presetId });
}

/** Get a single task by ID. */
export async function taskGet(id: string): Promise<Task> {
  return invoke<Task>("task_get", { id });
}

/** List tasks with optional filtering. */
export async function taskList(filter?: TaskFilter): Promise<Task[]> {
  return invoke<Task[]>("task_list", { filter });
}

/** Cancel a task. */
export async function taskCancel(id: string): Promise<void> {
  return invoke<void>("task_cancel", { id });
}

/** Retry a failed task. */
export async function taskRetry(id: string): Promise<void> {
  return invoke<void>("task_retry", { id });
}

/** Delete a task permanently. */
export async function taskDelete(id: string): Promise<void> {
  return invoke<void>("task_delete", { id });
}

/** Get aggregate task statistics. */
export async function taskStats(): Promise<TaskStats> {
  return invoke<TaskStats>("task_stats");
}

/** List jobs with optional limit. */
export async function taskListJobs(limit?: number): Promise<Job[]> {
  return invoke<Job[]>("task_list_jobs", { limit });
}

/** Cancel all pending tasks in a job. */
export async function taskCancelJob(jobId: string): Promise<void> {
  return invoke<void>("task_cancel_job", { jobId });
}

/** List all task presets. */
export async function taskListPresets(): Promise<TaskPreset[]> {
  return invoke<TaskPreset[]>("task_list_presets");
}

/** Get a single task preset by ID. */
export async function taskGetPreset(id: string): Promise<TaskPreset> {
  return invoke<TaskPreset>("task_get_preset", { id });
}

/** Save (create or update) a task preset. */
export async function taskSavePreset(preset: TaskPreset): Promise<void> {
  return invoke<void>("task_save_preset", { preset });
}

/** Delete a task preset. */
export async function taskDeletePreset(id: string): Promise<void> {
  return invoke<void>("task_delete_preset", { id });
}

/** Check orchestrator health status. */
export async function taskOrchestratorHealth(): Promise<HealthCheckResult> {
  return invoke<HealthCheckResult>("task_orchestrator_health");
}

/** Start the orchestrator. Optionally override the model. */
export async function taskOrchestratorStart(model?: string): Promise<OrchestratorHandle> {
  return invoke<OrchestratorHandle>("task_orchestrator_start", { model: model ?? null });
}

/** Stop the running orchestrator gracefully via manifest shutdown flag. */
export async function taskOrchestratorStop(): Promise<void> {
  return invoke<void>("task_orchestrator_stop");
}

/** Scan jobs directory and ingest completed task results into the DB. Returns count ingested. */
export async function taskIngestResults(): Promise<number> {
  return invoke<number>("task_ingest_results");
}

/** Get subagent attribution for an orchestrator session. */
export async function taskAttribution(sessionPath: string): Promise<AttributionSnapshot> {
  return invoke<AttributionSnapshot>("task_attribution", { sessionPath });
}

export * from "./mcp.js";
// Re-export orchestration module
export * from "./orchestration.js";
export * from "./skills.js";
export type { SessionHealth };
