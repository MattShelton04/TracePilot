/**
 * Sort comparator factory for the model-comparison table.
 *
 * Extracted from `useModelComparison` so the sort logic can be exercised
 * directly in unit tests.
 */

import type { ModelRow, SortKey } from "./types";

/**
 * Return a stable comparator that sorts `ModelRow`s by `key` in the given
 * direction.
 *
 * - `model` sorts lexicographically (locale-aware).
 * - `cost` treats `null` as "unknown" and always pushes unknowns to the
 *   end of the list regardless of direction.
 * - `aiCredits` sorts the cost column: rows billed in AI Credits by credits,
 *   then rows priced in USD by their estimate, so units never interleave;
 *   unknowns go last.
 * - All other keys are numeric.
 */
export function buildRowComparator(
  key: SortKey,
  dir: "asc" | "desc",
): (a: ModelRow, b: ModelRow) => number {
  const sign = dir === "asc" ? 1 : -1;

  if (key === "model") {
    return (a, b) => sign * a.model.localeCompare(b.model);
  }

  if (key === "cost") {
    return (a, b) => {
      const ac = a.cost ?? Infinity;
      const bc = b.cost ?? Infinity;
      if (ac === Infinity && bc === Infinity) return 0;
      if (ac === Infinity) return 1;
      if (bc === Infinity) return -1;
      return sign * (ac - bc);
    };
  }

  if (key === "aiCredits") {
    const unit = (row: ModelRow) => (row.billedInAiCredits ? 0 : 1);
    const value = (row: ModelRow) => (row.billedInAiCredits ? row.aiCredits : row.costUsd);
    return (a, b) => {
      if (unit(a) !== unit(b)) return unit(a) - unit(b);
      const av = value(a);
      const bv = value(b);
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
      return sign * (av - bv);
    };
  }

  return (a, b) => sign * ((a[key] as number) - (b[key] as number));
}

/** Sort `rows` (immutably) by `key` / `dir`. */
export function sortRows(rows: readonly ModelRow[], key: SortKey, dir: "asc" | "desc"): ModelRow[] {
  return [...rows].sort(buildRowComparator(key, dir));
}

/** Glyph for column-header sort indicators. */
export function sortArrow(currentKey: SortKey, currentDir: "asc" | "desc", key: SortKey): string {
  if (currentKey !== key) return "⇅";
  return currentDir === "asc" ? "↑" : "↓";
}
