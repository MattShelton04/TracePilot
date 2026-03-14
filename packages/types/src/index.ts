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
