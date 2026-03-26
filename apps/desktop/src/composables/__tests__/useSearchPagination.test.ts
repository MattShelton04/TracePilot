import { describe, it, expect } from 'vitest';
import { ref, computed } from 'vue';
import { useSearchPagination } from '../useSearchPagination';

function setup(page: number, pageSize: number, totalCount: number, totalPages: number) {
  return useSearchPagination({
    page: ref(page),
    pageSize: ref(pageSize),
    totalCount: ref(totalCount),
    totalPages: ref(totalPages),
  });
}

describe('useSearchPagination', () => {
  describe('pageStart', () => {
    it('returns 1 for the first page', () => {
      const { pageStart } = setup(1, 50, 200, 4);
      expect(pageStart.value).toBe(1);
    });

    it('returns correct offset for page 2', () => {
      const { pageStart } = setup(2, 50, 200, 4);
      expect(pageStart.value).toBe(51);
    });

    it('returns correct offset for page 3 with pageSize 20', () => {
      const { pageStart } = setup(3, 20, 100, 5);
      expect(pageStart.value).toBe(41);
    });
  });

  describe('pageEnd', () => {
    it('returns pageSize for the first full page', () => {
      const { pageEnd } = setup(1, 50, 200, 4);
      expect(pageEnd.value).toBe(50);
    });

    it('returns totalCount for the last partial page', () => {
      const { pageEnd } = setup(3, 50, 120, 3);
      expect(pageEnd.value).toBe(120);
    });

    it('returns correct value for a middle page', () => {
      const { pageEnd } = setup(2, 50, 200, 4);
      expect(pageEnd.value).toBe(100);
    });
  });

  describe('visiblePages', () => {
    it('returns all pages when total <= 7', () => {
      const { visiblePages } = setup(1, 50, 50, 1);
      expect(visiblePages.value).toEqual([1]);
    });

    it('returns all pages for exactly 7 pages', () => {
      const { visiblePages } = setup(4, 50, 350, 7);
      expect(visiblePages.value).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('returns all pages for 5 pages', () => {
      const { visiblePages } = setup(3, 50, 250, 5);
      expect(visiblePages.value).toEqual([1, 2, 3, 4, 5]);
    });

    it('shows ellipsis for 10 pages with current at 1', () => {
      const { visiblePages } = setup(1, 50, 500, 10);
      expect(visiblePages.value).toEqual([1, 2, null, 10]);
    });

    it('shows ellipsis for 10 pages with current at 2', () => {
      const { visiblePages } = setup(2, 50, 500, 10);
      expect(visiblePages.value).toEqual([1, 2, 3, null, 10]);
    });

    it('shows double ellipsis for 10 pages with current in middle', () => {
      const { visiblePages } = setup(5, 50, 500, 10);
      expect(visiblePages.value).toEqual([1, null, 4, 5, 6, null, 10]);
    });

    it('shows ellipsis for 10 pages with current at last', () => {
      const { visiblePages } = setup(10, 50, 500, 10);
      expect(visiblePages.value).toEqual([1, null, 9, 10]);
    });

    it('shows correct pages for 10 pages with current at 9', () => {
      const { visiblePages } = setup(9, 50, 500, 10);
      expect(visiblePages.value).toEqual([1, null, 8, 9, 10]);
    });

    it('handles 100 pages with current at 50', () => {
      const { visiblePages } = setup(50, 50, 5000, 100);
      expect(visiblePages.value).toEqual([1, null, 49, 50, 51, null, 100]);
    });

    it('handles 8 pages (just over threshold) with current at 1', () => {
      const { visiblePages } = setup(1, 50, 400, 8);
      expect(visiblePages.value).toEqual([1, 2, null, 8]);
    });

    it('handles 0 total pages', () => {
      const { visiblePages } = setup(1, 50, 0, 0);
      expect(visiblePages.value).toEqual([]);
    });

    it('reacts to ref changes', () => {
      const page = ref(1);
      const totalPages = ref(10);
      const { visiblePages } = useSearchPagination({
        page,
        pageSize: ref(50),
        totalCount: ref(500),
        totalPages,
      });

      expect(visiblePages.value).toEqual([1, 2, null, 10]);

      page.value = 5;
      expect(visiblePages.value).toEqual([1, null, 4, 5, 6, null, 10]);

      page.value = 10;
      expect(visiblePages.value).toEqual([1, null, 9, 10]);
    });

    it('works with computed refs', () => {
      const page = ref(5);
      const pageSize = ref(50);
      const totalCount = ref(500);
      const totalPages = computed(() => Math.ceil(totalCount.value / pageSize.value));

      const { visiblePages, pageStart, pageEnd } = useSearchPagination({
        page,
        pageSize,
        totalCount,
        totalPages,
      });

      expect(visiblePages.value).toEqual([1, null, 4, 5, 6, null, 10]);
      expect(pageStart.value).toBe(201);
      expect(pageEnd.value).toBe(250);
    });
  });
});
