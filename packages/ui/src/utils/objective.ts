/**
 * Derive a session's (or subagent's) **current objective** from a list of
 * tool calls or subagent activity items.
 *
 * Prefer the latest non-empty legacy `report_intent` tool call. When that
 * source is absent, use saved tool `intentionSummary` as activity (not an
 * explicit session objective). Modern `assistant.intent` is ephemeral.
 * Pick "latest" by the largest `eventIndex` (when present), falling back to
 * `completedAt`/`startedAt` timestamps and ultimately to input order so
 * legacy data without event indices still produces a stable result.
 *
 * The banner retains the originating tool/event so either source can be
 * inspected in context, and labels inferred activity separately.
 */
import type { TurnToolCall } from "@tracepilot/types";
import { getToolArgs, toolArgString } from "@tracepilot/types";
import type { SubagentActivityItem } from "../components/SubagentPanel/types";

export interface CurrentObjective {
  /** The intent text reported by the agent (already trimmed, never empty). */
  text: string;
  /** Absent on older callers; treated as a legacy explicit objective. */
  source?: "report_intent" | "tool_intention";
  /** Tool call id of the originating update (for deep-linking). */
  toolCallId?: string;
  /** Event index of the originating update (for deep-linking). */
  eventIndex?: number;
  /** ISO timestamp of the originating event, when available. */
  timestamp?: string;
  /** Number of distinct intent updates observed (≥ 1 once we have one). */
  updateCount: number;
}

interface IntentRecord {
  text: string;
  source: NonNullable<CurrentObjective["source"]>;
  toolCallId?: string;
  eventIndex?: number;
  timestamp?: string;
  /** Stable input ordinal — used as the final tiebreaker. */
  ordinal: number;
}

function recordRank(r: IntentRecord): [number, number, number] {
  // eventIndex is the canonical chronological key. When missing, fall back
  // to the parsed timestamp; otherwise rely on the input ordinal. Keep the
  // domains separate so timestamp-only legacy rows never outrank canonical
  // event-indexed rows.
  if (typeof r.eventIndex === "number") return [2, r.eventIndex, r.ordinal];
  if (r.timestamp) {
    const t = Date.parse(r.timestamp);
    if (Number.isFinite(t)) return [1, t, r.ordinal];
  }
  return [0, r.ordinal, 0];
}

function compareRank(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function pushToolObjective(out: IntentRecord[], tc: TurnToolCall, ordinal: number): void {
  const intent =
    tc.toolName === "report_intent" ? toolArgString(getToolArgs(tc), "intent").trim() : "";
  const text = intent || tc.intentionSummary?.trim();
  if (!text) return;
  out.push({
    text,
    source: intent ? "report_intent" : "tool_intention",
    toolCallId: tc.toolCallId,
    eventIndex: tc.eventIndex,
    timestamp: tc.completedAt ?? tc.startedAt,
    ordinal,
  });
}

function finalize(records: IntentRecord[]): CurrentObjective | null {
  if (records.length === 0) return null;
  // A tool's next action should not replace an explicitly reported objective.
  const explicit = records.filter((record) => record.source === "report_intent");
  if (explicit.length) records = explicit;
  records.sort((a, b) => compareRank(recordRank(a), recordRank(b)));
  const distinctUpdates = records.reduce<string[]>((acc, record) => {
    if (acc[acc.length - 1] !== record.text) acc.push(record.text);
    return acc;
  }, []);
  const latest = records[records.length - 1];
  return {
    text: latest.text,
    source: latest.source,
    toolCallId: latest.toolCallId,
    eventIndex: latest.eventIndex,
    timestamp: latest.timestamp,
    updateCount: distinctUpdates.length,
  };
}

/**
 * Returns the latest objective from a flat list of tool calls. The caller
 * is responsible for pre-filtering scope (e.g. to main agent vs. a single
 * subagent's children).
 */
export function getCurrentObjective(toolCalls: readonly TurnToolCall[]): CurrentObjective | null {
  const records: IntentRecord[] = [];
  for (let i = 0; i < toolCalls.length; i++) pushToolObjective(records, toolCalls[i], i);
  return finalize(records);
}

/**
 * Returns the latest objective for the **main agent** of a conversation —
 * i.e. tool calls without a `parentToolCallId`. Convenience wrapper that
 * accepts the raw turns array used by the conversation view.
 */
export function getMainAgentObjective(
  turns: readonly { toolCalls: readonly TurnToolCall[] }[],
): CurrentObjective | null {
  const records: IntentRecord[] = [];
  let ordinal = 0;
  for (const turn of turns) {
    for (const tc of turn.toolCalls) {
      if (tc.parentToolCallId) continue;
      pushToolObjective(records, tc, ordinal++);
    }
  }
  return finalize(records);
}

/**
 * Returns the latest explicit objective or saved tool activity from an already
 * scoped subagent stream. Intent pills retain their legacy label fallback.
 */
export function getSubagentObjective(
  activities: readonly SubagentActivityItem[],
): CurrentObjective | null {
  const records: IntentRecord[] = [];
  for (let i = 0; i < activities.length; i++) {
    const a = activities[i];
    if (a.kind === "reasoning") continue;
    if (a.kind !== "pill" || a.type !== "intent") {
      pushToolObjective(records, a.toolCall, i);
      continue;
    }
    const tc = a.toolCall;
    const text = toolArgString(getToolArgs(tc), "intent").trim() || a.label.trim();
    if (!text) continue;
    records.push({
      text,
      source: "report_intent",
      toolCallId: tc.toolCallId,
      eventIndex: tc.eventIndex,
      timestamp: tc.completedAt ?? tc.startedAt,
      ordinal: i,
    });
  }
  return finalize(records);
}
