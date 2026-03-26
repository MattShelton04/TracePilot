// ─── Replay Types ─────────────────────────────────────────────────
// Types for the session replay view: playback state and per-step
// data derived from ConversationTurn.

import type { AttributedMessage, TurnSessionEvent, TurnToolCall } from './conversation.js';

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

/** Individual replay step — one step per ConversationTurn. */
export interface ReplayStep {
  /** Step index (0-based). */
  index: number;
  /** The source turn index from ConversationTurn. */
  turnIndex: number;
  /** Human-readable title for this step. */
  title: string;
  /** Primary step type (determined by content). */
  type: 'user' | 'assistant' | 'tool';
  /** ISO timestamp for this step. */
  timestamp: string;
  /** Duration of this step in ms. */
  durationMs: number;
  /** Total output tokens consumed during this step. */
  tokens: number;
  /** The model used during this step. */
  model?: string;

  // ── Rich content (from ConversationTurn) ──

  /** Raw user message text. */
  userMessage?: string;
  /** Assistant message texts (content only, for display). */
  assistantMessages?: AttributedMessage[];
  /** Reasoning/thinking texts. */
  reasoningTexts?: AttributedMessage[];
  /** Full tool call objects from the turn. */
  richToolCalls?: TurnToolCall[];
  /** Session-level events during this step. */
  sessionEvents?: TurnSessionEvent[];

  // ── Enrichments ──

  /** Files modified during this step (extracted from tool args). */
  filesModified?: string[];
  /** Todos changed during this step. */
  todosChanged?: Array<{ id: string; title: string; status: string }>;
  /** Whether the step contains subagent invocations. */
  hasSubagents?: boolean;
  /** Whether a model switch occurred before this step (from previous step's model). */
  modelSwitchFrom?: string;

  // ── Legacy compat (simplified tool calls for backward compatibility) ──

  /** Simplified tool call summaries (legacy shape). */
  toolCalls?: Array<{
    name: string;
    success: boolean;
    durationMs: number;
    command?: string;
    output?: string;
  }>;
}
