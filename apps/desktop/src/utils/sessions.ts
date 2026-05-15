/**
 * Shared helpers for filtering session lists in UI surfaces (export tab,
 * pickers, palettes). Heavier session-list filtering with predicate caches
 * lives in `stores/sessions/filtering.ts`; this module covers the simple
 * "match a free-text query against id/summary/repository" case used by
 * small dropdowns and search inputs.
 */

/** Minimal shape a session-like object must expose to be filterable. */
export interface FilterableSession {
  id: string;
  summary?: string | null;
  repository?: string | null;
}

/**
 * Case-insensitive substring filter across `id`, `summary`, and `repository`.
 *
 * Empty / whitespace-only queries return the input untouched (same reference)
 * so callers can use the result as a stable computed value.
 */
export function filterSessionsBySubstring<T extends FilterableSession>(
  sessions: readonly T[],
  query: string,
): readonly T[] {
  const q = query.toLowerCase().trim();
  if (!q) return sessions;
  return sessions.filter((s) => {
    const summary = (s.summary || "").toLowerCase();
    const repo = (s.repository || "").toLowerCase();
    const id = s.id.toLowerCase();
    return summary.includes(q) || repo.includes(q) || id.includes(q);
  });
}
