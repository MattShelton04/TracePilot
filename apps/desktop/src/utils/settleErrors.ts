import { toErrorMessage } from '@tracepilot/ui';

/**
 * Extract a combined error message from `Promise.allSettled` results.
 *
 * Filters the settled array to rejected entries, maps each reason through
 * `toErrorMessage`, and joins them with `'; '`.  Returns `null` when every
 * promise fulfilled.
 *
 * @example
 * ```ts
 * const results = await Promise.allSettled([fetchA(), fetchB()]);
 * const err = aggregateSettledErrors(results);
 * if (err) error.value = err;
 * ```
 */
export function aggregateSettledErrors(
  results: readonly PromiseSettledResult<unknown>[],
): string | null {
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (rejected.length === 0) return null;
  return rejected.map((r) => toErrorMessage(r.reason)).join('; ');
}
