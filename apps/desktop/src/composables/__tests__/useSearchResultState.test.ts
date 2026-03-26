import { describe, it, expect, vi } from 'vitest';
import { ref, computed, nextTick } from 'vue';
import { useSearchResultState } from '../useSearchResultState';
import type { UseSearchResultStateOptions } from '../useSearchResultState';

function createOptions(overrides?: Partial<UseSearchResultStateOptions>) {
  return {
    sessionId: ref<string | null>(null),
    results: computed(() => [] as { sessionId: string; sessionSummary: string | null }[]),
    groupedResults: computed(() => [] as { sessionId: string; sessionSummary: string | null }[]),
    resultViewMode: ref<'flat' | 'grouped'>('flat'),
    ...overrides,
  };
}

describe('useSearchResultState', () => {
  describe('expandedResults', () => {
    it('starts empty', () => {
      const state = useSearchResultState(createOptions());
      expect(state.expandedResults.value.size).toBe(0);
    });

    it('toggleExpand adds and removes result IDs', () => {
      const state = useSearchResultState(createOptions());

      state.toggleExpand(1);
      expect(state.expandedResults.value.has(1)).toBe(true);

      state.toggleExpand(1);
      expect(state.expandedResults.value.has(1)).toBe(false);
    });

    it('can track multiple expanded results', () => {
      const state = useSearchResultState(createOptions());

      state.toggleExpand(1);
      state.toggleExpand(3);
      state.toggleExpand(5);

      expect(state.expandedResults.value.has(1)).toBe(true);
      expect(state.expandedResults.value.has(2)).toBe(false);
      expect(state.expandedResults.value.has(3)).toBe(true);
      expect(state.expandedResults.value.has(5)).toBe(true);
    });
  });

  describe('collapsedGroups', () => {
    it('starts empty', () => {
      const state = useSearchResultState(createOptions());
      expect(state.collapsedGroups.value.size).toBe(0);
    });

    it('toggleGroupCollapse adds and removes session IDs', () => {
      const state = useSearchResultState(createOptions());

      state.toggleGroupCollapse('session-a');
      expect(state.collapsedGroups.value.has('session-a')).toBe(true);

      state.toggleGroupCollapse('session-a');
      expect(state.collapsedGroups.value.has('session-a')).toBe(false);
    });
  });

  describe('sessionDisplayName', () => {
    it('returns null when no sessionId is set', () => {
      const state = useSearchResultState(createOptions());
      expect(state.sessionDisplayName.value).toBeNull();
    });

    it('uses filteredSessionNameOverride when available', () => {
      const sessionId = ref<string | null>('abc-123');
      const state = useSearchResultState(createOptions({ sessionId }));

      state.filteredSessionNameOverride.value = 'My Session';
      expect(state.sessionDisplayName.value).toBe('My Session');
    });

    it('resolves from results when no override', () => {
      const sessionId = ref<string | null>('abc-123');
      const results = computed(() => [
        { sessionId: 'abc-123', sessionSummary: 'Found Session' },
      ]);
      const state = useSearchResultState(createOptions({ sessionId, results }));
      expect(state.sessionDisplayName.value).toBe('Found Session');
    });

    it('resolves from groupedResults when not in results', () => {
      const sessionId = ref<string | null>('abc-123');
      const results = computed(() => [] as { sessionId: string; sessionSummary: string | null }[]);
      const groupedResults = computed(() => [
        { sessionId: 'abc-123', sessionSummary: 'Grouped Session' },
      ]);
      const state = useSearchResultState(createOptions({ sessionId, results, groupedResults }));
      expect(state.sessionDisplayName.value).toBe('Grouped Session');
    });

    it('falls back to truncated ID', () => {
      const sessionId = ref<string | null>('abc-123-456-789-long-session-id');
      const state = useSearchResultState(createOptions({ sessionId }));
      expect(state.sessionDisplayName.value).toBe('abc-123-456-…');
    });
  });

  describe('filterBySession', () => {
    it('sets sessionId, override, and switches to flat mode', () => {
      const sessionId = ref<string | null>(null);
      const resultViewMode = ref<'flat' | 'grouped'>('grouped');
      const state = useSearchResultState(createOptions({ sessionId, resultViewMode }));

      state.filterBySession('session-x', 'My Session X');

      expect(sessionId.value).toBe('session-x');
      expect(state.filteredSessionNameOverride.value).toBe('My Session X');
      expect(resultViewMode.value).toBe('flat');
    });

    it('uses null override when displayName is null', () => {
      const sessionId = ref<string | null>(null);
      const state = useSearchResultState(createOptions({ sessionId }));

      state.filterBySession('session-x', null);

      expect(sessionId.value).toBe('session-x');
      expect(state.filteredSessionNameOverride.value).toBeNull();
    });
  });

  describe('filteredSessionNameOverride clearing', () => {
    it('clears override when sessionId is set to null externally', async () => {
      const sessionId = ref<string | null>('abc');
      const state = useSearchResultState(createOptions({ sessionId }));

      state.filteredSessionNameOverride.value = 'Override Name';
      expect(state.filteredSessionNameOverride.value).toBe('Override Name');

      sessionId.value = null;
      await nextTick();
      expect(state.filteredSessionNameOverride.value).toBeNull();
    });

    it('preserves override when sessionId changes to another value', async () => {
      const sessionId = ref<string | null>('abc');
      const state = useSearchResultState(createOptions({ sessionId }));

      state.filteredSessionNameOverride.value = 'Override Name';
      sessionId.value = 'xyz';
      await nextTick();
      // Override is only cleared when sessionId becomes null
      expect(state.filteredSessionNameOverride.value).toBe('Override Name');
    });
  });
});
