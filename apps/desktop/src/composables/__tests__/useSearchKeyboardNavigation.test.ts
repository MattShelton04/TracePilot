import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed, nextTick } from 'vue';

// Mock lifecycle hooks outside of components
vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return {
    ...actual,
    onMounted: vi.fn((fn: () => void) => fn()),
    onUnmounted: vi.fn(),
  };
});

// Mock the keyboard shortcuts utility
vi.mock('@/utils/keyboardShortcuts', () => ({
  shouldIgnoreGlobalShortcut: vi.fn(() => false),
}));

import { useSearchKeyboardNavigation } from '../useSearchKeyboardNavigation';
import type { UseSearchKeyboardNavigationOptions } from '../useSearchKeyboardNavigation';

function createMockResults(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1 }));
}

function createOptions(overrides?: Partial<UseSearchKeyboardNavigationOptions>) {
  const results = ref(createMockResults(5));
  // Provide a mock input element so isSearchInput checks work correctly
  // (prevents null === null being true when e.target is null)
  const mockInput = document.createElement('input');
  return {
    searchInputRef: ref(mockInput) as UseSearchKeyboardNavigationOptions['searchInputRef'],
    results: computed(() => results.value),
    hasQuery: computed(() => true),
    onClearAll: vi.fn(),
    onToggleExpand: vi.fn(),
    _resultsRef: results, // exposed for test mutation
    ...overrides,
  };
}

function fireKey(key: string, extra: Partial<KeyboardEventInit> = {}) {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
}

describe('useSearchKeyboardNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('focusedResultIndex', () => {
    it('starts at -1', () => {
      const result = useSearchKeyboardNavigation(createOptions());
      expect(result.focusedResultIndex.value).toBe(-1);
    });

    it('resets to -1 when results change', async () => {
      const opts = createOptions();
      const result = useSearchKeyboardNavigation(opts);

      // Move focus down
      result.handleKeydown(fireKey('ArrowDown'));
      expect(result.focusedResultIndex.value).toBe(0);

      // Change results
      opts._resultsRef.value = createMockResults(3);
      await nextTick();
      expect(result.focusedResultIndex.value).toBe(-1);
    });
  });

  describe('ArrowDown / j navigation', () => {
    it('moves focus down with ArrowDown', () => {
      const result = useSearchKeyboardNavigation(createOptions());

      result.handleKeydown(fireKey('ArrowDown'));
      expect(result.focusedResultIndex.value).toBe(0);

      result.handleKeydown(fireKey('ArrowDown'));
      expect(result.focusedResultIndex.value).toBe(1);
    });

    it('moves focus down with j', () => {
      const result = useSearchKeyboardNavigation(createOptions());

      result.handleKeydown(fireKey('j'));
      expect(result.focusedResultIndex.value).toBe(0);
    });

    it('clamps at last result', () => {
      const opts = createOptions();
      opts._resultsRef.value = createMockResults(2);
      const result = useSearchKeyboardNavigation(opts);

      result.handleKeydown(fireKey('ArrowDown'));
      result.handleKeydown(fireKey('ArrowDown'));
      result.handleKeydown(fireKey('ArrowDown'));
      expect(result.focusedResultIndex.value).toBe(1);
    });
  });

  describe('ArrowUp / k navigation', () => {
    it('moves focus up with ArrowUp', () => {
      const result = useSearchKeyboardNavigation(createOptions());

      result.handleKeydown(fireKey('ArrowDown'));
      result.handleKeydown(fireKey('ArrowDown'));
      result.handleKeydown(fireKey('ArrowUp'));
      expect(result.focusedResultIndex.value).toBe(0);
    });

    it('moves focus up with k', () => {
      const result = useSearchKeyboardNavigation(createOptions());

      result.handleKeydown(fireKey('ArrowDown'));
      result.handleKeydown(fireKey('ArrowDown'));
      result.handleKeydown(fireKey('k'));
      expect(result.focusedResultIndex.value).toBe(0);
    });

    it('does not go below -1', () => {
      const result = useSearchKeyboardNavigation(createOptions());

      result.handleKeydown(fireKey('ArrowUp'));
      expect(result.focusedResultIndex.value).toBe(-1);
    });
  });

  describe('Enter key', () => {
    it('toggles expand on focused result', () => {
      const opts = createOptions();
      const result = useSearchKeyboardNavigation(opts);

      result.handleKeydown(fireKey('ArrowDown'));
      result.handleKeydown(fireKey('Enter'));

      expect(opts.onToggleExpand).toHaveBeenCalledWith(1);
    });

    it('does nothing when no result is focused', () => {
      const opts = createOptions();
      const result = useSearchKeyboardNavigation(opts);

      result.handleKeydown(fireKey('Enter'));
      expect(opts.onToggleExpand).not.toHaveBeenCalled();
    });
  });

  describe('Escape key', () => {
    it('resets focus and does not clear when a result is focused', () => {
      const opts = createOptions();
      const result = useSearchKeyboardNavigation(opts);

      result.handleKeydown(fireKey('ArrowDown'));
      expect(result.focusedResultIndex.value).toBe(0);

      result.handleKeydown(fireKey('Escape'));
      expect(result.focusedResultIndex.value).toBe(-1);
      expect(opts.onClearAll).not.toHaveBeenCalled();
    });

    it('calls onClearAll when no result is focused and hasQuery', () => {
      const opts = createOptions();
      const result = useSearchKeyboardNavigation(opts);

      result.handleKeydown(fireKey('Escape'));
      expect(opts.onClearAll).toHaveBeenCalled();
    });

    it('does not call onClearAll when no result is focused and no query', () => {
      const opts = createOptions({ hasQuery: computed(() => false) });
      const result = useSearchKeyboardNavigation(opts);

      result.handleKeydown(fireKey('Escape'));
      expect(opts.onClearAll).not.toHaveBeenCalled();
    });
  });

  describe('Ctrl+K / Cmd+K', () => {
    it('focuses and selects search input with Ctrl+K', () => {
      const focusFn = vi.fn();
      const selectFn = vi.fn();
      const mockInput = { focus: focusFn, select: selectFn } as unknown as HTMLInputElement;
      const opts = createOptions({ searchInputRef: ref(mockInput) });
      const result = useSearchKeyboardNavigation(opts);

      result.handleKeydown(fireKey('k', { ctrlKey: true }));
      expect(focusFn).toHaveBeenCalled();
      expect(selectFn).toHaveBeenCalled();
    });

    it('focuses and selects search input with Cmd+K (macOS)', () => {
      const focusFn = vi.fn();
      const selectFn = vi.fn();
      const mockInput = { focus: focusFn, select: selectFn } as unknown as HTMLInputElement;
      const opts = createOptions({ searchInputRef: ref(mockInput) });
      const result = useSearchKeyboardNavigation(opts);

      result.handleKeydown(fireKey('k', { metaKey: true }));
      expect(focusFn).toHaveBeenCalled();
      expect(selectFn).toHaveBeenCalled();
    });
  });

  describe('empty results', () => {
    it('does nothing when there are no results', () => {
      const opts = createOptions();
      opts._resultsRef.value = [];
      const result = useSearchKeyboardNavigation(opts);

      result.handleKeydown(fireKey('ArrowDown'));
      expect(result.focusedResultIndex.value).toBe(-1);
    });
  });
});
