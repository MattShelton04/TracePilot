import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { detectParallelIds, formatDuration, type TimeSpanItem, toTimeSpan } from "@tracepilot/ui";

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

/** Compute ruler ticks for the timeline axis. */
export function computeRulerTicks(span: number): RulerTick[] {
  if (span <= 0) return [];

  const intervals = [
    500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
  ];
  const targetTicks = 6;
  let interval = intervals[intervals.length - 1];
  for (const iv of intervals) {
    if (span / iv <= targetTicks) {
      interval = iv;
      break;
    }
  }

  const ticks: RulerTick[] = [];
  for (let ms = 0; ms <= span; ms += interval) {
    ticks.push({
      label: formatDuration(ms) || "0s",
      leftPct: (ms / span) * 100,
    });
  }
  return ticks;
}
