import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { detectParallelIds, type TimeSpanItem, toTimeSpan } from "@tracepilot/ui";

export interface WaterfallRow {
  call: TurnToolCall;
  depth: number;
  id: string;
  parentId: string | null;
  leftPct: number;
  widthPct: number;
  isParallel: boolean;
}

export interface RulerTick {
  label: string;
  leftPct: number;
}

/** Earliest startedAt timestamp (epoch ms) across the turn's tool calls. */
export function computeEpochStart(turn: ConversationTurn | undefined): number {
  if (!turn) return 0;
  let earliest = Infinity;
  for (const tc of turn.toolCalls) {
    if (tc.startedAt) {
      const ms = new Date(tc.startedAt).getTime();
      if (ms < earliest) earliest = ms;
    }
  }
  return earliest === Infinity ? 0 : earliest;
}

/** Timeline span in ms (max completedAt − earliest startedAt, or turn duration). */
export function computeTimelineSpanMs(
  turn: ConversationTurn | undefined,
  allToolCalls: TurnToolCall[],
  epochStart: number,
): number {
  const turnDurationMs = turn?.durationMs ?? 0;
  if (!turn || turn.toolCalls.length === 0) return turnDurationMs || 1;
  if (!epochStart) return turnDurationMs || 1;

  let latest = epochStart;

  const subagentIds = new Set<string>();
  for (const tc of turn.toolCalls) {
    if (tc.isSubagent && tc.toolCallId) subagentIds.add(tc.toolCallId);
  }

  const relevantCalls = [
    ...turn.toolCalls,
    ...allToolCalls.filter(
      (tc) =>
        tc.parentToolCallId && subagentIds.has(tc.parentToolCallId) && !turn.toolCalls.includes(tc),
    ),
  ];

  for (const tc of relevantCalls) {
    if (tc.completedAt) {
      const ms = new Date(tc.completedAt).getTime();
      if (ms > latest) latest = ms;
    } else if (tc.startedAt && tc.durationMs) {
      const ms = new Date(tc.startedAt).getTime() + tc.durationMs;
      if (ms > latest) latest = ms;
    }
  }
  const span = latest - epochStart;
  return Math.max(span, turnDurationMs || 1, 1);
}

/** Build flat row list with hierarchy and positions. */
export function computeRows(
  turn: ConversationTurn | undefined,
  allToolCalls: TurnToolCall[],
  span: number,
  epochStart: number,
): WaterfallRow[] {
  if (!turn) return [];

  const calls = turn.toolCalls;

  const byId = new Map<string, TurnToolCall>();
  for (const tc of calls) {
    if (tc.toolCallId) byId.set(tc.toolCallId, tc);
  }

  const topLevel: TurnToolCall[] = [];
  const childrenMap = new Map<string, TurnToolCall[]>();

  for (const tc of allToolCalls) {
    if (tc.parentToolCallId && byId.has(tc.parentToolCallId)) {
      const siblings = childrenMap.get(tc.parentToolCallId) ?? [];
      siblings.push(tc);
      childrenMap.set(tc.parentToolCallId, siblings);
    }
  }

  const allSubagentIds = new Set<string>();
  for (const tc of allToolCalls) {
    if (tc.isSubagent && tc.toolCallId) allSubagentIds.add(tc.toolCallId);
  }

  for (const tc of calls) {
    if (
      !(
        tc.parentToolCallId &&
        (byId.has(tc.parentToolCallId) || allSubagentIds.has(tc.parentToolCallId))
      )
    ) {
      topLevel.push(tc);
    }
  }

  const subagentCalls = topLevel.filter((tc) => tc.isSubagent && tc.startedAt);
  const spans = subagentCalls.map(toTimeSpan).filter((s): s is TimeSpanItem => s !== null);
  const parallelIds = detectParallelIds(spans);

  let fallbackIdx = 0;

  function position(tc: TurnToolCall): { leftPct: number; widthPct: number } {
    if (!epochStart || !tc.startedAt) {
      const count = calls.length || 1;
      const left = (fallbackIdx / count) * 100;
      const width = Math.max((1 / count) * 100, 1);
      fallbackIdx++;
      return { leftPct: left, widthPct: width };
    }
    const startMs = new Date(tc.startedAt).getTime() - epochStart;
    const durMs =
      tc.durationMs ??
      (tc.completedAt ? new Date(tc.completedAt).getTime() - new Date(tc.startedAt).getTime() : 0);
    const left = (startMs / span) * 100;
    const width = Math.max((durMs / span) * 100, 0.5);
    return { leftPct: Math.min(left, 100), widthPct: Math.min(width, 100 - left) };
  }

  const result: WaterfallRow[] = [];
  for (const tc of topLevel) {
    const { leftPct, widthPct } = position(tc);
    const id = tc.toolCallId ?? `idx-${result.length}`;
    result.push({
      call: tc,
      depth: 0,
      id,
      parentId: null,
      leftPct,
      widthPct,
      isParallel: parallelIds.has(id),
    });

    if (tc.toolCallId && childrenMap.has(tc.toolCallId)) {
      const children = childrenMap.get(tc.toolCallId) ?? [];
      for (const child of children) {
        const pos = position(child);
        result.push({
          call: child,
          depth: 1,
          id: child.toolCallId ?? `idx-${result.length}`,
          parentId: tc.toolCallId,
          leftPct: pos.leftPct,
          widthPct: pos.widthPct,
          isParallel: false,
        });
      }
    }
  }
  return result;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Tick steps the ruler may use, smallest first. */
const RULER_STEPS = [
  100,
  200,
  500,
  SECOND,
  2 * SECOND,
  5 * SECOND,
  10 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
];

/** At most this many intervals, so at most one more tick label than this. */
const MAX_RULER_INTERVALS = 6;

/**
 * A tick's offset from the turn's start, without zero parts: `0s`, `500ms`,
 * `1.5s`, `45s`, `1m 30s`, `10m`, `2h`, `1h 30m`.
 */
export function formatRulerOffset(ms: number): string {
  if (ms === 0) return "0s";
  if (ms < SECOND) return `${ms}ms`;
  if (ms < MINUTE) return `${Math.round(ms / 100) / 10}s`;
  const hours = Math.floor(ms / HOUR);
  const minutes = Math.floor((ms % HOUR) / MINUTE);
  const seconds = Math.round((ms % MINUTE) / SECOND);
  const parts = [
    hours && `${hours}h`,
    minutes && `${minutes}m`,
    !hours && seconds && `${seconds}s`,
  ];
  return parts.filter(Boolean).join(" ");
}

/**
 * Ruler ticks for the timeline axis: the smallest step that keeps the span to
 * at most {@link MAX_RULER_INTERVALS} intervals, so labels never pile up, however long the turn.
 */
export function computeRulerTicks(span: number): RulerTick[] {
  if (!(span > 0) || !Number.isFinite(span)) return [];

  const fitting = RULER_STEPS.find((step) => span / step <= MAX_RULER_INTERVALS);
  // Longer than the largest step allows: whole days per interval.
  const interval = fitting ?? Math.ceil(span / MAX_RULER_INTERVALS / (24 * HOUR)) * 24 * HOUR;

  const ticks: RulerTick[] = [];
  for (let ms = 0; ms <= span; ms += interval) {
    ticks.push({ label: formatRulerOffset(ms), leftPct: (ms / span) * 100 });
  }
  return ticks;
}
