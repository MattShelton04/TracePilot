/**
 * Shared timeline / overlap-detection utilities used by the visualization views
 * (TurnWaterfallView, NestedSwimlanesView, AgentTreeView).
 */

import type { TurnToolCall } from '@tracepilot/types';

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

export function detectParallelIds(items: TimeSpanItem[]): Set<string> {
  if (items.length < 2) return new Set();

  // Filter out invalid spans up front and sort by start time for sweep-line detection.
  const spans = items
    .filter(
      (item) =>
        Number.isFinite(item.startMs) && Number.isFinite(item.endMs) && item.endMs > item.startMs,
    )
    .sort((a, b) => (a.startMs === b.startMs ? a.endMs - b.endMs : a.startMs - b.startMs));

  if (spans.length < 2) return new Set();

  const result = new Set<string>();
  const active: Array<{ id: string; endMs: number }> = [];

  // Maintain active spans sorted by endMs for quick eviction.
  const insertActive = (entry: { id: string; endMs: number }) => {
    let lo = 0;
    let hi = active.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (active[mid].endMs <= entry.endMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    active.splice(lo, 0, entry);
  };

  for (const span of spans) {
    // Drop spans that ended before this one starts.
    while (active.length > 0 && active[0].endMs <= span.startMs) {
      active.shift();
    }

    // Any remaining active span overlaps with the current one.
    if (active.length > 0) {
      result.add(span.id);
      for (const a of active) result.add(a.id);
    }

    insertActive({ id: span.id, endMs: span.endMs });
  }

  return result;
}
