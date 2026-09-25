// Communication timeline: the session's agents and exchanges placed on one
// clock, for views that draw messaging over time (sequence diagram, lanes,
// graph playback, message log). Pure data; views decide the layout.

import type { ConversationTurn } from "@tracepilot/types";
import type { AgentStatus, AgentType } from "../agentTypes";
import type { AgentCommunication } from "./communications";
import { type AgentDirectory, MAIN_AGENT_KEY } from "./directory";

/** How an exchange is drawn: its kind for launches and reads, otherwise its relation. */
export type CommsEdgeKind = "launch" | "down" | "up" | "peer" | "read";

export interface CommsTimelineAgent {
  key: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  isMain: boolean;
  depth: number;
  parentKey?: string;
  /** Milliseconds from the timeline origin. */
  startMs: number;
  endMs: number;
  /** Start times of the agent's own tool calls: when it was working. */
  activityMs: number[];
}

export interface CommsTimelineDelivery {
  toKey: string;
  atMs: number;
  /** Time between the send and the recipient receiving it. */
  waitMs: number;
  /** The recipient was busy, so the message waited in its queue. */
  queued: boolean;
}

export interface CommsTimelineEvent {
  id: string;
  comm: AgentCommunication;
  edge: CommsEdgeKind;
  fromKey: string;
  toKeys: string[];
  atMs: number;
  /** One per recipient, in `toKeys` order. */
  deliveries: CommsTimelineDelivery[];
  /** A read that came back while the worker was still running. */
  poll: boolean;
}

export interface CommsTimeline {
  /** Epoch milliseconds of the session's first timestamp. */
  originMs: number;
  durationMs: number;
  /** Main agent first, then each agent followed by the agents it launched. */
  agents: CommsTimelineAgent[];
  /** Ordered by time, then by position in the event stream. */
  events: CommsTimelineEvent[];
}

function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function edgeKind(comm: AgentCommunication): CommsEdgeKind {
  if (comm.kind === "launch") return "launch";
  if (comm.kind === "read") return "read";
  return comm.relation;
}

export function buildCommsTimeline(
  turns: readonly ConversationTurn[],
  directory: AgentDirectory,
  communications: readonly AgentCommunication[],
): CommsTimeline {
  // Activity per agent, keyed by the agent that made each tool call.
  const activity = new Map<string, number[]>();
  const times: number[] = [];
  const note = (ms: number | undefined) => {
    if (ms !== undefined) times.push(ms);
    return ms;
  };
  for (const turn of turns) {
    note(parseTime(turn.timestamp));
    note(parseTime(turn.endTimestamp));
    for (const tc of turn.toolCalls) {
      const start = note(parseTime(tc.startedAt));
      note(parseTime(tc.completedAt));
      if (start === undefined) continue;
      const owner =
        (tc.parentToolCallId && directory.get(tc.parentToolCallId)?.key) || MAIN_AGENT_KEY;
      const list = activity.get(owner) ?? [];
      list.push(start);
      activity.set(owner, list);
    }
  }
  for (const comm of communications) {
    note(parseTime(comm.at));
    for (const d of comm.deliveries) note(parseTime(d.deliveredAt));
  }

  const originMs = times.length ? Math.min(...times) : 0;
  const lastMs = times.length ? Math.max(...times) : 0;
  const durationMs = Math.max(0, lastMs - originMs);
  const rel = (ms: number) => ms - originMs;

  // Events, carrying the previous time forward when one was not recorded.
  const events: CommsTimelineEvent[] = [];
  let carried = 0;
  for (const comm of communications) {
    const sentAt = parseTime(comm.at) ?? parseTime(comm.deliveries[0]?.deliveredAt);
    const atMs = sentAt !== undefined ? rel(sentAt) : carried;
    carried = atMs;
    const deliveries = comm.toKeys.map((toKey): CommsTimelineDelivery => {
      const d = comm.deliveries.find((x) => x.toKey === toKey);
      const deliveredAt = parseTime(d?.deliveredAt);
      const at = deliveredAt !== undefined ? Math.max(atMs, rel(deliveredAt)) : atMs;
      return { toKey, atMs: at, waitMs: at - atMs, queued: d?.delivery === "queued" };
    });
    events.push({
      id: comm.id,
      comm,
      edge: edgeKind(comm),
      fromKey: comm.fromKey,
      toKeys: comm.toKeys,
      atMs,
      deliveries,
      poll: comm.kind === "read" && !comm.returned && !comm.failed,
    });
  }
  events.sort((a, b) => a.atMs - b.atMs || a.comm.order - b.comm.order);

  // Agents in tree order.
  const children = new Map<string, string[]>();
  for (const entry of directory.entries) {
    if (!entry.parentKey) continue;
    const list = children.get(entry.parentKey) ?? [];
    list.push(entry.key);
    children.set(entry.parentKey, list);
  }
  const ordered: string[] = [];
  const visit = (key: string) => {
    if (ordered.includes(key)) return;
    ordered.push(key);
    for (const child of children.get(key) ?? []) visit(child);
  };
  visit(directory.main.key);
  for (const entry of directory.entries) visit(entry.key);

  // When each agent sent or received something, to bound unrecorded lifespans.
  const eventTimes = new Map<string, number[]>();
  const seenAt = (key: string, ms: number) => {
    const list = eventTimes.get(key) ?? [];
    list.push(ms);
    eventTimes.set(key, list);
  };
  for (const ev of events) {
    seenAt(ev.fromKey, ev.atMs);
    for (const d of ev.deliveries) seenAt(d.toKey, d.atMs);
  }

  const agents = ordered.flatMap((key): CommsTimelineAgent[] => {
    const entry = directory.get(key);
    if (!entry) return [];
    const activityMs = (activity.get(key) ?? []).map(rel).sort((a, b) => a - b);
    const seen = [...activityMs, ...(eventTimes.get(key) ?? [])];
    const started = parseTime(entry.startedAt);
    const completed = parseTime(entry.completedAt);
    const startMs = entry.isMain
      ? 0
      : started !== undefined
        ? rel(started)
        : seen.length
          ? Math.min(...seen)
          : 0;
    const endMs = entry.isMain
      ? durationMs
      : // Without a recorded completion (an interrupted agent), end at its
        // last recorded activity rather than stretching to the session end.
        Math.max(
          startMs,
          completed !== undefined ? rel(completed) : startMs,
          ...seen.filter((ms) => ms >= startMs),
        );
    return [
      {
        key,
        name: entry.name,
        type: entry.type,
        status: entry.status,
        isMain: entry.isMain,
        depth: entry.depth,
        parentKey: entry.parentKey,
        startMs,
        endMs,
        activityMs,
      },
    ];
  });

  return { originMs, durationMs, agents, events };
}

/** What the communication views show; every field narrows the events. */
export interface CommsFilter {
  launches: boolean;
  messages: boolean;
  reads: boolean;
  /** Only exchanges this agent sent or received. */
  agentKey?: string | null;
  /** Case-insensitive match against the message text. */
  query?: string;
}

export const DEFAULT_COMMS_FILTER: CommsFilter = {
  launches: true,
  messages: true,
  reads: true,
  agentKey: null,
  query: "",
};

export function filterCommsEvents(
  events: readonly CommsTimelineEvent[],
  filter: CommsFilter,
): CommsTimelineEvent[] {
  const query = filter.query?.trim().toLowerCase();
  return events.filter((ev) => {
    const kind = ev.comm.kind;
    if (kind === "launch" && !filter.launches) return false;
    if (kind === "message" && !filter.messages) return false;
    if (kind === "read" && !filter.reads) return false;
    if (filter.agentKey && ev.fromKey !== filter.agentKey && !ev.toKeys.includes(filter.agentKey)) {
      return false;
    }
    return !query || ev.comm.content.toLowerCase().includes(query);
  });
}

/** Offsets on a communication timeline: "12.4s" for short sessions, "3:05" or "1:02:10" otherwise. */
export function formatTimelineOffset(ms: number, durationMs: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (durationMs <= 90_000) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// ── Time scale with idle gaps collapsed ────────────────────────────────────

export interface CommsTimeBreak {
  /** Where the collapsed gap starts and how long it is drawn, on the visual scale. */
  atVisualMs: number;
  visualMs: number;
  /** The real idle time it stands for. */
  realMs: number;
}

export interface CommsTimeScale {
  /** Length of the visual scale once idle gaps are collapsed. */
  durationMs: number;
  toVisual(ms: number): number;
  toReal(visualMs: number): number;
  breaks: CommsTimeBreak[];
}

/** Gaps with no recorded activity longer than this collapse to a marked break. */
const IDLE_GAP_MS = 10 * 60_000;

interface ScaleSegment {
  realStart: number;
  realEnd: number;
  visualStart: number;
  visualEnd: number;
}

/**
 * A piecewise-linear scale that keeps active stretches proportional and
 * collapses idle gaps (nothing recorded for over ten minutes) to a short,
 * marked break, so a session resumed after hours or days stays readable.
 */
export function buildTimeScale(timeline: CommsTimeline, idleGapMs = IDLE_GAP_MS): CommsTimeScale {
  const points = new Set<number>([0, timeline.durationMs]);
  for (const a of timeline.agents) {
    points.add(a.startMs);
    points.add(a.endMs);
    for (const ms of a.activityMs) points.add(ms);
  }
  for (const ev of timeline.events) {
    points.add(ev.atMs);
    for (const d of ev.deliveries) points.add(d.atMs);
  }
  const sorted = [...points]
    .filter((ms) => ms >= 0 && ms <= timeline.durationMs)
    .sort((a, b) => a - b);

  const gaps: Array<[number, number]> = [];
  for (let i = 1; i < sorted.length; i++) {
    const [a, b] = [sorted[i - 1] as number, sorted[i] as number];
    if (b - a > idleGapMs) gaps.push([a, b]);
  }
  const idle = gaps.reduce((sum, [a, b]) => sum + (b - a), 0);
  const collapsed = Math.min(60_000, Math.max(5_000, (timeline.durationMs - idle) * 0.02));

  const segments: ScaleSegment[] = [];
  const breaks: CommsTimeBreak[] = [];
  let real = 0;
  let visual = 0;
  const push = (realEnd: number, visualLength: number) => {
    segments.push({
      realStart: real,
      realEnd,
      visualStart: visual,
      visualEnd: visual + visualLength,
    });
    real = realEnd;
    visual += visualLength;
  };
  for (const [a, b] of gaps) {
    push(a, a - real);
    breaks.push({ atVisualMs: visual, visualMs: collapsed, realMs: b - a });
    push(b, collapsed);
  }
  push(timeline.durationMs, timeline.durationMs - real);

  const map = (value: number, from: "real" | "visual"): number => {
    const seg =
      segments.find((s) => (from === "real" ? value <= s.realEnd : value <= s.visualEnd)) ??
      segments[segments.length - 1];
    if (!seg) return value;
    const [a0, a1, b0, b1] =
      from === "real"
        ? [seg.realStart, seg.realEnd, seg.visualStart, seg.visualEnd]
        : [seg.visualStart, seg.visualEnd, seg.realStart, seg.realEnd];
    if (a1 === a0) return b0;
    return b0 + ((Math.min(Math.max(value, a0), a1) - a0) / (a1 - a0)) * (b1 - b0);
  };

  return {
    durationMs: visual,
    toVisual: (ms) => map(ms, "real"),
    toReal: (v) => map(v, "visual"),
    breaks,
  };
}

// ── Lane packing ──────────────────────────────────────────────────────────

/**
 * Assigns agents to shared lanes so that agents alive at the same time never
 * share one; the main agent keeps lane 0 to itself. The lane count is then
 * the session's peak concurrency rather than its total number of agents.
 */
export function packAgentLanes(agents: readonly CommsTimelineAgent[]): Map<string, number> {
  const lanes = new Map<string, number>();
  const laneEnds: number[] = [];
  const workers = agents.filter((a) => !a.isMain).sort((a, b) => a.startMs - b.startMs);
  for (const a of agents) if (a.isMain) lanes.set(a.key, 0);
  for (const a of workers) {
    let lane = laneEnds.findIndex((end) => end < a.startMs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(a.endMs);
    } else {
      laneEnds[lane] = a.endMs;
    }
    lanes.set(a.key, lane + 1);
  }
  return lanes;
}
