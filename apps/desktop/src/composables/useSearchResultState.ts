import { ref, computed, watch } from 'vue';
import type { Ref, ComputedRef } from 'vue';
import { useToggleSet } from '@tracepilot/ui';

export interface UseSearchResultStateOptions {
  /** Session ID filter from the search store. */
  sessionId: Ref<string | null>;
  /** Flat search results (for resolving session display names). */
  results: ComputedRef<{ sessionId: string; sessionSummary: string | null }[]> | Ref<{ sessionId: string; sessionSummary: string | null }[]>;
  /** Grouped search results (for resolving session display names). */
  groupedResults: ComputedRef<{ sessionId: string; sessionSummary: string | null }[]> | Ref<{ sessionId: string; sessionSummary: string | null }[]>;
  /** Current result view mode. */
  resultViewMode: Ref<'flat' | 'grouped'>;
}

/**
 * Composable for managing search result UI state:
 * - Expand/collapse individual result cards
 * - Collapse/expand session groups
 * - Session display name resolution
 * - Session filter management
 *
 * Uses `useToggleSet` from `@tracepilot/ui` for expand/collapse state.
 */
export function useSearchResultState(options: UseSearchResultStateOptions) {
  const { sessionId, results, groupedResults, resultViewMode } = options;

  // ── Expand/collapse individual results ──
  const {
    set: expandedResults,
    toggle: toggleExpand,
  } = useToggleSet<number>();

  // ── Collapse/expand session groups ──
  const {
    set: collapsedGroups,
    toggle: toggleGroupCollapse,
  } = useToggleSet<string>();

  // ── Session filter display name ──
  // Track the display name for the currently filtered session (set explicitly via filterBySession)
  const filteredSessionNameOverride = ref<string | null>(null);

  // Clear override when sessionId changes externally (e.g. URL sync, chip removal, route restore).
  // filterBySession suppresses the next clear to avoid losing its own override.
  let suppressNextOverrideClear = false;

  watch(sessionId, () => {
    if (suppressNextOverrideClear) {
      suppressNextOverrideClear = false;
      return;
    }
    filteredSessionNameOverride.value = null;
  });

  // Resolve session display name: explicit override → lookup from results → truncated ID
  const sessionDisplayName = computed(() => {
    if (!sessionId.value) return null;
    if (filteredSessionNameOverride.value) return filteredSessionNameOverride.value;
    // Try to find a name from current results
    const match = results.value.find(r => r.sessionId === sessionId.value);
    if (match?.sessionSummary) return match.sessionSummary;
    // Try grouped results
    const group = groupedResults.value.find(g => g.sessionId === sessionId.value);
    if (group?.sessionSummary) return group.sessionSummary;
    return sessionId.value.slice(0, 12) + '…';
  });

  function filterBySession(sid: string, displayName: string | null) {
    suppressNextOverrideClear = true;
    sessionId.value = sid;
    filteredSessionNameOverride.value = displayName || null;
    resultViewMode.value = 'flat';
  }

  return {
    expandedResults,
    toggleExpand,
    collapsedGroups,
    toggleGroupCollapse,
    filteredSessionNameOverride,
    sessionDisplayName,
    filterBySession,
  };
}
