import type { ComputedRef, Ref } from "vue";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { shouldIgnoreGlobalShortcut } from "@/utils/keyboardShortcuts";

/** A visible `aria-modal` dialog (syntax guide, "?" help...) is open over the results. */
function hasOpenModal(): boolean {
  return [...document.querySelectorAll('[aria-modal="true"]')].some((dialog) => {
    if (dialog.closest("[hidden], [inert]")) return false;
    for (let node: Element | null = dialog; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  });
}

export interface UseSearchKeyboardNavigationOptions {
  /** Ref to the search input element for focus/blur management. */
  searchInputRef: Ref<HTMLInputElement | null>;
  /** Flat list of search results; `focusedResultIndex` indexes into it. */
  results: ComputedRef<{ id: number }[]> | Ref<{ id: number }[]>;
  /**
   * Ids of the results on screen, top to bottom, leaving out hidden ones (such
   * as those in a collapsed group). ↓/↑ walk this order; defaults to `results`.
   */
  visibleIds?: ComputedRef<number[]> | Ref<number[]>;
  /** Whether the search store currently has a query. */
  hasQuery: ComputedRef<boolean> | Ref<boolean>;
  /** Called when Escape is pressed with no focused result and a query is active. */
  onClearAll: () => void;
  /** Called when Enter is pressed on a focused result. */
  onToggleExpand: (id: number) => void;
  /** Called when Ctrl/Cmd+Enter is pressed on a focused result. */
  onOpen?: (id: number) => void;
}

/**
 * Composable for keyboard navigation in the search results view.
 *
 * Supports:
 * - Ctrl/Cmd+K: Focus the search input
 * - ↓ / j: Move focus down through results
 * - ↑ / k: Move focus up through results
 * - Enter: Toggle expand on focused result
 * - Ctrl/Cmd+Enter: Open the focused result (never from the search input)
 * - Escape: Unfocus result → focus search input, or clear search
 *
 * Registers a global keydown listener on mount and removes it on unmount.
 */
export function useSearchKeyboardNavigation(options: UseSearchKeyboardNavigationOptions) {
  const { searchInputRef, results, visibleIds, hasQuery, onClearAll, onToggleExpand, onOpen } =
    options;

  /** Index of the currently focused result (-1 = none). */
  const focusedResultIndex = ref(-1);

  // Reset focus when results change (e.g. new search, page change, different results same length)
  watch(
    () => results.value,
    () => {
      focusedResultIndex.value = -1;
    },
  );

  /** Move the cursor to a result, e.g. one the user clicked. */
  function focusResult(id: number) {
    focusedResultIndex.value = results.value.findIndex((r) => r.id === id);
  }

  /**
   * Step through the results in on-screen order; false when none is on
   * screen. Stepping up from the first result leaves the results.
   */
  function step(delta: 1 | -1): boolean {
    const order = visibleIds?.value ?? results.value.map((r) => r.id);
    if (order.length === 0) return false;
    const currentId = results.value[focusedResultIndex.value]?.id;
    const at = currentId === undefined ? -1 : order.indexOf(currentId);
    const next = Math.min(at + delta, order.length - 1);
    if (next < 0) focusedResultIndex.value = -1;
    else focusResult(order[next]);
    return true;
  }

  function handleKeydown(e: KeyboardEvent) {
    // Ctrl+K: focus search input (global)
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      e.stopImmediatePropagation();
      searchInputRef.value?.focus();
      searchInputRef.value?.select();
      return;
    }

    // This capture-phase listener runs before any dialog's own handlers, so it
    // must leave Escape, j/k, arrows and Enter to a modal opened on top.
    if (hasOpenModal()) return;

    const isSearchInput = e.target === searchInputRef.value;
    const withModifier = e.ctrlKey || e.metaKey;

    // From search input: allow arrow keys to navigate into results,
    // and Enter/Esc when a result is already focused
    if (isSearchInput) {
      const isArrow = e.key === "ArrowDown" || e.key === "ArrowUp";
      // Ctrl/Cmd+Enter while typing belongs to the input, not to the results.
      const isEnterOnFocused = e.key === "Enter" && !withModifier && focusedResultIndex.value >= 0;
      const isEscOnFocused = e.key === "Escape" && focusedResultIndex.value >= 0;
      if (!isArrow && !isEnterOnFocused && !isEscOnFocused) return;
    }

    if (!isSearchInput && shouldIgnoreGlobalShortcut(e)) return;
    // Native controls keep their own Enter/Space and arrow-key behavior even
    // when a result is still highlighted from earlier keyboard navigation.
    if (
      !isSearchInput &&
      e.target instanceof Element &&
      e.target.closest('button, a[href], [role="button"], [role="link"]')
    )
      return;

    const resultCount = results.value.length;
    if (resultCount === 0) return;

    switch (e.key) {
      case "ArrowDown":
      case "j":
        e.preventDefault();
        if (!step(1)) break;
        if (isSearchInput) searchInputRef.value?.blur();
        scrollToFocusedResult();
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        if (!step(-1)) break;
        if (isSearchInput && focusedResultIndex.value >= 0) searchInputRef.value?.blur();
        scrollToFocusedResult();
        break;
      case "Enter": {
        const result = results.value[focusedResultIndex.value];
        if (!result) break;
        if (withModifier) {
          if (!onOpen) break;
          e.preventDefault();
          onOpen(result.id);
        } else {
          e.preventDefault();
          onToggleExpand(result.id);
        }
        break;
      }
      case "Escape":
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
    const scrollParent = el.closest(".search-main-scroll");
    if (scrollParent) {
      const parentRect = scrollParent.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const stickyOffset = 56;
      if (elRect.top < parentRect.top + stickyOffset) {
        // Element is hidden behind sticky header — scroll it into view
        el.scrollIntoView({ block: "start", behavior: "auto" });
        scrollParent.scrollTop -= stickyOffset;
      } else if (elRect.bottom > parentRect.bottom) {
        el.scrollIntoView({ block: "end", behavior: "auto" });
      }
    } else {
      el.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }

  onMounted(() => {
    window.addEventListener("keydown", handleKeydown, { capture: true });
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", handleKeydown, { capture: true });
  });

  return {
    focusedResultIndex,
    focusResult,
    handleKeydown,
    scrollToFocusedResult,
  };
}
