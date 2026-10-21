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

/** Token count tiers, largest first: the smallest count each covers and how it reads. */
const TOKEN_TIERS = [
  { min: 1e9, unit: 1e9, digits: 2, suffix: "B" },
  { min: 1e8, unit: 1e6, digits: 0, suffix: "M" },
  { min: 1e6, unit: 1e6, digits: 1, suffix: "M" },
  { min: 1e5, unit: 1e3, digits: 0, suffix: "k" },
  { min: 1e3, unit: 1e3, digits: 1, suffix: "k" },
] as const;

/** Compact token count: `4.16B`, `824.8M`, `31.1k`. */
export function formatTokens(value: number): string {
  const i = TOKEN_TIERS.findIndex((tier) => value >= tier.min);
  if (i < 0) {
    const rounded = Math.round(value);
    return rounded >= 1e3 ? formatTokens(rounded) : `${rounded}`;
  }
  const tier = TOKEN_TIERS[i];
  const text = (value / tier.unit).toFixed(tier.digits);
  // A count that rounds up into the tier above reads as that tier (999,950 → "1.0M", not "1000k").
  const rounded = Number(text) * tier.unit;
  if (i > 0 && rounded >= TOKEN_TIERS[i - 1].min) return formatTokens(rounded);
  return `${text}${tier.suffix}`;
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

/** A row's cost in USD, with the AI Credits it was billed in. */
export function formatRowSpend(row: ModelRow): string {
  if (row.billedInAiCredits) {
    return row.aiCredits == null
      ? "Unpriced"
      : `${formatUsd(row.usdEquivalent)} (${formatAiCredits(row.aiCredits)})`;
  }
  return row.costUsd == null ? "Unpriced" : `${formatUsd(row.costUsd)} est.`;
}
