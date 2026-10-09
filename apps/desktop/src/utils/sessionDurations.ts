import { formatDuration } from "@tracepilot/types";

/**
 * A session has several "durations", and each surface names the one it shows.
 * API time sums model calls, so parallel subagents can push it past the
 * session span.
 */
export const DURATION_HINTS = {
  apiTime:
    "Total time spent waiting on model calls. Parallel subagents can make it longer than the session span.",
  turnTime:
    "Sum of turn durations, from each prompt to its last response. Idle time between turns is not counted.",
  sessionSpan: "Wall-clock time from the session's start to its last update.",
} as const;

/** A summed duration for display: "—" when none was recorded, rather than "0ms". */
export function formatRecordedDuration(ms: number | null | undefined): string {
  return ms ? formatDuration(ms) || "—" : "—";
}
