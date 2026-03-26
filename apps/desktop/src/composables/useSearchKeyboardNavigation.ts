import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { Ref, ComputedRef } from 'vue';
import { shouldIgnoreGlobalShortcut } from '@/utils/keyboardShortcuts';

export interface UseSearchKeyboardNavigationOptions {
  /** Ref to the search input element for focus/blur management. */
  searchInputRef: Ref<HTMLInputElement | null>;
  /** Flat list of search results (used for bounds checking). */
  results: ComputedRef<{ id: number }[]> | Ref<{ id: number }[]>;
  /** Whether the search store currently has a query. */
  hasQuery: ComputedRef<boolean> | Ref<boolean>;
  /** Called when Escape is pressed with no focused result and a query is active. */
  onClearAll: () => void;
  /** Called when Enter is pressed on a focused result. */
  onToggleExpand: (id: number) => void;
}

/**
 * Composable for keyboard navigation in the search results view.
 *
 * Supports:
 * - Ctrl/Cmd+K: Focus the search input
 * - ↓ / j: Move focus down through results
 * - ↑ / k: Move focus up through results
 * - Enter: Toggle expand on focused result
 * - Escape: Unfocus result → focus search input, or clear search
 *
 * Registers a global keydown listener on mount and removes it on unmount.
 */
export function useSearchKeyboardNavigation(options: UseSearchKeyboardNavigationOptions) {
  const { searchInputRef, results, hasQuery, onClearAll, onToggleExpand } = options;

  /** Index of the currently focused result (-1 = none). */
  const focusedResultIndex = ref(-1);

  // Reset focus when results change (e.g. new search, page change)
  watch(
    () => results.value.length,
    () => { focusedResultIndex.value = -1; },
  );

  function handleKeydown(e: KeyboardEvent) {
    // Ctrl+K: focus search input (global)
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      e.stopImmediatePropagation();
      searchInputRef.value?.focus();
      searchInputRef.value?.select();
      return;
    }

    const isSearchInput = e.target === searchInputRef.value;

    // From search input: allow arrow keys to navigate into results,
    // and Enter/Esc when a result is already focused
    if (isSearchInput) {
      const isArrow = e.key === 'ArrowDown' || e.key === 'ArrowUp';
      const isEnterOnFocused = e.key === 'Enter' && focusedResultIndex.value >= 0;
      const isEscOnFocused = e.key === 'Escape' && focusedResultIndex.value >= 0;
      if (!isArrow && !isEnterOnFocused && !isEscOnFocused) return;
    }

    if (!isSearchInput && shouldIgnoreGlobalShortcut(e)) return;

    const resultCount = results.value.length;
    if (resultCount === 0) return;

    switch (e.key) {
      case 'ArrowDown':
      case 'j':
        e.preventDefault();
        focusedResultIndex.value = Math.min(focusedResultIndex.value + 1, resultCount - 1);
        if (isSearchInput) searchInputRef.value?.blur();
        scrollToFocusedResult();
        break;
      case 'ArrowUp':
      case 'k':
        e.preventDefault();
        focusedResultIndex.value = Math.max(focusedResultIndex.value - 1, -1);
        if (isSearchInput && focusedResultIndex.value >= 0) searchInputRef.value?.blur();
        scrollToFocusedResult();
        break;
      case 'Enter':
        if (focusedResultIndex.value >= 0) {
          e.preventDefault();
          const result = results.value[focusedResultIndex.value];
          if (result) onToggleExpand(result.id);
        }
        break;
      case 'Escape':
        if (focusedResultIndex.value >= 0) {
          e.preventDefault();
          focusedResultIndex.value = -1;
          searchInputRef.value?.focus();
        } else if (hasQuery.value) {
          onClearAll();
        }
        break;
    }
  }

  function scrollToFocusedResult() {
    if (focusedResultIndex.value < 0) return;
    const el = document.querySelector(`[data-result-index="${focusedResultIndex.value}"]`);
    if (!el) return;
    // Account for sticky summary bar when scrolling.
    // 'nearest' with 'auto' (instant) avoids animation queueing when holding arrow keys.
    const scrollParent = el.closest('.search-main-scroll');
    if (scrollParent) {
      const parentRect = scrollParent.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const stickyOffset = 56;
      if (elRect.top < parentRect.top + stickyOffset) {
        // Element is hidden behind sticky header — scroll it into view
        el.scrollIntoView({ block: 'start', behavior: 'auto' });
        scrollParent.scrollTop -= stickyOffset;
      } else if (elRect.bottom > parentRect.bottom) {
        el.scrollIntoView({ block: 'end', behavior: 'auto' });
      }
    } else {
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown, { capture: true });
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown, { capture: true });
  });

  return {
    focusedResultIndex,
    handleKeydown,
    scrollToFocusedResult,
  };
}
