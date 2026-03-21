import type {
  AnalyticsData,
  CheckpointEntry,
  CodeImpactData,
  ConversationTurn,
  EventsResponse,
  ExportConfig,
  ExportResult,
  GitInfo,
  HealthScoringData,
  SessionDetail,
  SessionHealth,
  SessionIncident,
  SessionListItem,
  ShutdownMetrics,
  TodosResponse,
  ToolAnalysisData,
  TracePilotConfig,
  UpdateCheckResult,
  ValidateSessionDirResult,
} from '@tracepilot/types';

import {
  getMockSessionDetail,
  MOCK_ANALYTICS,
  MOCK_CHECKPOINTS,
  MOCK_CODE_IMPACT,
  MOCK_EVENTS,
  MOCK_EXPORT_RESULT,
  MOCK_HEALTH_SCORING,
  MOCK_SESSIONS,
  MOCK_SHUTDOWN_METRICS,
  MOCK_TODOS,
  MOCK_TOOL_ANALYSIS,
  MOCK_TURNS,
} from './mock/index.js';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    return tauriInvoke<T>(`plugin:tracepilot|${cmd}`, args);
  }
  console.warn(`[TracePilot] Not in Tauri — returning mock data for "${cmd}"`);
  return getMockData<T>(cmd, args);
}

function getMockData<T>(cmd: string, args?: Record<string, unknown>): T {
  const mockSessionId = typeof args?.sessionId === 'string' ? args.sessionId : 'mock-id';

  // Mock search filters the session list
  const searchQuery = typeof args?.query === 'string' ? args.query.toLowerCase() : '';

  const mocks: Record<string, unknown> = {
    list_sessions: MOCK_SESSIONS,
    get_session_detail: getMockSessionDetail(mockSessionId),
    get_session_incidents: [
      {
        eventType: 'error',
        sourceEventType: 'session.error',
        timestamp: '2025-01-15T10:30:00Z',
        severity: 'error' as const,
        summary: 'Rate limit exceeded (429)',
        detailJson: { statusCode: 429, errorCode: 'rate_limit' },
      },
      {
        eventType: 'compaction',
        sourceEventType: 'session.compaction_complete',
        timestamp: '2025-01-15T11:00:00Z',
        severity: 'info' as const,
        summary: 'Compaction: 45000 → 12000 tokens',
        detailJson: { preCompactionTokens: 45000, postCompactionTokens: 12000 },
      },
    ],
    get_session_turns: MOCK_TURNS,
    get_session_events: MOCK_EVENTS,
    get_session_todos: MOCK_TODOS,
    get_session_checkpoints: MOCK_CHECKPOINTS,
    get_shutdown_metrics: MOCK_SHUTDOWN_METRICS,
    search_sessions: searchQuery
      ? MOCK_SESSIONS.filter((s) =>
          [s.summary, s.repository, s.branch, s.id].some((f) =>
            f?.toLowerCase().includes(searchQuery),
          ),
        )
      : MOCK_SESSIONS,
    reindex_sessions: [0, 0] as [number, number],
    reindex_sessions_full: [0, 0] as [number, number],
    get_analytics: MOCK_ANALYTICS,
    get_tool_analysis: MOCK_TOOL_ANALYSIS,
    get_code_impact: MOCK_CODE_IMPACT,
    check_config_exists: true,
    get_config: {
      version: 2,
      paths: {
        sessionStateDir: '~/.copilot/session-state',
        indexDbPath: '~/.copilot/tracepilot/index.db',
      },
      general: { autoIndexOnLaunch: true, cliCommand: 'copilot' },
      ui: {
        theme: 'dark',
        hideEmptySessions: true,
        autoRefreshEnabled: false,
        autoRefreshIntervalSeconds: 5,
        checkForUpdates: false,
        favouriteModels: ['claude-opus-4.6', 'gpt-5.4', 'gpt-5.3-codex'],
        recentRepoPaths: [],
      },
      pricing: { costPerPremiumRequest: 0.04, models: [] },
      toolRendering: { enabled: true, toolOverrides: {} },
      features: { exportView: false, healthScoring: false, sessionReplay: false },
      logging: { level: 'info' },
    },
    save_config: undefined,
    validate_session_dir: { valid: true, sessionCount: 47 },
    get_db_size: 44564480,
    get_session_count: 47,
    factory_reset: undefined,
    get_tool_result: (() => {
      const toolCallId = typeof args?.toolCallId === 'string' ? args.toolCallId : '';
      for (const turn of MOCK_TURNS) {
        const tc = turn.toolCalls?.find((t) => t.toolCallId === toolCallId);
        if (tc && tc.resultContent != null) return tc.resultContent;
      }
      return null;
    })(),
    resume_session_in_terminal: undefined,
    check_for_updates: {
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
      hasUpdate: false,
      releaseUrl: null,
      publishedAt: null,
    } as UpdateCheckResult,
    get_git_info: { commitHash: 'abc1234', branch: 'main' } as GitInfo,
    is_session_running: false,
    get_log_path: '~/.local/share/dev.tracepilot.app/logs',
    export_logs: 'Exported 1 log file(s) to /tmp/tracepilot-logs.txt',
  };
  if (!(cmd in mocks)) {
    throw new Error(`[STUB] No mock data for command: ${cmd}`);
  }
  return mocks[cmd] as T;
}

export async function listSessions(options?: {
  limit?: number;
  repo?: string;
  branch?: string;
  hideEmpty?: boolean;
}): Promise<SessionListItem[]> {
  return invoke<SessionListItem[]>(
    'list_sessions',
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
  return invoke<SessionDetail>('get_session_detail', { sessionId });
}

export async function getSessionIncidents(sessionId: string): Promise<SessionIncident[]> {
  return invoke<SessionIncident[]>('get_session_incidents', { sessionId });
}

export async function getSessionTurns(sessionId: string): Promise<ConversationTurn[]> {
  return invoke<ConversationTurn[]>('get_session_turns', { sessionId });
}

export async function getSessionEvents(
  sessionId: string,
  offset?: number,
  limit?: number,
): Promise<EventsResponse> {
  return invoke<EventsResponse>('get_session_events', { sessionId, offset, limit });
}

export async function getSessionTodos(sessionId: string): Promise<TodosResponse> {
  return invoke<TodosResponse>('get_session_todos', { sessionId });
}

export async function getSessionCheckpoints(sessionId: string): Promise<CheckpointEntry[]> {
  return invoke<CheckpointEntry[]>('get_session_checkpoints', { sessionId });
}

export async function getShutdownMetrics(sessionId: string): Promise<ShutdownMetrics | null> {
  return invoke<ShutdownMetrics | null>('get_shutdown_metrics', { sessionId });
}

export async function searchSessions(query: string): Promise<SessionListItem[]> {
  return invoke<SessionListItem[]>('search_sessions', { query });
}

/** Returns [updated, total] session counts. */
export async function reindexSessions(): Promise<[number, number]> {
  return invoke<[number, number]>('reindex_sessions');
}

/** Delete the index DB and rebuild all analytics from scratch. Returns [rebuilt, total]. */
export async function reindexSessionsFull(): Promise<[number, number]> {
  return invoke<[number, number]>('reindex_sessions_full');
}

/** Get aggregated analytics data across all sessions. */
export async function getAnalytics(options?: {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
}): Promise<AnalyticsData> {
  return invoke<AnalyticsData>('get_analytics', {
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
  return invoke<ToolAnalysisData>('get_tool_analysis', {
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
  return invoke<CodeImpactData>('get_code_impact', {
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
  return MOCK_HEALTH_SCORING;
}

/**
 * Export one or more sessions in the specified format.
 * // STUB: Currently returns mock data. Replace with real Tauri IPC command
 * // STUB: when the export backend API is implemented (Phase 6+).
 */
export async function exportSession(_config: ExportConfig): Promise<ExportResult> {
  // STUB: No Tauri command exists yet for export.
  // STUB: When implemented, this should call: invoke('plugin:tracepilot|export_session', { config })
  return MOCK_EXPORT_RESULT;
}

// ── Setup / Configuration Commands ────────────────────────────

/** Check if TracePilot config.toml exists (determines if setup is needed). */
export async function checkConfigExists(): Promise<boolean> {
  if (!isTauri()) return true; // In dev mode, skip setup
  return invoke<boolean>('check_config_exists');
}

/** Get the current TracePilot configuration. */
export async function getConfig(): Promise<TracePilotConfig> {
  return invoke<TracePilotConfig>('get_config');
}

/** Save TracePilot configuration (creates/updates config.toml). */
export async function saveConfig(config: TracePilotConfig): Promise<void> {
  return invoke<void>('save_config', { config });
}

/** Validate a session state directory path. */
export async function validateSessionDir(path: string): Promise<ValidateSessionDirResult> {
  if (!isTauri()) return { valid: true, sessionCount: 47 };
  return invoke<ValidateSessionDirResult>('validate_session_dir', { path });
}

/** Get the index database file size in bytes. */
export async function getDbSize(): Promise<number> {
  if (!isTauri()) return 44_564_480; // ~42.5 MB mock
  return invoke<number>('get_db_size');
}

/** Get the number of indexed sessions. */
export async function getSessionCount(): Promise<number> {
  if (!isTauri()) return 47;
  return invoke<number>('get_session_count');
}

/** Check if a session is currently running (has an inuse.*.lock file). */
export async function isSessionRunning(sessionId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>('is_session_running', { sessionId });
}

/** Factory reset: delete config, index DB, and all app data. */
export async function factoryReset(): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>('factory_reset');
}

/** Lazy-load the full result of a specific tool call. */
export async function getToolResult(
  sessionId: string,
  toolCallId: string,
): Promise<unknown | null> {
  return invoke<unknown | null>('get_tool_result', { sessionId, toolCallId });
}

/** Open a new terminal window running the configured CLI resume command. */
export async function resumeSessionInTerminal(
  sessionId: string,
  cliCommand?: string,
): Promise<void> {
  return invoke<void>('resume_session_in_terminal', { sessionId, cliCommand });
}

/** Check GitHub for a newer TracePilot release. Opt-in only. */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  return invoke<UpdateCheckResult>('check_for_updates');
}

/** Returns true when running a debug/dev build (i.e. `tauri dev`). */
export async function isDevBuild(): Promise<boolean> {
  return invoke<boolean>('is_dev_build');
}

/** Get git info (commit hash, branch) for the running instance. */
export async function getGitInfo(): Promise<GitInfo> {
  return invoke<GitInfo>('get_git_info');
}

// ── Logging Commands ──────────────────────────────────────────

/** Get the application log directory path. */
export async function getLogPath(): Promise<string> {
  return invoke<string>('get_log_path');
}

/** Export all log files to a single destination file. */
export async function exportLogs(destination: string): Promise<string> {
  return invoke<string>('export_logs', { destination });
}

export type { SessionHealth };

// Re-export orchestration module
export * from './orchestration.js';
