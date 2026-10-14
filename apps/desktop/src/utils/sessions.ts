/**
 * Free-text session search for small pickers (Export, Compare), matching the
 * way the session list searches. The list's own filtering, with its sort and
 * repository/source filters, lives in `stores/sessions/filtering.ts`.
 */
import type { SessionListItem } from "@tracepilot/types";
import {
  buildSearchFieldCache,
  matchesSessionFilters,
  parseSearchTerms,
  type SessionSearchFields,
} from "@/stores/sessions/filtering";

/**
 * Sessions matching every word of `query`, each word found in the summary,
 * repository, branch, working directory (and so the folder a picker shows as
 * the project), model or id, case-insensitively and in any order.
 *
 * A blank query returns the input untouched (same reference) so callers can
 * use the result as a stable computed value. Pass `cache` from
 * `buildSearchFieldCache` to avoid rebuilding it on every keystroke.
 */
export function filterSessionsByQuery(
  sessions: readonly SessionListItem[],
  query: string,
  cache: Map<string, SessionSearchFields> = buildSearchFieldCache(sessions),
): readonly SessionListItem[] {
  const searchTerms = parseSearchTerms(query);
  if (searchTerms.length === 0) return sessions;
  const predicates = { searchTerms, repository: null, hideEmptySessions: false };
  return sessions.filter((s) => matchesSessionFilters(s, predicates, cache));
}
