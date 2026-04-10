// ─── Conversation Types ───────────────────────────────────────────
// Types for conversation turns, tool calls, session events, and
// paginated response wrappers for the events stream.

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
export type SessionEventSeverity = "error" | "warning" | "info";

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
  eventsFileMtime?: number | null;
}

/** Lightweight freshness probe response. */
export interface FreshnessResponse {
  eventsFileSize: number;
  eventsFileMtime?: number | null;
}

/** Paginated events response */
export interface EventsResponse {
  events: SessionEvent[];
  totalCount: number;
  hasMore: boolean;
  allEventTypes: string[];
}

/** Raw event from events.jsonl */
export interface SessionEvent {
  eventType: string;
  timestamp?: string;
  id?: string;
  parentId?: string;
  data: Record<string, unknown>;
}
