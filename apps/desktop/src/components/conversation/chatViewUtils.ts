/**
 * Utility functions for the Chat View rendering pipeline.
 *
 * Segments a turn's tool calls into renderable groups (regular tools,
 * subagent groups, pills), extracts main-agent content from a turn, and
 * orders that content as the agent produced it.
 */
import type { AttributedMessage, ConversationTurn, TurnToolCall } from "@tracepilot/types";

// ─── Segment Types ────────────────────────────────────────────────

export type ToolSegment =
  | { type: "tool-group"; items: ToolGroupItem[] }
  | { type: "subagent-group"; subagents: TurnToolCall[] };

export type ToolGroupItem =
  | { type: "intent"; toolCall: TurnToolCall }
  | { type: "ask-user"; toolCall: TurnToolCall }
  | { type: "read-agent"; toolCall: TurnToolCall }
  | { type: "tool"; toolCall: TurnToolCall };

/** Maximum tool rows shown before progressive disclosure collapse. */
export const MAX_VISIBLE_TOOLS = 7;

/** Threshold below which we show all tools without collapsing. */
export const COLLAPSE_THRESHOLD = 3;

// ─── Segmentation ─────────────────────────────────────────────────

/**
 * Segments a turn's tool calls into renderable groups.
 *
 * - Regular tools are grouped together
 * - Consecutive subagent launches are grouped
 * - Child tools (parentToolCallId set) are skipped (belong to panel)
 * - top-level read_agent calls are shown as rows and can also drive completion pills
 */
export function segmentToolCalls(toolCalls: TurnToolCall[]): ToolSegment[] {
  const segments: ToolSegment[] = [];
  let currentRegular: TurnToolCall[] = [];
  let currentSubagents: TurnToolCall[] = [];

  function flushRegular() {
    if (currentRegular.length > 0) {
      segments.push({
        type: "tool-group",
        items: currentRegular.map(classifyTool),
      });
      currentRegular = [];
    }
  }

  function flushSubagents() {
    if (currentSubagents.length > 0) {
      segments.push({
        type: "subagent-group",
        subagents: [...currentSubagents],
      });
      currentSubagents = [];
    }
  }

  for (const tc of toolCalls) {
    if (tc.isSubagent) {
      flushRegular();
      currentSubagents.push(tc);
    } else if (tc.parentToolCallId) {
      // Skip — child data belongs to subagent panel
    } else {
      flushSubagents();
      currentRegular.push(tc);
    }
  }

  flushRegular();
  flushSubagents();

  return segments;
}

function classifyTool(tc: TurnToolCall): ToolGroupItem {
  switch (tc.toolName) {
    case "report_intent":
      return { type: "intent", toolCall: tc };
    case "store_memory":
      // Render as a regular tool row so the rich StoreMemoryRenderer
      // is used when expanded (instead of a tiny non-expandable pill).
      return { type: "tool", toolCall: tc };
    case "ask_user":
      return { type: "ask-user", toolCall: tc };
    case "read_agent":
      return { type: "read-agent", toolCall: tc };
    default:
      return { type: "tool", toolCall: tc };
  }
}

// ─── Turn Content Helpers ─────────────────────────────────────────

function mainReasoningTexts(turn: ConversationTurn): AttributedMessage[] {
  return (turn.reasoningTexts ?? []).filter((r) => !r.parentToolCallId && r.content?.trim());
}

/** Extract main-agent reasoning (not from subagents). */
export function getMainReasoning(turn: ConversationTurn): string[] {
  return mainReasoningTexts(turn).map((r) => r.content);
}

/** Extract main-agent messages (not from subagents). */
export function getMainMessages(turn: ConversationTurn): AttributedMessage[] {
  return turn.assistantMessages.filter((m) => !m.parentToolCallId && m.content?.trim());
}

/** One block of output from a slash command that ran without the model. */
export interface CommandOutput {
  content: string;
  eventIndex: number;
}

/**
 * The output of the slash command a turn ran without the model (Claude Code
 * `/model`, `/cost`). It follows the prompt. Empty when the turn's system
 * messages are system prompts, which precede it.
 */
export function getCommandOutput(turn: ConversationTurn): CommandOutput[] {
  const indices = turn.commandOutputEventIndices ?? [];
  const messages = turn.systemMessages ?? [];
  if (indices.length === 0 || indices.length !== messages.length) return [];
  return messages.map((content, i) => ({ content, eventIndex: indices[i] }));
}

/** System prompts shown before a turn's prompt: none when they are command output. */
export function getLeadingSystemMessages(turn: ConversationTurn): string[] {
  return getCommandOutput(turn).length > 0 ? [] : (turn.systemMessages ?? []);
}

// ─── Turn content order ───────────────────────────────────────────

/** One item of a turn's main-agent content, by index into its own list. */
export type TurnContentRef =
  | { kind: "reasoning"; index: number }
  | { kind: "message"; index: number }
  | { kind: "segment"; index: number };

export interface OrderedTurnContent {
  reasoning: string[];
  messages: AttributedMessage[];
  segments: ToolSegment[];
  /** Every reasoning block, message and segment, in the order to render them. */
  order: TurnContentRef[];
}

/** Tool calls the chat renders in the turn itself (children live in the subagent panel). */
function isShownInTurn(tc: TurnToolCall): boolean {
  return !!tc.isSubagent || !tc.parentToolCallId;
}

/**
 * Builds a turn's main-agent content in the order the agent produced it:
 * reasoning and replies sit between the tool calls they came before and
 * after, using each item's event index. A tool group is split where text
 * falls inside it. Reasoning from the same event as a reply comes first.
 *
 * If any of those items lacks an event index (the synthetic live tail, older
 * data), the order cannot be known, so the previous layout is kept: all
 * reasoning, then all replies, then the tool segments.
 */
export function orderTurnContent(turn: ConversationTurn): OrderedTurnContent {
  const reasoningTexts = mainReasoningTexts(turn);
  const reasoning = reasoningTexts.map((r) => r.content);
  const messages = getMainMessages(turn);
  const text = [
    ...reasoningTexts.map((r, index) => ({
      ref: { kind: "reasoning", index } as TurnContentRef,
      eventIndex: r.eventIndex,
      rank: 0,
    })),
    ...messages.map((m, index) => ({
      ref: { kind: "message", index } as TurnContentRef,
      eventIndex: m.eventIndex,
      rank: 1,
    })),
  ];
  const shown = turn.toolCalls.filter(isShownInTurn);
  const ordered =
    text.length > 0 &&
    shown.length > 0 &&
    text.every((t) => t.eventIndex != null) &&
    shown.every((tc) => tc.eventIndex != null);

  if (!ordered) {
    const segments = segmentToolCalls(turn.toolCalls);
    return {
      reasoning,
      messages,
      segments,
      order: [
        ...text.map((t) => t.ref),
        ...segments.map((_, index) => ({ kind: "segment" as const, index })),
      ],
    };
  }

  text.sort((a, b) => (a.eventIndex ?? 0) - (b.eventIndex ?? 0) || a.rank - b.rank);
  const segments: ToolSegment[] = [];
  const order: TurnContentRef[] = [];
  let run: TurnToolCall[] = [];
  let next = 0;

  function flushRun() {
    for (const segment of segmentToolCalls(run)) {
      order.push({ kind: "segment", index: segments.length });
      segments.push(segment);
    }
    run = [];
  }

  for (const tc of turn.toolCalls) {
    const at = tc.eventIndex ?? 0;
    if (isShownInTurn(tc) && next < text.length && (text[next].eventIndex ?? 0) < at) {
      flushRun();
      while (next < text.length && (text[next].eventIndex ?? 0) < at) order.push(text[next++].ref);
    }
    run.push(tc);
  }
  flushRun();
  while (next < text.length) order.push(text[next++].ref);

  return { reasoning, messages, segments, order };
}

/**
 * Count the number of regular (non-pill) tools in a ToolGroupItem array.
 */
export function countRegularTools(items: ToolGroupItem[]): number {
  return items.filter((i) => i.type === "tool").length;
}

/**
 * Get unique tool names from items beyond the visible threshold.
 */
export function getCollapsedToolNames(items: ToolGroupItem[], maxVisible: number): string[] {
  const names = new Set<string>();
  let toolIdx = 0;
  for (const item of items) {
    if (item.type === "tool") {
      toolIdx++;
      if (toolIdx > maxVisible) {
        names.add(item.toolCall.nativeToolName ?? item.toolCall.toolName);
      }
    }
  }
  return Array.from(names).slice(0, 6);
}

// ─── Render chunks ────────────────────────────────────────────────

/**
 * Turns per `content-visibility: auto` render chunk. The browser checks every
 * such container on every frame, so one container per turn (thousands in long
 * sessions) costs ~10 ms/frame while scrolling. Chunks keep that negligible
 * and stay small enough to lay out quickly when they scroll into view.
 */
export const TURNS_PER_RENDER_CHUNK = 10;

export interface TurnChunk<T> {
  /** Stable key: the first turn's index. */
  key: number;
  /** Position of the chunk's first turn in the full list. */
  start: number;
  turns: T[];
}

export function chunkTurns<T extends { turnIndex: number }>(
  turns: readonly T[],
  size = TURNS_PER_RENDER_CHUNK,
): TurnChunk<T>[] {
  const chunks: TurnChunk<T>[] = [];
  for (let start = 0; start < turns.length; start += size) {
    const slice = turns.slice(start, start + size);
    chunks.push({ key: slice[0].turnIndex, start, turns: slice });
  }
  return chunks;
}

// ─── Session events around a turn ─────────────────────────────────

export interface TurnStartSplit<T> {
  /** Items logged at or before the turn started (e.g. `session.start`). */
  before: T[];
  /** Items logged after the turn started, while its work ran. */
  after: T[];
}

function parseTime(value: string | undefined): number {
  return value ? Date.parse(value) : Number.NaN;
}

/**
 * Splits a turn's session events (or entries built from them) into those
 * logged at or before the turn started and those logged during it, so views
 * can render the first group above the turn's content and the rest below it.
 *
 * An item without a usable timestamp, or any item when the turn has none,
 * goes to `untimed`: each view keeps its previous placement for those.
 */
export function splitAtTurnStart<T>(
  items: readonly T[],
  turnStart: string | undefined,
  timeOf: (item: T) => string | undefined,
  untimed: keyof TurnStartSplit<T>,
): TurnStartSplit<T> {
  const split: TurnStartSplit<T> = { before: [], after: [] };
  const start = parseTime(turnStart);
  for (const item of items) {
    const at = parseTime(timeOf(item));
    if (Number.isNaN(start) || Number.isNaN(at)) split[untimed].push(item);
    else split[at <= start ? "before" : "after"].push(item);
  }
  return split;
}
