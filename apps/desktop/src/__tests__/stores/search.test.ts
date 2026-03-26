import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useSearchStore, type BrowsePreset } from '@/stores/search';

// ── Mocks ────────────────────────────────────────────────────
const mockSearchContent = vi.fn();
const mockGetSearchFacets = vi.fn();
const mockGetSearchStats = vi.fn();

vi.mock('@tracepilot/client', () => ({
  searchContent: (...args: unknown[]) => mockSearchContent(...args),
  getSearchFacets: (...args: unknown[]) => mockGetSearchFacets(...args),
  getSearchStats: (...args: unknown[]) => mockGetSearchStats(...args),
  getSearchRepositories: () => Promise.resolve([]),
  getSearchToolNames: () => Promise.resolve([]),
  rebuildSearchIndex: () => Promise.resolve(),
  ftsIntegrityCheck: () => Promise.resolve('OK'),
  ftsOptimize: () => Promise.resolve('OK'),
  ftsHealth: () => Promise.resolve(null),
}));

vi.mock('@/utils/tauriEvents', () => ({
  safeListen: vi.fn(() => Promise.resolve(() => {})),
}));

// ── Fixtures ─────────────────────────────────────────────────
const MOCK_SEARCH_RESPONSE = {
  results: [],
  totalCount: 0,
  hasMore: false,
  latencyMs: 10,
};

const MOCK_FACETS = {
  byContentType: [],
  byRepository: [],
  byToolName: [],
  totalMatches: 0,
  sessionCount: 0,
};

describe('Browse Presets', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockSearchContent.mockResolvedValue(MOCK_SEARCH_RESPONSE);
    mockGetSearchFacets.mockResolvedValue(MOCK_FACETS);
    mockGetSearchStats.mockResolvedValue({
      totalRows: 0,
      indexedSessions: 0,
      totalSessions: 0,
      contentTypeCounts: [],
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('applyBrowsePreset', () => {
    it('should apply errors preset with all correct state', () => {
      const store = useSearchStore();
      store.applyBrowsePreset('errors');

      expect(store.query).toBe('');
      expect(store.contentTypes).toEqual(['error', 'tool_error']);
      expect(store.excludeContentTypes).toEqual([]);
      expect(store.repository).toBeNull();
      expect(store.toolName).toBeNull();
      expect(store.dateFrom).toBeNull();
      expect(store.dateTo).toBeNull();
      expect(store.sessionId).toBeNull();
      expect(store.sortBy).toBe('newest');
      expect(store.page).toBe(1);
    });

    it('should clear existing filters when applying preset', () => {
      const store = useSearchStore();
      store.query = 'existing query';
      store.repository = 'myrepo';
      store.dateFrom = '2024-01-01';
      store.excludeContentTypes = ['system_message'];
      store.page = 5;

      store.applyBrowsePreset('errors');

      expect(store.query).toBe('');
      expect(store.repository).toBeNull();
      expect(store.dateFrom).toBeNull();
      expect(store.excludeContentTypes).toEqual([]);
      expect(store.page).toBe(1);
    });

    it('should reset page to 1 when applying preset (bug fix)', () => {
      const store = useSearchStore();
      store.page = 10;

      store.applyBrowsePreset('errors');

      expect(store.page).toBe(1);
    });

    it('should trigger exactly ONE search after preset application', async () => {
      const store = useSearchStore();

      store.applyBrowsePreset('errors');
      await nextTick();
      await vi.waitFor(() => expect(mockSearchContent).toHaveBeenCalled(), { timeout: 1000 });

      expect(mockSearchContent).toHaveBeenCalledTimes(1);
    });

    it('should handle rapid preset switching without race conditions', async () => {
      const store = useSearchStore();

      store.applyBrowsePreset('errors');
      store.applyBrowsePreset('userMessages');
      store.applyBrowsePreset('toolCalls');

      await nextTick();
      await vi.waitFor(() => expect(mockSearchContent).toHaveBeenCalled(), { timeout: 1000 });

      // Should only execute final preset
      expect(store.contentTypes).toEqual(['tool_call']);
      expect(mockSearchContent).toHaveBeenCalledTimes(1);
    });

    it('should be idempotent when applying same preset twice', () => {
      const store = useSearchStore();

      store.applyBrowsePreset('errors');
      const state1 = {
        query: store.query,
        contentTypes: [...store.contentTypes],
        repository: store.repository,
        sortBy: store.sortBy,
        page: store.page,
      };

      store.applyBrowsePreset('errors');
      const state2 = {
        query: store.query,
        contentTypes: [...store.contentTypes],
        repository: store.repository,
        sortBy: store.sortBy,
        page: store.page,
      };

      expect(state1).toEqual(state2);
    });

    it('should not mutate config arrays', () => {
      const store = useSearchStore();

      store.applyBrowsePreset('errors');
      store.contentTypes.push('user_message' as any);

      // Apply again and verify original config is unchanged
      store.applyBrowsePreset('errors');
      expect(store.contentTypes).toEqual(['error', 'tool_error']);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain all 6 wrapper functions', () => {
      const store = useSearchStore();

      expect(typeof store.browseErrors).toBe('function');
      expect(typeof store.browseUserMessages).toBe('function');
      expect(typeof store.browseToolCalls).toBe('function');
      expect(typeof store.browseReasoning).toBe('function');
      expect(typeof store.browseToolResults).toBe('function');
      expect(typeof store.browseSubagents).toBe('function');
    });

    it('should produce identical results with wrapper functions', () => {
      const store = useSearchStore();

      store.browseErrors();
      expect(store.contentTypes).toEqual(['error', 'tool_error']);
      expect(store.sortBy).toBe('newest');
      expect(store.page).toBe(1);
    });

    it('should maintain correct signatures for all wrapper functions', () => {
      const store = useSearchStore();

      // Should be callable with no arguments
      expect(() => store.browseErrors()).not.toThrow();
      expect(() => store.browseUserMessages()).not.toThrow();
      expect(() => store.browseToolCalls()).not.toThrow();
      expect(() => store.browseReasoning()).not.toThrow();
      expect(() => store.browseToolResults()).not.toThrow();
      expect(() => store.browseSubagents()).not.toThrow();
    });
  });

  describe('All Presets', () => {
    const presetTests = [
      { preset: 'errors' as BrowsePreset, types: ['error', 'tool_error'] },
      { preset: 'userMessages' as BrowsePreset, types: ['user_message'] },
      { preset: 'toolCalls' as BrowsePreset, types: ['tool_call'] },
      { preset: 'reasoning' as BrowsePreset, types: ['reasoning'] },
      { preset: 'toolResults' as BrowsePreset, types: ['tool_result'] },
      { preset: 'subagents' as BrowsePreset, types: ['subagent'] },
    ];

    for (const { preset, types } of presetTests) {
      it(`should apply ${preset} preset correctly`, () => {
        const store = useSearchStore();
        store.applyBrowsePreset(preset);
        expect(store.contentTypes).toEqual(types);
        expect(store.sortBy).toBe('newest');
        expect(store.page).toBe(1);
        expect(store.query).toBe('');
        expect(store.repository).toBeNull();
        expect(store.toolName).toBeNull();
      });
    }
  });

  describe('State Transitions', () => {
    it('should fully reset state when switching between presets', () => {
      const store = useSearchStore();

      store.applyBrowsePreset('errors');
      store.repository = 'my-repo'; // Manually add filter

      store.applyBrowsePreset('toolCalls');

      expect(store.repository).toBeNull(); // Should be cleared
      expect(store.contentTypes).toEqual(['tool_call']);
    });

    it('should clear all date filters when applying preset', () => {
      const store = useSearchStore();

      store.dateFrom = '2024-01-01';
      store.dateTo = '2024-12-31';

      store.applyBrowsePreset('errors');

      expect(store.dateFrom).toBeNull();
      expect(store.dateTo).toBeNull();
    });

    it('should clear session filter when applying preset', () => {
      const store = useSearchStore();

      store.sessionId = 'session-123';

      store.applyBrowsePreset('errors');

      expect(store.sessionId).toBeNull();
    });

    it('should clear exclude filters when applying preset', () => {
      const store = useSearchStore();

      store.excludeContentTypes = ['system_message'];

      store.applyBrowsePreset('errors');

      expect(store.excludeContentTypes).toEqual([]);
    });
  });

  describe('Search Execution', () => {
    it('should use newest sort in browse mode', async () => {
      const store = useSearchStore();

      store.applyBrowsePreset('errors');
      await nextTick();
      await vi.waitFor(() => expect(mockSearchContent).toHaveBeenCalled(), { timeout: 1000 });

      expect(mockSearchContent).toHaveBeenCalledWith(
        '', // Empty query in browse mode
        expect.objectContaining({
          contentTypes: ['error', 'tool_error'],
          sortBy: 'newest',
        })
      );
    });

    it('should fetch facets with correct filters after preset', async () => {
      const store = useSearchStore();

      store.applyBrowsePreset('errors');
      await nextTick();
      await vi.waitFor(() => expect(mockGetSearchFacets).toHaveBeenCalled(), { timeout: 1000 });

      expect(mockGetSearchFacets).toHaveBeenCalledWith(
        undefined, // Empty query
        expect.objectContaining({
          contentTypes: ['error', 'tool_error'],
        })
      );
    });
  });
});
