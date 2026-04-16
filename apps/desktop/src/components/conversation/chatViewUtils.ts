/**
 * Utility functions for the Chat View rendering pipeline.
 *
 * Segments a turn's tool calls into renderable groups (regular tools,
 * subagent groups, pills) and provides helpers for extracting main-agent
 * content from a turn.
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

/** Extract main-agent reasoning (not from subagents). */
export function getMainReasoning(turn: ConversationTurn): string[] {
  return (turn.reasoningTexts ?? [])
    .filter((r) => !r.parentToolCallId && r.content?.trim())
    .map((r) => r.content);
}

/** Extract main-agent messages (not from subagents). */
export function getMainMessages(turn: ConversationTurn): AttributedMessage[] {
  return turn.assistantMessages.filter((m) => !m.parentToolCallId && m.content?.trim());
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
        names.add(item.toolCall.toolName);
      }
    }
  }
  return Array.from(names).slice(0, 6);
}
