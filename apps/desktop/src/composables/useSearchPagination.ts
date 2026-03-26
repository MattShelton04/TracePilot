import { computed } from 'vue';
import type { Ref, ComputedRef } from 'vue';

export interface UseSearchPaginationOptions {
  /** Current page number (1-based). */
  page: Ref<number> | ComputedRef<number>;
  /** Number of results per page. */
  pageSize: Ref<number> | ComputedRef<number>;
  /** Total number of results across all pages. */
  totalCount: Ref<number> | ComputedRef<number>;
  /** Total number of pages. */
  totalPages: Ref<number> | ComputedRef<number>;
}

/**
 * Composable for search pagination display logic.
 *
 * Computes the visible page numbers (with ellipsis gaps), start/end indices
 * for the current page, suitable for rendering a pagination bar.
 *
 * Pure computation — no lifecycle hooks or side effects.
 */
export function useSearchPagination(options: UseSearchPaginationOptions) {
  const { page, pageSize, totalCount, totalPages } = options;

  /** 1-based index of the first result on the current page. */
  const pageStart = computed(() => (page.value - 1) * pageSize.value + 1);

  /** 1-based index of the last result on the current page. */
  const pageEnd = computed(() => Math.min(page.value * pageSize.value, totalCount.value));

  /**
   * Smart page number array for rendering pagination controls.
   *
   * Always includes first and last pages. Inserts `null` for ellipsis gaps
   * when there are more than 7 total pages and the current page is far
   * from the boundaries.
   *
   * Examples:
   * - 5 pages, current 3:  [1, 2, 3, 4, 5]
   * - 10 pages, current 1: [1, 2, null, 10]
   * - 10 pages, current 5: [1, null, 4, 5, 6, null, 10]
   * - 10 pages, current 10: [1, null, 9, 10]
   */
  const visiblePages = computed<(number | null)[]>(() => {
    const total = totalPages.value;
    const current = page.value;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages: (number | null)[] = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    if (start > 2) pages.push(null);
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < total - 1) pages.push(null);
    pages.push(total);
    return pages;
  });

  return { pageStart, pageEnd, visiblePages };
}
