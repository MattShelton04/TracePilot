/**
 * Cost presentation for sources that are not billed in AI Credits. Their
 * figures are API-equivalent USD estimates, never bills, and often cover only
 * part of the session, so every figure carries its basis and coverage.
 */
import {
  type CostBasis,
  calculateClaudeCodeTokenCost,
  claudeCodeCostBasisLabel,
  type SessionSource,
  type ShutdownMetrics,
  type TokenUsageForCost,
} from "@tracepilot/types";
import { formatCost } from "@tracepilot/ui";

export interface SessionCostEstimate {
  /** The current USD estimate; null when it could not be priced. */
  amount: number | null;
  basis: CostBasis | null;
  /** The covered snapshot's cost, kept when the current total is unpriced. */
  snapshotAmount: number | null;
  /** Who produced the figure, e.g. "Claude Code estimate". */
  basisLabel: string;
  /** What the figure covers, in one sentence. */
  coverage: string;
  /** Recorded calls stand in for (part of) the provider's own total. */
  partial: boolean;
}

/** Shown next to every source estimate. */
export const API_EQUIVALENT_NOTE = "API-equivalent token estimate, not a bill.";

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The session's USD estimate, its basis and what it covers. */
export function sessionCostEstimate(
  source: SessionSource,
  metrics: ShutdownMetrics | null | undefined,
): SessionCostEstimate {
  const coverage = metrics?.coverage;
  const basis = metrics?.costUnit === "usd" ? (metrics.costBasis ?? null) : null;
  const amount = basis != null ? (metrics?.costAmount ?? null) : null;
  const snapshot = coverage?.snapshotCost?.unit === "usd" ? coverage.snapshotCost.amount : null;
  const hasSnapshot = coverage?.snapshotLine != null;
  const tail = coverage?.tailCalls ?? 0;
  const recorded = coverage?.recordedCalls ?? 0;
  const partial = coverage != null && (!hasSnapshot || tail > 0);

  let text: string;
  if (!coverage) {
    text = amount == null ? "No cost was recorded." : "Reported with the session's totals.";
  } else if (hasSnapshot && tail === 0) {
    text = "From the session's last cost snapshot.";
  } else if (hasSnapshot) {
    text =
      amount == null
        ? `${plural(tail, "call")} after the last cost snapshot could not be priced.`
        : `Last cost snapshot plus ${plural(tail, "later call")} at API rates.`;
  } else {
    text =
      amount == null
        ? "No cost snapshot, and the recorded calls could not be priced."
        : `${plural(recorded, "recorded call")} at API rates; no cost snapshot.`;
  }
  const label =
    basis == null
      ? "Unavailable"
      : source === "claudeCode"
        ? claudeCodeCostBasisLabel(basis)
        : basis === "billed"
          ? "Billed"
          : "Estimate";
  return { amount, basis, snapshotAmount: snapshot, basisLabel: label, coverage: text, partial };
}

/** USD to the cent; a nonzero amount below half a cent never reads as $0.00. */
export function formatUsd(amount: number): string {
  return amount > 0 && amount < 0.005 ? "< $0.01" : formatCost(amount);
}

/** The display value; an unpriced tail leaves at least the snapshot's cost. */
export function formatSessionCost(cost: SessionCostEstimate): string {
  if (cost.amount != null) return formatUsd(cost.amount);
  return cost.snapshotAmount != null ? `≥ ${formatUsd(cost.snapshotAmount)}` : "—";
}

/** USD for token usage at the source's API rates, or null when unpriced. */
export function sourceTokenUsd(
  source: SessionSource,
  model: string | null | undefined,
  usage: TokenUsageForCost,
): number | null {
  if (!model || source !== "claudeCode") return null;
  return calculateClaudeCodeTokenCost(model, usage).totalCost;
}
