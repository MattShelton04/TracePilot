/**
 * Shared delta-formatting utilities for comparison views.
 *
 * SessionComparisonView and ModelComparisonView both compute deltas between
 * two numeric values with directional indicators. The core maths differ
 * slightly (different diff direction, different percentage base) so each
 * view keeps its own formatter, but they are co-located here to eliminate
 * duplication of location and make them independently testable.
 */

import { formatPercent } from "@tracepilot/types";

// ── Session comparison delta ────────────────────────────────────────────────

/** Result of {@link formatSessionDelta}. */
export interface FormattedDelta {
  /** Human-readable label, e.g. "↑ 12%" or "↓ 3.5" */
  delta: string;
  /** CSS class name: delta-positive | delta-negative | delta-neutral */
  deltaClass: string;
  /** Arrow character: "↑" | "↓" | "" */
  arrow: string;
}

/**
 * Format the delta between two values for the session-comparison table.
 *
 * Direction: `b − a` (session B vs session A).
 * Percentage base: `max(|a|, 1)`.
 */
export function formatSessionDelta(a: number, b: number, higherIsBetter: boolean): FormattedDelta {
  if (a === 0 && b === 0) return { delta: "—", deltaClass: "delta-neutral", arrow: "" };
  const diff = b - a;
  if (Math.abs(diff) < 0.001) return { delta: "—", deltaClass: "delta-neutral", arrow: "" };
  const base = Math.max(Math.abs(a), 1);
  const pct = Math.abs(diff / base) * 100;
  const isBetter = higherIsBetter ? diff > 0 : diff < 0;
  const arrow = diff > 0 ? "↑" : "↓";
  const cls = isBetter ? "delta-positive" : "delta-negative";

  // Use whole percentages for large changes, otherwise one clean decimal
  const label =
    pct > 1 ? `${pct.toFixed(0)}%` : `${Math.abs(diff).toFixed(1).replace(/\.0+$/, "")}`;

  return { delta: `${arrow} ${label}`, deltaClass: cls, arrow };
}

// ── Model comparison delta ──────────────────────────────────────────────────

/** Result of {@link formatModelDelta}. */
export interface ModelDelta {
  /** Human-readable label, e.g. "+12.5%" or "—" */
  delta: string;
  /** Direction of the change */
  direction: "up" | "down" | "neutral";
  /** Which side is "better" */
  better: "a" | "b" | "neutral";
}

/**
 * Format the delta between two model rows for the model-comparison table.
 *
 * Direction: `a − b` (model A vs model B).
 * Percentage base: `|b|` (with ∞ fallback for b = 0).
 */
export function formatModelDelta(a: number, b: number, higherIsBetter: boolean): ModelDelta {
  const diff = a - b;
  if (Math.abs(diff) < 0.001) return { delta: "—", direction: "neutral", better: "neutral" };

  const pctLabel =
    b !== 0 ? formatPercent((diff / Math.abs(b)) * 100) : diff > 0 ? "∞%" : "-∞%";

  const direction: "up" | "down" = diff > 0 ? "up" : "down";
  const better: "a" | "b" = higherIsBetter ? (diff > 0 ? "a" : "b") : diff < 0 ? "a" : "b";
  return { delta: `${diff > 0 ? "+" : ""}${pctLabel}`, direction, better };
}
