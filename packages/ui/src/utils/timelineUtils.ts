/**
 * Shared timeline / overlap-detection utilities used by the visualization views
 * (TurnWaterfallView, NestedSwimlanesView, AgentTreeView).
 */

import type { TurnToolCall } from "@tracepilot/types";

/** Items with time spans for overlap detection. */
export interface TimeSpanItem {
  id: string;
  startMs: number;
  endMs: number;
}

/** Convert a TurnToolCall to a TimeSpanItem, returning null if timestamps are missing. */
export function toTimeSpan(tc: TurnToolCall): TimeSpanItem | null {
  if (!tc.startedAt) return null;
  const startMs = new Date(tc.startedAt).getTime();
  if (Number.isNaN(startMs)) return null;
  const endMs = tc.completedAt
    ? new Date(tc.completedAt).getTime()
    : startMs + (tc.durationMs ?? 0);
  if (Number.isNaN(endMs)) return null;
  return { id: tc.toolCallId ?? tc.toolName, startMs, endMs };
}

/** Check if two time spans overlap. */
export function timeSpansOverlap(a: TimeSpanItem, b: TimeSpanItem): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/** Detect which items run in parallel (overlapping time spans). Returns Set of ids. */
export function detectParallelIds(items: TimeSpanItem[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (timeSpansOverlap(items[i], items[j])) {
        result.add(items[i].id);
        result.add(items[j].id);
      }
    }
  }
  return result;
}
