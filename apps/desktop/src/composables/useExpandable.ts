import { ref, type Ref } from 'vue';

export interface UseExpandableReturn<T> {
  expanded: Ref<Set<T>>;
  toggle: (id: T) => void;
  collapse: (id: T) => void;
  expand: (id: T) => void;
  collapseAll: () => void;
  expandAll: (ids: T[]) => void;
  isExpanded: (id: T) => boolean;
}

/**
 * Generic composable for managing expandable/collapsible UI elements.
 *
 * This composable manages a Set of expanded item IDs and provides utilities
 * for toggling, expanding, and collapsing items. It's generic and can work
 * with any ID type (number, string, etc.).
 *
 * @template T - The type of IDs (defaults to number | string)
 * @returns Object with expanded Set and manipulation functions
 *
 * @example
 * ```typescript
 * // For result cards (number IDs)
 * const {
 *   expanded: expandedResults,
 *   toggle: toggleExpand,
 *   isExpanded
 * } = useExpandable<number>();
 *
 * toggleExpand(123); // Toggle result card 123
 * console.log(isExpanded(123)); // true
 *
 * // For session groups (string IDs)
 * const {
 *   expanded: collapsedGroups,
 *   toggle: toggleCollapse
 * } = useExpandable<string>();
 *
 * toggleCollapse('session-abc-123'); // Toggle session group
 * ```
 */
export function useExpandable<T = number | string>(): UseExpandableReturn<T> {
  const expanded = ref<Set<T>>(new Set());

  /**
   * Toggle an item's expanded state
   */
  function toggle(id: T) {
    const newSet = new Set(expanded.value);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    expanded.value = newSet;
  }

  /**
   * Collapse a specific item (remove from expanded set)
   */
  function collapse(id: T) {
    if (expanded.value.has(id)) {
      const newSet = new Set(expanded.value);
      newSet.delete(id);
      expanded.value = newSet;
    }
  }

  /**
   * Expand a specific item (add to expanded set)
   */
  function expand(id: T) {
    if (!expanded.value.has(id)) {
      const newSet = new Set(expanded.value);
      newSet.add(id);
      expanded.value = newSet;
    }
  }

  /**
   * Collapse all items (clear expanded set)
   */
  function collapseAll() {
    expanded.value = new Set();
  }

  /**
   * Expand all specified items
   */
  function expandAll(ids: T[]) {
    expanded.value = new Set(ids);
  }

  /**
   * Check if an item is expanded
   */
  function isExpanded(id: T): boolean {
    return expanded.value.has(id);
  }

  return {
    expanded: expanded as Ref<Set<T>>,
    toggle,
    collapse,
    expand,
    collapseAll,
    expandAll,
    isExpanded,
  };
}
