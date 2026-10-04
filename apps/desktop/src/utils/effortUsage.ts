import { type EffortUsageEntry, NANO_AIU_PER_AI_CREDIT } from "@tracepilot/types";

/** Copilot CLI's effort levels, lowest first. */
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Label for user turns that ran at the model's default effort. */
export const DEFAULT_EFFORT_LABEL = "default";

/**
 * Per-user-turn averages for one model and effort. Event-backed figures
 * average over every user turn; recorded-request figures average over the
 * user turns the session store covered, and are `null` when it covered none.
 */
export interface EffortRow {
  key: string;
  model: string;
  effort: string;
  sessions: number;
  userTurns: number;
  requestsPerTurn: number;
  toolCallsPerTurn: number;
  wallMsPerTurn: number;
  observedUserTurns: number;
  reasoningTokensPerTurn: number | null;
  apiMsPerTurn: number | null;
  creditsPerTurn: number | null;
}

export function effortRank(effort: string): number {
  const rank = EFFORT_ORDER.indexOf(effort);
  return rank === -1 ? EFFORT_ORDER.length : rank;
}

/** Rows grouped by model (most user turns first), efforts lowest first. */
export function effortRows(entries: readonly EffortUsageEntry[]): EffortRow[] {
  const turnsByModel = new Map<string, number>();
  for (const entry of entries) {
    const model = entry.model ?? "unknown";
    turnsByModel.set(model, (turnsByModel.get(model) ?? 0) + entry.userTurns);
  }
  return entries
    .filter((entry) => entry.userTurns > 0)
    .map((entry) => {
      const model = entry.model ?? "unknown";
      const effort = entry.reasoningEffort ?? DEFAULT_EFFORT_LABEL;
      const turns = entry.userTurns;
      const observed = entry.observedUserTurns;
      const perObserved = (value: number) => (observed > 0 ? value / observed : null);
      return {
        key: `${model}\u0000${effort}`,
        model,
        effort,
        sessions: entry.sessions,
        userTurns: turns,
        requestsPerTurn: entry.agentTurns / turns,
        toolCallsPerTurn: entry.toolCalls / turns,
        wallMsPerTurn: entry.wallMs / turns,
        observedUserTurns: observed,
        reasoningTokensPerTurn: perObserved(entry.reasoningTokens),
        apiMsPerTurn: perObserved(entry.apiDurationMs),
        creditsPerTurn: perObserved(entry.nanoAiu / NANO_AIU_PER_AI_CREDIT),
      };
    })
    .sort(
      (a, b) =>
        (turnsByModel.get(b.model) ?? 0) - (turnsByModel.get(a.model) ?? 0) ||
        a.model.localeCompare(b.model) ||
        effortRank(a.effort) - effortRank(b.effort),
    );
}

/** How many user turns had recorded requests, out of all of them. */
export function effortCoverage(entries: readonly EffortUsageEntry[]): {
  observed: number;
  total: number;
} {
  return entries.reduce(
    (sum, entry) => ({
      observed: sum.observed + entry.observedUserTurns,
      total: sum.total + entry.userTurns,
    }),
    { observed: 0, total: 0 },
  );
}
