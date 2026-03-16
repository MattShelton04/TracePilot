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

/** A conversation turn */
export interface ConversationTurn {
  turnIndex: number;
  turnId?: string;
  interactionId?: string;
  userMessage?: string;
  assistantMessages: string[];
  model?: string;
  timestamp?: string;
  endTimestamp?: string;
  toolCalls: TurnToolCall[];
  durationMs?: number;
  isComplete: boolean;
  /** Reasoning/thinking texts emitted during this turn (may have multiple). */
  reasoningTexts?: string[];
  /** Total output tokens consumed during this turn. */
  outputTokens?: number;
  /** The transformed/enriched user message content (includes system-injected context). */
  transformedUserMessage?: string;
  /** File attachments provided with the user message. */
  attachments?: unknown[];
}

/** A tool call within a turn */
export interface TurnToolCall {
  toolCallId?: string;
  parentToolCallId?: string;
  toolName: string;
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
}

/** Session health assessment */
export interface SessionHealth {
  score: number;
  flags: HealthFlag[];
}

export interface HealthFlag {
  severity: "info" | "warning" | "error";
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
  modelDistribution: Array<{ model: string; tokens: number; percentage: number; inputTokens: number; outputTokens: number; cacheReadTokens: number }>;
  /** Cost per day for trend charts */
  costByDay: Array<{ date: string; cost: number }>;
  /** Session duration statistics */
  sessionDurationStats: SessionDurationStats;
  /** Productivity heuristics */
  productivityMetrics: ProductivityMetrics;
}

/** Session duration statistics (avg, median, p95) */
export interface SessionDurationStats {
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

/** Individual replay step */
export interface ReplayStep {
  /** Step index */
  index: number;
  /** Step title/description */
  title: string;
  /** Step type */
  type: 'user' | 'assistant' | 'tool';
  /** Timestamp */
  timestamp: string;
  /** Duration of this step in ms */
  durationMs: number;
  /** Token count for this step */
  tokens: number;
  /** Associated tool calls */
  toolCalls?: Array<{
    name: string;
    success: boolean;
    durationMs: number;
    command?: string;
    output?: string;
  }>;
  /** Files modified in this step */
  filesModified?: string[];
  /** Todos changed in this step */
  todosChanged?: Array<{ id: string; title: string; status: string }>;
}

// ===== Tool Rendering Types =====

/** Tool names that have dedicated rich renderers. */
export type RichRenderableToolName =
  | "edit"
  | "view"
  | "create"
  | "grep"
  | "glob"
  | "powershell"
  | "read_powershell"
  | "write_powershell"
  | "sql"
  | "task"
  | "read_agent"
  | "ask_user"
  | "web_search"
  | "web_fetch"
  | "store_memory"
  | "report_intent";

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

/** TracePilot application configuration */
export interface TracePilotConfig {
  version: number;
  paths: {
    sessionStateDir: string;
    indexDbPath: string;
  };
  general: {
    autoIndexOnLaunch: boolean;
  };
}

/** Result from validating a session directory */
export interface ValidateSessionDirResult {
  valid: boolean;
  sessionCount: number;
  error?: string;
}

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
