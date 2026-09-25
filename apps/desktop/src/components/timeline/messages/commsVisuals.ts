// Shared vocabulary for the communication views: labels, legend order and
// the text shown for an exchange. Colours live in CSS (`.edge--<kind>` sets
// `--edge`), so the SVG views and the message log stay in step with the theme.

import type { CommsEdgeKind, CommsTimeline, CommsTimelineEvent } from "@tracepilot/ui";
import { formatTimelineOffset } from "@tracepilot/ui";

export const EDGE_KINDS: readonly CommsEdgeKind[] = ["launch", "down", "up", "peer", "read"];

export const EDGE_LABELS: Record<CommsEdgeKind, string> = {
  launch: "Launch prompt",
  down: "To worker",
  up: "To parent",
  peer: "Peer",
  read: "Read back",
};

export function edgeLabel(ev: CommsTimelineEvent): string {
  if (ev.poll) return "Poll";
  if (ev.comm.failed) return `${EDGE_LABELS[ev.edge]} (failed)`;
  return EDGE_LABELS[ev.edge];
}

/** Dashed strokes mark reads (pulled back, not sent); dotted marks polls. */
export function edgeDash(ev: CommsTimelineEvent): string | undefined {
  if (ev.poll) return "2 4";
  if (ev.edge === "read") return "5 4";
  return undefined;
}

export function agentName(timeline: CommsTimeline, key: string): string {
  return timeline.agents.find((a) => a.key === key)?.name ?? key;
}

/** Recipients as a reader would say them: "all children (a, b)" or "a, b". */
export function recipientsLabel(timeline: CommsTimeline, ev: CommsTimelineEvent): string {
  const names = ev.toKeys.map((k) => agentName(timeline, k)).join(", ");
  return ev.comm.scope ? `all ${ev.comm.scope}${names ? ` (${names})` : ""}` : names;
}

/** One-line summary for hover titles and screen readers. */
export function eventSummary(timeline: CommsTimeline, ev: CommsTimelineEvent): string {
  const when = formatTimelineOffset(ev.atMs, timeline.durationMs);
  const waits = ev.deliveries
    .filter((d) => d.waitMs >= 500)
    .map(
      (d) =>
        `${agentName(timeline, d.toKey)} received it after ${formatTimelineOffset(d.waitMs, timeline.durationMs)}${d.queued ? " (queued)" : ""}`,
    );
  const text = ev.comm.content.replace(/\s+/g, " ").trim();
  return [
    `${agentName(timeline, ev.fromKey)} → ${recipientsLabel(timeline, ev)}`,
    `${edgeLabel(ev)} at ${when}`,
    ...waits,
    text.length > 240 ? `${text.slice(0, 240)}…` : text,
  ]
    .filter(Boolean)
    .join("\n");
}

export function clipText(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (max <= 1) return "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const TICK_STEPS_MS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
  1_800_000, 3_600_000, 7_200_000,
];

/** Axis ticks at a round interval, at most `maxTicks` of them across the session. */
export function timeTicks(durationMs: number, maxTicks = 8): number[] {
  if (durationMs <= 0) return [0];
  const step =
    TICK_STEPS_MS.find((s) => durationMs / s <= maxTicks) ??
    Math.ceil(durationMs / maxTicks / 3_600_000) * 3_600_000;
  const ticks: number[] = [];
  for (let t = 0; t <= durationMs; t += step) ticks.push(t);
  return ticks;
}

/** A collapsed idle gap, as a reader would say it: "45m", "5h 12m", "2d 4h". */
export function formatGap(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Above this many agents, views pack agents that never overlap into shared lanes. */
export const PACK_THRESHOLD = 12;
