/** Number and cost formatting shared by the Models page charts. */

import { formatAiCredits } from "@tracepilot/types";
import type { ModelRow } from "../types";

/** Compact tick label for a power-of-ten token count: `10k`, `1M`, `1B`. */
export function formatTokenTick(value: number): string {
  if (value >= 1e9) return `${+(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${+(value / 1e3).toFixed(1)}k`;
  return `${value}`;
}

/** Compact token count: `4.16B`, `824.8M`, `31.1k`. */
export function formatTokens(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e8) return `${(value / 1e6).toFixed(0)}M`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e5 ? 0 : 1)}k`;
  return `${Math.round(value)}`;
}

/** A 0–1 fraction as a percentage. */
export function formatShare(value: number | null, digits = 1): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

/** USD with precision that suits the magnitude: `$1,093`, `$47.4`, `$0.37`. */
export function formatUsd(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1000) return `$${Math.round(value).toLocaleString("en-US")}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  return value > 0 ? "<$0.01" : "$0";
}

/** USD per million tokens: `$0.96`, `$0.105`. */
export function formatRate(value: number | null): string {
  if (value == null) return "—";
  return `$${value.toFixed(value >= 0.1 ? 2 : 3)}`;
}

/** A row's cost in its own unit, with the USD equivalent for AI Credits. */
export function formatRowSpend(row: ModelRow): string {
  if (row.billedInAiCredits) {
    return row.aiCredits == null
      ? "Unpriced"
      : `${formatAiCredits(row.aiCredits)} ≈ ${formatUsd(row.usdEquivalent)}`;
  }
  return row.costUsd == null ? "Unpriced" : `${formatUsd(row.costUsd)} est.`;
}
