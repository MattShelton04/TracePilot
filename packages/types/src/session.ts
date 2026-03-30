// ─── Session Types ────────────────────────────────────────────────
// Core session management types: list items, detail views, health
// assessment, shutdown metrics, and session artifacts (todos, plans,
// checkpoints).

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
  severity: "error" | "warning" | "info";
  summary: string;
  detailJson?: unknown;
}

/** Full session detail from load_session_summary */
export interface SessionDetail {
  id: string;
  summary?: string | null;
  repository?: string | null;
  branch?: string | null;
  cwd?: string | null;
  gitRoot?: string;
  hostType?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  eventCount?: number | null;
  turnCount?: number | null;
  hasPlan: boolean;
  hasCheckpoints: boolean;
  checkpointCount?: number | null;
  shutdownMetrics?: ShutdownMetrics | null;
}

/** Shutdown metrics from session.shutdown event */
export interface ShutdownMetrics {
  shutdownType?: string | null;
  shutdownCount?: number | null;
  totalPremiumRequests?: number | null;
  totalApiDurationMs?: number | null;
  sessionStartTime?: number | null;
  currentModel?: string | null;
  codeChanges?: CodeChanges | null;
  modelMetrics?: Record<string, ModelMetricDetail> | null;
  sessionSegments?: SessionSegment[] | null;
}

/** A single session segment's metrics snapshot (one per shutdown event). */
export interface SessionSegment {
  startTimestamp: string;
  endTimestamp: string;
  tokens: number;
  totalRequests: number;
  premiumRequests: number;
  apiDurationMs: number;
  currentModel?: string | null;
  modelMetrics?: Record<string, ModelMetricDetail> | null;
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

// ─── Session Artifacts ────────────────────────────────────────────

/** Valid todo status values as stored in session.db */
export type TodoStatus = "done" | "in_progress" | "blocked" | "pending";

/** Todo item from session.db */
export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
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
