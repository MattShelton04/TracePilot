// TracePilot shared types — mirrors Rust models for the TypeScript boundary.

/** A session list item as returned from the backend. */
export interface SessionListItem {
  id: string;
  summary?: string;
  repository?: string;
  branch?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Shutdown metrics from a session.shutdown event. */
export interface ShutdownMetrics {
  totalPremiumRequests?: number;
  totalApiDurationMs?: number;
  linesAdded?: number;
  linesRemoved?: number;
  filesModified: string[];
  modelMetrics: ModelMetric[];
}

/** Per-model usage metrics. */
export interface ModelMetric {
  model: string;
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
}

/** A conversation turn — one user message + assistant response. */
export interface ConversationTurn {
  turnIndex: number;
  userMessage?: string;
  assistantMessage?: string;
  model?: string;
  timestamp?: string;
  toolCalls: TurnToolCall[];
  durationMs?: number;
}

/** A tool call within a turn. */
export interface TurnToolCall {
  toolName: string;
  status?: string;
  durationMs?: number;
  timestamp?: string;
}

/** Session health assessment. */
export interface SessionHealth {
  score: number;
  flags: HealthFlag[];
}

export interface HealthFlag {
  severity: "info" | "warning" | "error";
  category: string;
  message: string;
}

/** Raw event from events.jsonl. */
export interface SessionEvent {
  type: string;
  data: Record<string, unknown>;
  id?: string;
  timestamp?: string;
  parentId?: string;
}
