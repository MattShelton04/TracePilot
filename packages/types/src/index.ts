export * from './orchestration.js';
export * from './models.js';
export * from './defaults.js';

/** Session list item (enriched from workspace.yaml + events) */
export interface SessionListItem {
  id: string;
  summary?: string;
  repository?: string;
  branch?: string;
  hostType?: string;
  createdAt?: string;
  updatedAt?: string;
  eventCount?: number;
  turnCount?: number;
  currentModel?: string;
  /** Whether this session is currently running (has an `inuse.*.lock` file). */
  isRunning: boolean;
  errorCount?: number;
  rateLimitCount?: number;
  compactionCount?: number;
  truncationCount?: number;
}

/** A session incident (error, rate limit, compaction, or truncation). */
export interface SessionIncident {
  eventType: string;
  sourceEventType: string;
  timestamp?: string;
  severity: 'error' | 'warning' | 'info';
  summary: string;
  detailJson?: unknown;
}

/** Full session detail from load_session_summary */
export interface SessionDetail {
  id: string;
  summary?: string;
  repository?: string;
  branch?: string;
  cwd?: string;
  gitRoot?: string;
  hostType?: string;
  createdAt?: string;
  updatedAt?: string;
  eventCount?: number;
  turnCount?: number;
  hasPlan: boolean;
  hasCheckpoints: boolean;
  checkpointCount?: number;
  shutdownMetrics?: ShutdownMetrics;
}

/** Shutdown metrics from session.shutdown event */
export interface ShutdownMetrics {
  shutdownType?: string;
  shutdownCount?: number;
  totalPremiumRequests?: number;
  totalApiDurationMs?: number;
  sessionStartTime?: number;
  currentModel?: string;
  codeChanges?: CodeChanges;
  modelMetrics?: Record<string, ModelMetricDetail>;
}

export interface CodeChanges {
  linesAdded?: number;
  linesRemoved?: number;
  filesModified?: string[];
}

export interface ModelMetricDetail {
  requests?: { count?: number; cost?: number };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

/** A message or reasoning text attributed to the agent that produced it. */
export interface AttributedMessage {
  content: string;
  /** Links to the subagent's toolCallId, or undefined for the main agent. */
  parentToolCallId?: string;
  /** Denormalized display name of the owning agent (e.g. "Explore Agent"). */
  agentDisplayName?: string;
}

/** A conversation turn */
export interface ConversationTurn {
  turnIndex: number;
  /** Index of the event that opened this turn (for deep-linking from search). */
  eventIndex?: number;
  turnId?: string;
  interactionId?: string;
  userMessage?: string;
  /** Assistant messages with agent attribution (who produced each message). */
  assistantMessages: AttributedMessage[];
  model?: string;
  timestamp?: string;
  endTimestamp?: string;
  toolCalls: TurnToolCall[];
  durationMs?: number;
  isComplete: boolean;
  /** Reasoning/thinking texts with agent attribution. */
  reasoningTexts?: AttributedMessage[];
  /** Total output tokens consumed during this turn. */
  outputTokens?: number;
  /** The transformed/enriched user message content (includes system-injected context). */
  transformedUserMessage?: string;
  /** File attachments provided with the user message. */
  attachments?: unknown[];
  /** Session-level events (errors, compactions, etc.) that occurred during this turn. */
  sessionEvents?: TurnSessionEvent[];
}

/** Severity level for session events embedded in a conversation turn. */
export type SessionEventSeverity = 'error' | 'warning' | 'info';

/** A session-level event that occurred during a conversation turn. */
export interface TurnSessionEvent {
  /** Wire event type (e.g. "session.error", "session.compaction_complete"). */
  eventType: string;
  timestamp?: string;
  severity: SessionEventSeverity;
  /** Human-readable summary of what happened. */
  summary: string;
}

/** A tool call within a turn */
export interface TurnToolCall {
  toolCallId?: string;
  parentToolCallId?: string;
  toolName: string;
  /** Index of the ToolExecutionStart event in the session event stream (for deep-linking). */
  eventIndex?: number;
  arguments?: unknown;
  success?: boolean;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  mcpServerName?: string;
  mcpToolName?: string;
  isComplete: boolean;
  /** Whether this tool call represents a subagent invocation. */
  isSubagent?: boolean;
  /** Human-readable display name of the subagent (e.g. "Explore Agent"). */
  agentDisplayName?: string;
  /** Description of what the subagent does. */
  agentDescription?: string;
  /** The model used for this specific tool call. */
  model?: string;
  /** AI-generated summary of what this tool call intends to do. */
  intentionSummary?: string;
  /** Truncated preview of the tool result (≤1 KB). Use getToolResult() for full content. */
  resultContent?: string;
  /** Short summary of arguments, computed server-side for IPC efficiency. */
  argsSummary?: string;
}

/** Response from get_session_turns — includes file size for freshness tracking. */
export interface TurnsResponse {
  turns: ConversationTurn[];
  eventsFileSize: number;
}

/** Lightweight freshness probe response. */
export interface FreshnessResponse {
  eventsFileSize: number;
}

/** Session health assessment */
export interface SessionHealth {
  score: number;
  flags: HealthFlag[];
}

export interface HealthFlag {
  severity: 'info' | 'warning' | 'error';
  category: string;
  message: string;
}

/** Paginated events response */
export interface EventsResponse {
  events: SessionEvent[];
  totalCount: number;
  hasMore: boolean;
}

/** Raw event from events.jsonl */
export interface SessionEvent {
  eventType: string;
  timestamp?: string;
  id?: string;
  parentId?: string;
  data: Record<string, unknown>;
}

/** Todo item from session.db */
export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Session plan content from plan.md */
export interface SessionPlan {
  content: string;
}

/** Todo dependency */
export interface TodoDep {
  todoId: string;
  dependsOn: string;
}

/** Todos response */
export interface TodosResponse {
  todos: TodoItem[];
  deps: TodoDep[];
}

/** Checkpoint entry */
export interface CheckpointEntry {
  number: number;
  title: string;
  filename: string;
  content?: string;
}

// ===== Analytics Types =====

/** Aggregated analytics data across all sessions */
export interface AnalyticsData {
  /** Total number of sessions analyzed */
  totalSessions: number;
  /** Total tokens used across all sessions */
  totalTokens: number;
  /** Total cost in USD across all sessions */
  totalCost: number;
  /** Total premium requests across all sessions */
  totalPremiumRequests: number;
  /** Average health score (0-1) */
  averageHealthScore: number;
  /** Token usage per day for trend charts */
  tokenUsageByDay: Array<{ date: string; tokens: number }>;
  /** Session count per day */
  sessionsPerDay: Array<{ date: string; count: number }>;
  /** Model distribution by total tokens */
  modelDistribution: Array<{
    model: string;
    tokens: number;
    percentage: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    premiumRequests: number;
    requestCount: number;
  }>;
  /** Cost per day for trend charts */
  costByDay: Array<{ date: string; cost: number }>;
  /** API duration statistics (avg, median, p95 of total_api_duration_ms per session) */
  apiDurationStats: ApiDurationStats;
  /** Productivity heuristics */
  productivityMetrics: ProductivityMetrics;
  /** Prompt cache efficiency metrics */
  cacheStats: CacheStats;
  /** Distribution of sessions by health score tier */
  healthDistribution: HealthDistribution;
  sessionsWithErrors: number;
  totalRateLimits: number;
  totalCompactions: number;
  totalTruncations: number;
  incidentsByDay: Array<{
    date: string;
    errors: number;
    rateLimits: number;
    compactions: number;
    truncations: number;
  }>;
}

/** API duration statistics (avg, median, p95) computed from total_api_duration_ms */
export interface ApiDurationStats {
  avgMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  totalSessionsWithDuration: number;
}

/** Productivity heuristics across sessions */
export interface ProductivityMetrics {
  avgTurnsPerSession: number;
  avgToolCallsPerTurn: number;
  avgTokensPerTurn: number;
  /** Average tokens generated per second of API time (throughput indicator). */
  avgTokensPerApiSecond: number;
}

/** Prompt cache efficiency metrics */
export interface CacheStats {
  /** Total tokens served from prompt cache across all sessions */
  totalCacheReadTokens: number;
  /** Total input tokens (cache reads are a subset of this) */
  totalInputTokens: number;
  /** Fraction of input tokens served from cache (0–100%) */
  cacheHitRate: number;
  /** Fresh (non-cached) input tokens = totalInputTokens - totalCacheReadTokens */
  nonCachedInputTokens: number;
}

/** Distribution of sessions by health score tier */
export interface HealthDistribution {
  /** Sessions with health score ≥ 0.8 */
  healthyCount: number;
  /** Sessions with 0.5 ≤ health score < 0.8 */
  attentionCount: number;
  /** Sessions with health score < 0.5 */
  criticalCount: number;
}

// ===== Tool Analysis Types =====

/** Tool usage analysis data */
export interface ToolAnalysisData {
  /** Total tool calls across all sessions */
  totalCalls: number;
  /** Overall success rate (0-1) */
  successRate: number;
  /** Average duration in milliseconds */
  avgDurationMs: number;
  /** Most frequently used tool name */
  mostUsedTool: string;
  /** Per-tool breakdown */
  tools: Array<ToolUsageEntry>;
  /** Activity heatmap data (hour x day) */
  activityHeatmap: Array<{ day: number; hour: number; count: number }>;
}

/** Individual tool usage statistics */
export interface ToolUsageEntry {
  /** Tool name (e.g., "powershell", "edit", "view") */
  name: string;
  /** Total number of calls */
  callCount: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average duration in milliseconds */
  avgDurationMs: number;
  /** Total duration in milliseconds */
  totalDurationMs: number;
}

// ===== Code Impact Types =====

/** Code impact analysis data */
export interface CodeImpactData {
  /** Total files modified across sessions */
  filesModified: number;
  /** Total lines added */
  linesAdded: number;
  /** Total lines removed */
  linesRemoved: number;
  /** Net line change (added - removed) */
  netChange: number;
  /** Breakdown by file extension */
  fileTypeBreakdown: Array<{ extension: string; count: number; percentage: number }>;
  /** Most modified files */
  mostModifiedFiles: Array<{ path: string; additions: number; deletions: number }>;
  /** Changes over time (daily) */
  changesByDay: Array<{ date: string; additions: number; deletions: number }>;
}

// ===== Health Scoring Types =====
// Note: SessionHealth and HealthFlag already exist in this file.
// Adding the aggregate health scoring view type.

/** Aggregate health scoring data for the health dashboard */
export interface HealthScoringData {
  /** Overall average health score (0-1) */
  overallScore: number;
  /** Count of healthy sessions (score >= 0.8) */
  healthyCount: number;
  /** Count of sessions needing attention (0.5 <= score < 0.8) */
  attentionCount: number;
  /** Count of critical sessions (score < 0.5) */
  criticalCount: number;
  /** Sessions requiring attention with their health details */
  attentionSessions: Array<{
    sessionId: string;
    sessionName: string;
    score: number;
    flags: Array<{ name: string; severity: 'warning' | 'danger' }>;
  }>;
  /** All health flags with aggregate counts */
  healthFlags: Array<{
    name: string;
    count: number;
    severity: 'warning' | 'danger';
    description: string;
  }>;
}

// ===== Export Types =====

/** Export configuration */
export interface ExportConfig {
  /** Session IDs to export */
  sessionIds: string[];
  /** Export format */
  format: 'json' | 'csv' | 'markdown';
  /** Include conversation data */
  includeConversation: boolean;
  /** Include events data */
  includeEvents: boolean;
  /** Include metrics data */
  includeMetrics: boolean;
  /** Include todo items */
  includeTodos: boolean;
  /** Output destination path */
  destination: string;
}

/** Export result */
export interface ExportResult {
  /** Whether export succeeded */
  success: boolean;
  /** Output file path */
  filePath?: string;
  /** Error message if failed */
  error?: string;
  /** Number of sessions exported */
  sessionsExported: number;
}

// ===== Comparison Types =====

/** Result of comparing two sessions */
export interface ComparisonResult {
  /** Session A details */
  sessionA: {
    id: string;
    summary: string;
    model: string;
    duration: number;
    turns: number;
    tokens: number;
    cost: number;
    toolCalls: number;
    successRate: number;
    filesModified: number;
    linesChanged: number;
    healthScore: number;
  };
  /** Session B details */
  sessionB: {
    id: string;
    summary: string;
    model: string;
    duration: number;
    turns: number;
    tokens: number;
    cost: number;
    toolCalls: number;
    successRate: number;
    filesModified: number;
    linesChanged: number;
    healthScore: number;
  };
  /** Per-model usage breakdown for comparison */
  modelUsage: {
    sessionA: Array<{ model: string; tokens: number; requests: number }>;
    sessionB: Array<{ model: string; tokens: number; requests: number }>;
  };
}

// ===== Replay Types =====

/** Replay state for session replay view */
export interface ReplayState {
  /** Current step index (0-based) */
  currentStep: number;
  /** Total number of steps */
  totalSteps: number;
  /** Whether playback is active */
  isPlaying: boolean;
  /** Playback speed multiplier */
  speed: number;
  /** Current elapsed time in ms */
  elapsedMs: number;
  /** Total duration in ms */
  totalDurationMs: number;
}

/** Individual replay step — one step per ConversationTurn. */
export interface ReplayStep {
  /** Step index (0-based). */
  index: number;
  /** The source turn index from ConversationTurn. */
  turnIndex: number;
  /** Human-readable title for this step. */
  title: string;
  /** Primary step type (determined by content). */
  type: 'user' | 'assistant' | 'tool';
  /** ISO timestamp for this step. */
  timestamp: string;
  /** Duration of this step in ms. */
  durationMs: number;
  /** Total output tokens consumed during this step. */
  tokens: number;
  /** The model used during this step. */
  model?: string;

  // ── Rich content (from ConversationTurn) ──

  /** Raw user message text. */
  userMessage?: string;
  /** Assistant message texts (content only, for display). */
  assistantMessages?: AttributedMessage[];
  /** Reasoning/thinking texts. */
  reasoningTexts?: AttributedMessage[];
  /** Full tool call objects from the turn. */
  richToolCalls?: TurnToolCall[];
  /** Session-level events during this step. */
  sessionEvents?: TurnSessionEvent[];

  // ── Enrichments ──

  /** Files modified during this step (extracted from tool args). */
  filesModified?: string[];
  /** Todos changed during this step. */
  todosChanged?: Array<{ id: string; title: string; status: string }>;
  /** Whether the step contains subagent invocations. */
  hasSubagents?: boolean;
  /** Whether a model switch occurred before this step (from previous step's model). */
  modelSwitchFrom?: string;

  // ── Legacy compat (simplified tool calls for backward compatibility) ──

  /** Simplified tool call summaries (legacy shape). */
  toolCalls?: Array<{
    name: string;
    success: boolean;
    durationMs: number;
    command?: string;
    output?: string;
  }>;
}

// ===== Tool Rendering Types =====

/** Tool names that have dedicated rich renderers. */
export type RichRenderableToolName =
  | 'edit'
  | 'view'
  | 'create'
  | 'grep'
  | 'glob'
  | 'powershell'
  | 'read_powershell'
  | 'write_powershell'
  | 'sql'
  | 'task'
  | 'read_agent'
  | 'ask_user'
  | 'web_search'
  | 'web_fetch'
  | 'store_memory'
  | 'report_intent';

/** User preferences for tool rendering: global toggle + per-tool overrides. */
export interface ToolRenderingPreferences {
  /** Master switch: when false, all tool calls use the plain/minimal renderer. */
  enabled: boolean;
  /** Per-tool overrides. Missing keys inherit from `enabled`. */
  toolOverrides: Partial<Record<RichRenderableToolName, boolean>>;
}

/** Default tool rendering preferences — everything enabled. */
export const DEFAULT_TOOL_RENDERING_PREFS: ToolRenderingPreferences = {
  enabled: true,
  toolOverrides: {},
};

// ===== Configuration Types =====

/** Per-model wholesale pricing entry */
export interface ModelPriceEntry {
  model: string;
  inputPerM: number;
  cachedInputPerM: number;
  outputPerM: number;
  /** Premium request multiplier (e.g. 1x, 3x, 0.33x). 0 = free tier. */
  premiumRequests: number;
}

/** TracePilot application configuration — persisted in config.toml */
export interface TracePilotConfig {
  version: number;
  paths: {
    sessionStateDir: string;
    indexDbPath: string;
  };
  general: {
    autoIndexOnLaunch: boolean;
    cliCommand: string;
  };
  ui: {
    theme: string;
    hideEmptySessions: boolean;
    autoRefreshEnabled: boolean;
    autoRefreshIntervalSeconds: number;
    checkForUpdates: boolean;
    favouriteModels: string[];
    recentRepoPaths: string[];
    /** Max width for page content area in px. 0 = full width (no cap). Default: 1200. */
    contentMaxWidth: number;
    /** Global UI scale factor (0.8 – 1.3). Default: 1.0. */
    uiScale: number;
  };
  pricing: {
    costPerPremiumRequest: number;
    models: ModelPriceEntry[];
  };
  toolRendering: {
    enabled: boolean;
    toolOverrides: Record<string, boolean>;
  };
  features: {
    exportView: boolean;
    healthScoring: boolean;
    sessionReplay: boolean;
    renderMarkdown: boolean;
  };
  logging: {
    level: string;
  };
}

/** Result from validating a session directory */
export interface ValidateSessionDirResult {
  valid: boolean;
  sessionCount: number;
  error?: string;
}

// ===== Update & Git Types =====

/** Result from checking for a newer TracePilot release. */
export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string | null;
  publishedAt: string | null;
}

/** Git metadata for the running TracePilot instance. */
export interface GitInfo {
  commitHash: string;
  branch: string;
}

/** A single entry in the release manifest used by the What's New modal. */
export interface ReleaseManifestEntry {
  version: string;
  date: string;
  notes: {
    added: string[];
    changed: string[];
    fixed: string[];
  };
  requiresReindex?: boolean;
}

export { TRACEPILOT_KNOWN_EVENTS, type TracePilotKnownEvent } from './known-events.js';

/** Enriched indexing progress payload emitted per session during reindexing. */
export interface IndexingProgressPayload {
  current: number;
  total: number;
  /** Per-session info (null/undefined if skipped or failed). */
  sessionRepo: string | null;
  sessionBranch: string | null;
  sessionModel: string | null;
  sessionTokens: number;
  sessionEvents: number;
  sessionTurns: number;
  /** Running totals across all indexed sessions so far. */
  totalTokens: number;
  totalEvents: number;
  totalRepos: number;
}

// ===== Deep Search (FTS) Types =====

/** Content types that can be indexed for full-text search. */
export type SearchContentType =
  | 'user_message'
  | 'assistant_message'
  | 'reasoning'
  | 'tool_call'
  | 'tool_error'
  | 'error'
  | 'compaction_summary'
  | 'system_message'
  | 'subagent'
  | 'checkpoint';

/** A single search result from the FTS index. */
export interface SearchResult {
  id: number;
  sessionId: string;
  contentType: SearchContentType;
  turnNumber: number | null;
  eventIndex: number | null;
  timestampUnix: number | null;
  toolName: string | null;
  /** Highlighted snippet with <mark> tags */
  snippet: string;
  metadataJson: string | null;
  sessionSummary: string | null;
  sessionRepository: string | null;
  sessionBranch: string | null;
  sessionUpdatedAt: string | null;
}

/** Paginated search results response from the backend. */
export interface SearchResultsResponse {
  results: SearchResult[];
  totalCount: number;
  hasMore: boolean;
  query: string;
  latencyMs: number;
}

/** Filters for deep content search. */
export interface SearchFilters {
  contentTypes?: string[];
  repositories?: string[];
  toolNames?: string[];
  sessionId?: string;
  dateFromUnix?: number;
  dateToUnix?: number;
  limit?: number;
  offset?: number;
  sortBy?: 'relevance' | 'newest' | 'oldest';
}

/** Facet counts returned from search. Tuples are [name, count]. */
export interface SearchFacetsResponse {
  byContentType: [string, number][];
  byRepository: [string, number][];
  byToolName: [string, number][];
  totalMatches: number;
  sessionCount: number;
}

/** Statistics about the search index. */
export interface SearchStatsResponse {
  totalRows: number;
  indexedSessions: number;
  totalSessions: number;
  contentTypeCounts: [string, number][];
}

/** Progress payload for search indexing events. */
export interface SearchIndexingProgress {
  current: number;
  total: number;
}
