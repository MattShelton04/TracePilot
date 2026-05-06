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
  /** Index of the originating event in the session event stream.
   *  Used for chronologically interleaving messages/reasoning with tool calls. */
  eventIndex?: number;
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
  /** System message content(s) injected before this turn (from system.message events).
   *  In auto-model-selection sessions (CLI v1.0.32+), one entry appears per turn.
   *  May also appear after context compaction in other session modes. */
  systemMessages?: string[];
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
  /** For compaction_complete events, the associated checkpoint number. */
  checkpointNumber?: number;
  /** For `permission.*` events, the upstream request id used to pair
   *  `permission.requested` with its matching `permission.completed`. */
  requestId?: string;
  /** For `permission.completed` (and `external_tool.requested`), the
   *  related `toolCallId` so the UI can correlate permissions with tool calls. */
  toolCallId?: string;
  /** For `permission.requested`, the prompt kind (e.g. "shell", "write"). */
  promptKind?: string;
  /** For `permission.completed`, the result kind (e.g. "approved",
   *  "approved-for-session", "denied-interactively-by-user"). */
  resultKind?: string;
  /** For `permission.requested`, true if a hook auto-resolved the prompt. */
  resolvedByHook?: boolean;
  /** Skill-specific payload, present only for `skill.invoked` events. */
  skillInvocation?: SkillInvocationEvent;
}

export interface SkillInvocationEvent {
  /** Raw event id used to correlate the synthetic skill-context user message. */
  id?: string;
  name?: string;
  /** Full path to the invoked skill's `SKILL.md`, when provided by Copilot. */
  path?: string;
  description?: string;
  /** Character count of the skill content embedded in the invocation event. */
  contentLength?: number;
  /** SKILL.md body (possibly truncated) for the conversation drop-down.
   *  Compare `content.length` to `contentLength` to detect truncation. */
  content?: string;
  /** Character count of the folded synthetic skill-context user message. */
  contextLength?: number;
  /** Whether a verified synthetic skill-context user message was folded. */
  contextFolded: boolean;
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
  /** The model originally requested in the tool call arguments. May differ from `model` when a
   * premium model was requested but a cheaper model was substituted due to rate-limit attribution. */
  requestedModel?: string;
  /** Total tokens consumed during subagent execution (from SubagentCompleted/Failed). */
  totalTokens?: number;
  /** Total tool calls made during subagent execution (from SubagentCompleted/Failed). */
  totalToolCalls?: number;
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

/**
 * Lightweight freshness probe response.
 *
 * Mirrored by src/generated/bindings.ts as of wave 21 — keep in sync or
 * delete this interface once the full cutover lands.
 */
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
