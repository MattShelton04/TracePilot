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

/**
 * Detects tool calls that overlap in time (parallel execution).
 *
 * Uses a sweep-line algorithm: spans are sorted by start time, then scanned
 * left-to-right. An `active` window tracks spans whose end time hasn't been
 * reached yet. Any span that still overlaps a previously-started span is
 * flagged as parallel.
 *
 * Invalid spans (NaN, non-positive duration) are filtered out before processing.
 *
 * @returns Set of IDs that participate in at least one overlap.
 */
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
  let front = 0; // index pointer — avoids O(n) shift()

  // Maintain active spans sorted by endMs for quick eviction.
  const insertActive = (entry: { id: string; endMs: number }) => {
    let lo = front;
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
    // Advance front pointer past spans that ended before this one starts.
    while (front < active.length && active[front].endMs <= span.startMs) {
      front++;
    }

    // Any remaining active span overlaps with the current one.
    if (front < active.length) {
      result.add(span.id);
      for (let i = front; i < active.length; i++) result.add(active[i].id);
    }

    insertActive({ id: span.id, endMs: span.endMs });
  }

  return result;
}
