import type { NormalizedSection, NormalizedToolDefinition } from "./context-capture.js";

/**
 * What Claude Code 2.1.301+ recorded of a session's API requests
 * (`get_session_request_log`): each distinct system prompt and tool list,
 * and each call's parameters. Not a capture of the wire request.
 */
export interface RequestLog {
  /** Distinct system prompt and tool sets, by first use (at most 24). */
  shapes: RecordedShape[];
  omittedShapes: number;
  /** The latest calls, oldest first (at most 2,000). */
  calls: RecordedCall[];
  totalCalls: number;
  /** Calls whose shape record was not found. */
  callsWithoutShape: number;
  /** Calls per model, most used first. */
  models: RecordedCount[];
  /** Calls per agent, the main agent first. */
  agents: RecordedAgent[];
  /** Request records of every type read; 0 before Claude Code 2.1.301. */
  records: number;
  unreadableRecords: number;
  files: number;
}

export interface RecordedShape {
  hash: string;
  firstUsed: string | null;
  calls: number;
  agents: RecordedAgent[];
  system: NormalizedSection[];
  tools: NormalizedToolDefinition[];
  systemBytes: number;
  toolBytes: number;
}

/** The main agent (`agentId: null`) or one subagent. */
export interface RecordedAgent {
  agentId: string | null;
  agentType: string | null;
  calls: number;
}

export interface RecordedCount {
  name: string;
  calls: number;
}

export interface RecordedCall {
  timestamp: string | null;
  model: string | null;
  querySource: string | null;
  agentId: string | null;
  agentType: string | null;
  shapeHash: string | null;
  maxTokens: number | null;
  thinking: string | null;
  effort: string | null;
  betas: string[];
  contextEdits: string[];
  cacheBreakpoints: number;
  extendsPrevious: boolean;
}
