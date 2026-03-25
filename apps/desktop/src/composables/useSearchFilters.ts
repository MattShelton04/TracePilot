import { computed, type Ref, type ComputedRef } from 'vue';
import type { SearchContentType } from '@tracepilot/types';

export type FilterState = 'off' | 'include' | 'exclude';

export interface UseSearchFiltersReturn {
  getContentTypeState: (ct: SearchContentType) => FilterState;
  cycleContentType: (ct: SearchContentType) => void;
  removeContentTypeFilter: (ct: SearchContentType) => void;
  toggleAllContentTypes: (allTypes: SearchContentType[]) => void;
  activeContentTypeChips: ComputedRef<{ type: SearchContentType; mode: 'include' | 'exclude' }[]>;
}

/**
 * Composable for managing tri-state content type filters.
 *
 * This composable provides utilities for managing content type filters with three states:
 * - off: Not filtered
 * - include: Show only this type
 * - exclude: Hide this type
 *
 * The cycle order is: off → include → exclude → off
 *
 * @param contentTypes - Ref array of included content types
 * @param excludeContentTypes - Ref array of excluded content types
 * @returns Object with filter state helpers and computed active chips
 *
 * @example
 * ```typescript
 * const helpers = useSearchFilters(
 *   store.contentTypes,
 *   store.excludeContentTypes
 * );
 *
 * // Check state
 * const state = helpers.getContentTypeState('user_message'); // 'off' | 'include' | 'exclude'
 *
 * // Cycle through states
 * helpers.cycleContentType('user_message'); // off → include
 * helpers.cycleContentType('user_message'); // include → exclude
 * helpers.cycleContentType('user_message'); // exclude → off
 *
 * // Get active chips for display
 * const chips = helpers.activeContentTypeChips.value;
 * ```
 */
export function useSearchFilters(
  contentTypes: Ref<SearchContentType[]>,
  excludeContentTypes: Ref<SearchContentType[]>
): UseSearchFiltersReturn {
  /**
   * Get the current filter state for a content type
   */
  function getContentTypeState(ct: SearchContentType): FilterState {
    if (contentTypes.value.includes(ct)) return 'include';
    if (excludeContentTypes.value.includes(ct)) return 'exclude';
    return 'off';
  }

  /**
   * Cycle a content type through its filter states: off → include → exclude → off
   */
  function cycleContentType(ct: SearchContentType) {
    const state = getContentTypeState(ct);

    // Remove from both arrays first
    const incIdx = contentTypes.value.indexOf(ct);
    if (incIdx >= 0) contentTypes.value.splice(incIdx, 1);

    const excIdx = excludeContentTypes.value.indexOf(ct);
    if (excIdx >= 0) excludeContentTypes.value.splice(excIdx, 1);

    // Cycle: off → include → exclude → off
    if (state === 'off') {
      contentTypes.value.push(ct);
    } else if (state === 'include') {
      excludeContentTypes.value.push(ct);
    }
    // 'exclude' → off: already removed above
  }

  /**
   * Remove a content type filter completely (set to 'off' state)
   */
  function removeContentTypeFilter(ct: SearchContentType) {
    const incIdx = contentTypes.value.indexOf(ct);
    if (incIdx >= 0) contentTypes.value.splice(incIdx, 1);

    const excIdx = excludeContentTypes.value.indexOf(ct);
    if (excIdx >= 0) excludeContentTypes.value.splice(excIdx, 1);
  }

  /**
   * Toggle all content types on/off
   * If any are selected, clear all. If none selected, select all as included.
   */
  function toggleAllContentTypes(allTypes: SearchContentType[]) {
    if (contentTypes.value.length > 0 || excludeContentTypes.value.length > 0) {
      contentTypes.value.splice(0);
      excludeContentTypes.value.splice(0);
    } else {
      contentTypes.value.splice(0, contentTypes.value.length, ...allTypes);
    }
  }

  /**
   * Computed property returning active filter chips for display
   * Each chip has a type and mode (include/exclude)
   */
  const activeContentTypeChips = computed(() => {
    const chips: { type: SearchContentType; mode: 'include' | 'exclude' }[] = [];

    for (const ct of contentTypes.value) {
      chips.push({ type: ct, mode: 'include' });
    }

    for (const ct of excludeContentTypes.value) {
      chips.push({ type: ct, mode: 'exclude' });
    }

    return chips;
  });

  return {
    getContentTypeState,
    cycleContentType,
    removeContentTypeFilter,
    toggleAllContentTypes,
    activeContentTypeChips,
  };
}
