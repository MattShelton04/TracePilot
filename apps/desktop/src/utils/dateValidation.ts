/**
 * Shared date-validation helpers for search date filters.
 *
 * Used by the search store, URL-sync composable, and view layer
 * to avoid duplicating trimming / emptiness checks.
 */

/** Returns true when the value is a non-empty, non-whitespace string. */
export function hasMeaningfulDateValue(value: string | null): boolean {
  return value != null && value.trim().length > 0;
}

/** Trims whitespace; returns `null` for null, empty, or whitespace-only inputs. */
export function normalizeDateValue(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
