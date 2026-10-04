// ─── Reasoning Effort Usage ───────────────────────────────────────
// User turns per model and reasoning effort. A user turn is every agent turn
// that serves one typed user message. Mirrors
// `tracepilot_core::effort_usage`.

/** User turns that ran on one model at one reasoning effort. */
export interface EffortUsageEntry {
  model?: string;
  /** Absent when the model's default effort applied. */
  reasoningEffort?: string;
  /** Sessions contributing (cross-session aggregates only; 0 per session). */
  sessions: number;
  userTurns: number;
  /** Main-agent agent turns; each is one model request. */
  agentTurns: number;
  /** Main-agent tool calls. */
  toolCalls: number;
  /** Summed wall time across user turns. */
  wallMs: number;
  /** User turns with requests recorded by Copilot CLI's session store. The
   *  fields below cover only these. */
  observedUserTurns: number;
  /** Main-agent requests recorded by the session store. */
  requests: number;
  reasoningTokens: number;
  outputTokens: number;
  apiDurationMs: number;
  nanoAiu: number;
  subagentRequests: number;
  subagentNanoAiu: number;
}

/** A session's user turns grouped by model and effort. */
export interface SessionEffortUsage {
  /** Most user turns first. */
  entries: EffortUsageEntry[];
  /** Whether Copilot CLI's session store recorded any of this session's requests. */
  hasRequestData: boolean;
}

/** Response from get_session_effort_usage. */
export interface EffortUsageResponse {
  usage: SessionEffortUsage;
  eventsFileSize: number;
  eventsFileMtime?: number | null;
}
