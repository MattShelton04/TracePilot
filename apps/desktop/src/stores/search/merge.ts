import type { SearchContentType, SessionSource } from "@tracepilot/types";
import type { ParsedQualifiers } from "@/utils/parseQualifiers";

export type SortMode = "relevance" | "newest" | "oldest";

export interface MergeSearchInputsState {
  contentTypes: readonly SearchContentType[];
  repository: string | null;
  toolName: string | null;
  sessionId: string | null;
  source: SessionSource | null;
  sortBy: SortMode;
  isBrowseMode: boolean;
}

export interface MergedSearchInputs {
  searchQuery: string;
  contentTypes: SearchContentType[];
  repository: string | null;
  toolName: string | null;
  sessionId: string | null;
  source: SessionSource | null;
  sortBy: SortMode;
}

/**
 * The sort results really use: with no text query there is nothing to rank
 * by relevance, so browse mode lists the newest first.
 */
export function effectiveSortMode(sortBy: SortMode, isBrowseMode: boolean): SortMode {
  return isBrowseMode && sortBy === "relevance" ? "newest" : sortBy;
}

/**
 * Merge inline qualifier syntax (e.g. `type:error repo:foo`) with the
 * explicit UI filters held by the query slice. Pure function — no Vue
 * reactivity, safe to unit-test in isolation.
 *
 * Browse mode (no text query) downgrades a `relevance` sort, typed or picked,
 * to `newest` because relevance is meaningless when there is nothing to rank against.
 */
export function mergeSearchInputs(
  parsed: ParsedQualifiers,
  state: MergeSearchInputsState,
): MergedSearchInputs {
  const effectiveSort = effectiveSortMode(parsed.sort ?? state.sortBy, state.isBrowseMode);

  const contentTypes =
    parsed.types.length > 0
      ? [...new Set([...state.contentTypes, ...parsed.types])]
      : [...state.contentTypes];

  return {
    searchQuery: parsed.cleanQuery,
    contentTypes,
    repository: parsed.repo ?? state.repository,
    toolName: parsed.tool ?? state.toolName,
    sessionId: parsed.session ?? state.sessionId,
    source: parsed.source ?? state.source,
    sortBy: effectiveSort,
  };
}
