// ─── Analytics Types ──────────────────────────────────────────────
// Aggregated analytics, tool usage analysis, and code impact metrics for dashboards.

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
  /** Token usage per day for trend charts */
  tokenUsageByDay: Array<{ date: string; tokens: number }>;
  /** Activity (session segment) count per day */
  activityPerDay: Array<{ date: string; count: number }>;
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
    reasoningTokens?: number | null;
  }>;
  /** Cost per day for trend charts */
  costByDay: Array<{ date: string; cost: number }>;
  /** API duration statistics (avg, median, p95 of total_api_duration_ms per session) */
  apiDurationStats: ApiDurationStats;
  /** Productivity heuristics */
  productivityMetrics: ProductivityMetrics;
  /** Prompt cache efficiency metrics */
  cacheStats: CacheStats;
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

// ─── Tool Analysis ────────────────────────────────────────────────

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

// ─── Code Impact ──────────────────────────────────────────────────

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
