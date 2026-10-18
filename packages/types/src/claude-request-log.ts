import type { NormalizedSection, NormalizedToolDefinition } from "./context-capture.js";

/**
 * What Claude Code 2.1.301+ recorded of a session's API requests
 * (`get_session_request_log`): each distinct system prompt and tool list,
 * and each call's parameters. Not a capture of the wire request.
 */
export interface RequestLog {
  /**
   * Distinct system prompt and tool sets, by first use: the most recently
   * used, at most 24 and about 2 MB of prompt and tool text.
   */
  shapes: RecordedShape[];
  omittedShapes: number;
  /** The hashes of sets left out, so their calls aren't taken for unrecorded. */
  omittedShapeHashes: string[];
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
  /** Subagent files that couldn't be read; the rest are listed. */
  unreadableFiles: number;
}

export interface RecordedShape {
  hash: string;
  firstUsed: string | null;
  calls: number;
  agents: RecordedAgent[];
  system: NormalizedSection[];
  /**
   * Each tool's `raw` holds only its fields other than `name`, `description`
   * and `input_schema`; `recordedToolDefinitions` rebuilds the definition.
   */
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
