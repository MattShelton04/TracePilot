/**
 * Joining recorded request roll-ups to the agent-usage breakdown.
 *
 * These figures come from the Copilot CLI's session store and sit *beside*
 * the shutdown-based agent totals rather than replacing them: the shutdown
 * snapshot and the recorded requests count different things, and request
 * coverage is routinely incomplete.
 *
 * Credits are kept as exact decimals throughout. `ownNanoAiu` regularly
 * exceeds `Number.MAX_SAFE_INTEGER`, so parsing it with `Number()` would
 * corrupt the figure before it was ever displayed.
 */

import type { AgentRequestRollup } from "@tracepilot/types";
import type { AgentUsageRow } from "./agentUsageRows";
import { addExact, type ExactDecimal, parseExactDecimal } from "./requestLedger";

export interface AgentRequestFigures {
  requestCount: number;
  /** Exact nano AI units; `null` when nothing usable was recorded. */
  nanoAiu: ExactDecimal | null;
  /** Roll-ups whose recorded charge was unreadable and so was not summed. */
  unparsedCredits: number;
  cacheReadTokens: number;
  inputTokens: number;
}

export interface AgentRequestColumns {
  own: AgentRequestFigures;
  /** Descendants summed once, matching how the breakdown derives branches. */
  branch: AgentRequestFigures;
}

export interface AgentRequestAttribution {
  /** Requests whose join to a run was not exact. Displayed, never folded in. */
  unattributedRequests: number;
  /** The roll-up carrying no run or agent identity, when the source had one. */
  unmatched: AgentRequestFigures | null;
  /** Roll-ups that named a run the breakdown has no row for. */
  unmatchedRollups: number;
}

export interface AgentRequestJoin {
  byRow: Map<string, AgentRequestColumns>;
  attribution: AgentRequestAttribution;
  /** True once at least one row or the unmatched bucket has figures. */
  hasFigures: boolean;
}

function emptyFigures(): AgentRequestFigures {
  return {
    requestCount: 0,
    nanoAiu: null,
    unparsedCredits: 0,
    cacheReadTokens: 0,
    inputTokens: 0,
  };
}

function toFigures(rollup: AgentRequestRollup): AgentRequestFigures {
  const parsed = rollup.ownNanoAiu == null ? null : parseExactDecimal(rollup.ownNanoAiu);
  return {
    requestCount: rollup.requestCount,
    nanoAiu: parsed,
    unparsedCredits: rollup.requestCount > 0 && parsed == null ? 1 : 0,
    cacheReadTokens: rollup.cacheReadTokens,
    inputTokens: rollup.inputTokens,
  };
}

function addFigures(target: AgentRequestFigures, source: AgentRequestFigures): void {
  target.requestCount += source.requestCount;
  target.unparsedCredits += source.unparsedCredits;
  target.cacheReadTokens += source.cacheReadTokens;
  target.inputTokens += source.inputTokens;
  if (source.nanoAiu) {
    target.nanoAiu = target.nanoAiu ? addExact(target.nanoAiu, source.nanoAiu) : source.nanoAiu;
  }
}

function copyFigures(source: AgentRequestFigures): AgentRequestFigures {
  return { ...source };
}

/**
 * Cache reads over input tokens. `null` when there is nothing to divide, or
 * when the counters contradict each other — an impossible ratio is worse
 * than no ratio, and clamping would hide the contradiction.
 */
export function cacheReadRatio(figures: AgentRequestFigures): number | null {
  if (figures.inputTokens <= 0) return null;
  if (figures.cacheReadTokens > figures.inputTokens) return null;
  return figures.cacheReadTokens / figures.inputTokens;
}

/**
 * Attach each roll-up to the agent row that owns it and derive branch totals
 * by summing descendants exactly once, as `buildAgentUsageRows` already does
 * for shutdown figures. A branch total is never added back into a session
 * total: that would count every descendant twice.
 */
export function joinAgentRequestRollups(
  rows: readonly AgentUsageRow[],
  rollups: readonly AgentRequestRollup[],
): AgentRequestJoin {
  let unmatched: AgentRequestFigures | null = null;
  let unattributedRequests = 0;
  let unmatchedRollups = 0;
  const byRow = new Map<string, AgentRequestColumns>();
  for (const row of rows) {
    byRow.set(row.id, { own: emptyFigures(), branch: emptyFigures() });
  }
  for (const rollup of rollups) {
    unattributedRequests += rollup.unattributedRequests;
    const figures = toFigures(rollup);
    const byTool = rows.filter((row) => row.toolCallId && row.toolCallId === rollup.runKey);
    const byAgent = rows.filter((row) => row.id === rollup.agentId);
    const candidates = byTool.length
      ? byTool
      : byAgent.length
        ? byAgent
        : rows.filter((row) => row.id === rollup.runKey);
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    const target =
      rollup.unattributedRequests === 0 && candidate ? byRow.get(candidate.id) : undefined;
    if (target) addFigures(target.own, figures);
    else {
      if (unmatched) addFigures(unmatched, figures);
      else unmatched = figures;
      if (rollup.agentId != null || rollup.runKey != null) unmatchedRollups += 1;
    }
  }
  for (const columns of byRow.values()) columns.branch = copyFigures(columns.own);

  // Reverse order visits children before parents, so each descendant is
  // folded into its parent exactly once.
  for (const row of [...rows].reverse()) {
    const parent = row.parentId ? rows.find((candidate) => candidate.id === row.parentId) : null;
    if (!parent || parent.depth + 1 !== row.depth) continue;
    const parentColumns = byRow.get(parent.id);
    const rowColumns = byRow.get(row.id);
    if (parentColumns && rowColumns) addFigures(parentColumns.branch, rowColumns.branch);
  }

  const hasFigures =
    [...byRow.values()].some((columns) => columns.own.requestCount > 0) ||
    (unmatched?.requestCount ?? 0) > 0;

  return {
    byRow,
    attribution: { unattributedRequests, unmatched, unmatchedRollups },
    hasFigures,
  };
}
