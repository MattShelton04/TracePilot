/**
 * Shared delta-formatting utilities for comparison views.
 *
 * SessionComparisonView and ModelComparisonView both compute deltas between
 * two numeric values with directional indicators. The core maths differ
 * slightly (different diff direction, different percentage base) so each
 * view keeps its own formatter, but they are co-located here to eliminate
 * duplication of location and make them independently testable.
 */

import { formatCleanFloat, formatPercent } from "@tracepilot/types";

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
 * Percentage base: `|a|`. A zero baseline cannot express percentage growth.
 */
export function formatSessionDelta(a: number, b: number, higherIsBetter: boolean): FormattedDelta {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { delta: "—", deltaClass: "delta-neutral", arrow: "" };
  }
  if (a === 0 && b === 0) return { delta: "—", deltaClass: "delta-neutral", arrow: "" };
  const diff = b - a;
  if (Math.abs(diff) < 0.001) return { delta: "—", deltaClass: "delta-neutral", arrow: "" };
  const isBetter = higherIsBetter ? diff > 0 : diff < 0;
  const arrow = diff > 0 ? "↑" : "↓";
  const cls = isBetter ? "delta-positive" : "delta-negative";

  // Keep units consistent for small/normalized values; never invent a nonzero base.
  const pct = a === 0 ? null : Math.abs(diff / a) * 100;
  const label = pct === null ? "From 0" : `${pct > 1 ? pct.toFixed(0) : formatCleanFloat(pct, 1)}%`;

  return { delta: `${arrow} ${label}`, deltaClass: cls, arrow };
}

/**
 * Format the change between two rates (fractions, 0–1) in percentage points,
 * e.g. 33.3% → 91.2% is "↑ 57.9 pts". A relative change of a percentage
 * ("↑ 174%") reads as if the rate itself had passed 100%.
 *
 * Direction: `b − a` (session B vs session A), as {@link formatSessionDelta}.
 */
export function formatSessionPointDelta(
  a: number,
  b: number,
  higherIsBetter: boolean,
): FormattedDelta {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { delta: "—", deltaClass: "delta-neutral", arrow: "" };
  }
  const points = (b - a) * 100;
  const shown = formatCleanFloat(Math.abs(points), 1);
  if (shown === "0") return { delta: "—", deltaClass: "delta-neutral", arrow: "" };
  const isBetter = higherIsBetter ? points > 0 : points < 0;
  const arrow = points > 0 ? "↑" : "↓";
  return {
    delta: `${arrow} ${shown} ${shown === "1" ? "pt" : "pts"}`,
    deltaClass: isBetter ? "delta-positive" : "delta-negative",
    arrow,
  };
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
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { delta: "—", direction: "neutral", better: "neutral" };
  }
  const diff = a - b;
  if (Math.abs(diff) < 0.001) return { delta: "—", direction: "neutral", better: "neutral" };

  const pctLabel = b !== 0 ? formatPercent((diff / Math.abs(b)) * 100) : diff > 0 ? "∞%" : "-∞%";

  const direction: "up" | "down" = diff > 0 ? "up" : "down";
  const better: "a" | "b" = higherIsBetter ? (diff > 0 ? "a" : "b") : diff < 0 ? "a" : "b";
  return { delta: `${diff > 0 ? "+" : ""}${pctLabel}`, direction, better };
}
