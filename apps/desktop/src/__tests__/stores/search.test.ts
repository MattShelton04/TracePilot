import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useSearchStore } from '@/stores/search';

// ── Mock @tracepilot/client ────────────────────────────────
const mockSearchContent = vi.fn();
const mockGetSearchStats = vi.fn();
const mockGetSearchFacets = vi.fn();
const mockGetSearchRepositories = vi.fn();
const mockGetSearchToolNames = vi.fn();
const mockRebuildSearchIndex = vi.fn();
const mockFtsIntegrityCheck = vi.fn();
const mockFtsOptimize = vi.fn();
const mockFtsHealth = vi.fn();

vi.mock('@tracepilot/client', () => ({
  searchContent: (...args: unknown[]) => mockSearchContent(...args),
  getSearchStats: (...args: unknown[]) => mockGetSearchStats(...args),
  getSearchFacets: (...args: unknown[]) => mockGetSearchFacets(...args),
  getSearchRepositories: (...args: unknown[]) => mockGetSearchRepositories(...args),
  getSearchToolNames: (...args: unknown[]) => mockGetSearchToolNames(...args),
  rebuildSearchIndex: (...args: unknown[]) => mockRebuildSearchIndex(...args),
  ftsIntegrityCheck: (...args: unknown[]) => mockFtsIntegrityCheck(...args),
  ftsOptimize: (...args: unknown[]) => mockFtsOptimize(...args),
  ftsHealth: (...args: unknown[]) => mockFtsHealth(...args),
}));

// ── Mock Tauri Events ──────────────────────────────────────
vi.mock('@/utils/tauriEvents', () => ({
  safeListen: vi.fn().mockResolvedValue(() => {}),
}));

describe('useSearchStore - browse presets', () => {
  beforeEach(() => {
    setActivePinia(createPinia());

    // Reset all mocks
    mockSearchContent.mockReset();
    mockSearchContent.mockResolvedValue({
      results: [],
      totalCount: 0,
      hasMore: false,
      latencyMs: 10,
    });

    mockGetSearchStats.mockReset();
    mockGetSearchStats.mockResolvedValue({
      totalSessions: 100,
      totalRows: 1000,
      indexSize: 1024 * 1024,
      lastIndexed: new Date().toISOString(),
    });

    mockGetSearchFacets.mockReset();
    mockGetSearchFacets.mockResolvedValue({
      contentTypes: {},
      repositories: {},
      toolNames: {},
    });

    mockGetSearchRepositories.mockResolvedValue([]);
    mockGetSearchToolNames.mockResolvedValue([]);
  });

  describe('basic state changes', () => {
    it('clears query', () => {
      const store = useSearchStore();
      store.query = 'existing query';
      store.browseErrors();
      expect(store.query).toBe('');
    });

    it('clears all filters', () => {
      const store = useSearchStore();
      store.repository = 'some-repo';
      store.toolName = 'some-tool';
      store.dateFrom = '2024-01-01';
      store.dateTo = '2024-12-31';
      store.sessionId = 'session-123';
      store.excludeContentTypes = ['user_message'];

      store.browseErrors();

      expect(store.excludeContentTypes).toEqual([]);
      expect(store.repository).toBeNull();
      expect(store.toolName).toBeNull();
      expect(store.dateFrom).toBeNull();
      expect(store.dateTo).toBeNull();
      expect(store.sessionId).toBeNull();
    });

    it('sets sort to newest', () => {
      const store = useSearchStore();
      store.sortBy = 'relevance';
      store.browseErrors();
      expect(store.sortBy).toBe('newest');
    });

    it('resets to page 1', () => {
      const store = useSearchStore();
      store.page = 5;
      store.browseErrors();
      expect(store.page).toBe(1);
    });
  });

  describe('individual presets', () => {
    it('browseErrors sets error content types', () => {
      const store = useSearchStore();
      store.browseErrors();
      expect(store.contentTypes).toEqual(['error', 'tool_error']);
    });

    it('browseUserMessages sets user_message type', () => {
      const store = useSearchStore();
      store.browseUserMessages();
      expect(store.contentTypes).toEqual(['user_message']);
    });

    it('browseToolCalls sets tool_call type', () => {
      const store = useSearchStore();
      store.browseToolCalls();
      expect(store.contentTypes).toEqual(['tool_call']);
    });

    it('browseReasoning sets reasoning type', () => {
      const store = useSearchStore();
      store.browseReasoning();
      expect(store.contentTypes).toEqual(['reasoning']);
    });

    it('browseToolResults sets tool_result type', () => {
      const store = useSearchStore();
      store.browseToolResults();
      expect(store.contentTypes).toEqual(['tool_result']);
    });

    it('browseSubagents sets subagent type', () => {
      const store = useSearchStore();
      store.browseSubagents();
      expect(store.contentTypes).toEqual(['subagent']);
    });
  });

  describe('async behavior & watcher coalescing', () => {
    it('triggers exactly one search after setting multiple refs', async () => {
      const store = useSearchStore();

      store.browseErrors();

      // Wait for applyBrowsePreset's nextTick AND scheduleSearch's nextTick
      await nextTick();
      await nextTick();

      // Should have called search exactly once
      expect(mockSearchContent).toHaveBeenCalledTimes(1);
    });

    it('coalesces rapid preset changes into final search via scheduleSearch', async () => {
      const store = useSearchStore();

      // Rapidly switch presets (synchronously)
      // Each preset sets multiple refs, triggering watchers
      // scheduleSearch() clears the previous timer and schedules a new nextTick
      // This coalesces all changes into a single search
      store.browseErrors();
      store.browseUserMessages();
      store.browseToolCalls();

      // Wait for all nextTicks to process
      await nextTick();
      await nextTick();

      // Should only execute final search (scheduleSearch coalesces via timer clearing)
      expect(mockSearchContent).toHaveBeenCalledTimes(1);
      // Final state should be from last preset
      expect(store.contentTypes).toEqual(['tool_call']);
    });

    it('executes search immediately (not debounced)', async () => {
      const store = useSearchStore();

      store.browseErrors();

      // Should call immediately after nextTicks (not after 150ms debounce)
      await nextTick();
      await nextTick();
      expect(mockSearchContent).toHaveBeenCalled();
    });

    it('handles preset click while search is in flight', async () => {
      const store = useSearchStore();

      // Start a slow search
      mockSearchContent.mockImplementationOnce(() =>
        new Promise(resolve => setTimeout(() => resolve({
          results: [],
          totalCount: 0,
          hasMore: false,
          latencyMs: 100,
        }), 100))
      );

      store.browseErrors();
      await nextTick();
      await nextTick();
      expect(store.loading).toBe(true);

      // Click another preset while first search is loading
      mockSearchContent.mockResolvedValue({
        results: [],
        totalCount: 0,
        hasMore: false,
        latencyMs: 10,
      });
      store.browseUserMessages();
      await nextTick();
      await nextTick();

      // Wait for all promises
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should have correct final state
      expect(store.contentTypes).toEqual(['user_message']);
      expect(store.loading).toBe(false);
    });
  });

  describe('search execution parameters', () => {
    it('executes search with correct content types', async () => {
      const store = useSearchStore();

      store.browseErrors();
      await nextTick();
      await nextTick();

      expect(mockSearchContent).toHaveBeenCalledWith('', {
        contentTypes: ['error', 'tool_error'],
        excludeContentTypes: undefined,
        repositories: undefined,
        toolNames: undefined,
        sessionId: undefined,
        dateFromUnix: undefined,
        dateToUnix: undefined,
        limit: 50,
        offset: 0,
        sortBy: 'newest',
      });
    });

    it('clears all filters in search call', async () => {
      const store = useSearchStore();
      store.repository = 'my-repo';
      store.toolName = 'bash';
      store.dateFrom = '2024-01-01';
      store.sessionId = 'session-123';

      store.browseErrors();
      await nextTick();
      await nextTick();

      const call = mockSearchContent.mock.calls[0];
      expect(call[0]).toBe(''); // Empty query
      expect(call[1]).toMatchObject({
        contentTypes: ['error', 'tool_error'],
        repositories: undefined,
        toolNames: undefined,
        sessionId: undefined,
        sortBy: 'newest',
      });
    });

    it('resets pagination offset to 0', async () => {
      const store = useSearchStore();
      store.page = 5;

      store.browseErrors();
      await nextTick();
      await nextTick();

      expect(mockSearchContent).toHaveBeenCalledWith('',
        expect.objectContaining({
          offset: 0,  // page 1 = offset 0
        })
      );
    });
  });

  describe('state transitions', () => {
    it('switching between presets updates content types correctly', () => {
      const store = useSearchStore();

      store.browseErrors();
      expect(store.contentTypes).toEqual(['error', 'tool_error']);

      store.browseUserMessages();
      expect(store.contentTypes).toEqual(['user_message']);

      store.browseToolCalls();
      expect(store.contentTypes).toEqual(['tool_call']);
    });

    it('clears previous filters when applying new preset', () => {
      const store = useSearchStore();

      store.repository = 'my-repo';
      store.toolName = 'my-tool';
      store.dateFrom = '2024-01-01';

      store.browseErrors();

      expect(store.repository).toBeNull();
      expect(store.toolName).toBeNull();
      expect(store.dateFrom).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles rapid preset clicks without state corruption', async () => {
      const store = useSearchStore();

      // Simulate 10 rapid clicks
      store.browseErrors();
      store.browseUserMessages();
      store.browseToolCalls();
      store.browseReasoning();
      store.browseToolResults();
      store.browseSubagents();
      store.browseErrors();
      store.browseUserMessages();
      store.browseToolCalls();
      store.browseReasoning(); // Final state

      await nextTick();

      // Should have final preset's state
      expect(store.contentTypes).toEqual(['reasoning']);
      expect(store.query).toBe('');
      expect(store.sortBy).toBe('newest');
      expect(store.page).toBe(1);
    });

    it('converts single type to array internally', () => {
      const store = useSearchStore();
      store.browseUserMessages();

      expect(Array.isArray(store.contentTypes)).toBe(true);
      expect(store.contentTypes).toHaveLength(1);
    });

    it('clears excludeContentTypes consistently', () => {
      const store = useSearchStore();
      store.excludeContentTypes = ['reasoning', 'subagent'];

      store.browseErrors();
      expect(store.excludeContentTypes).toEqual([]);

      store.excludeContentTypes = ['tool_result'];
      store.browseUserMessages();
      expect(store.excludeContentTypes).toEqual([]);
    });
  });

  describe('integration scenarios', () => {
    it('preset followed by manual filter change triggers new search', async () => {
      const store = useSearchStore();

      store.browseErrors();
      await nextTick();
      await nextTick();
      expect(mockSearchContent).toHaveBeenCalledTimes(1);

      mockSearchContent.mockClear();

      // User adds additional filter (will trigger watcher)
      store.repository = 'my-repo';
      await nextTick();
      await nextTick();

      // Should trigger second search with merged filters
      expect(mockSearchContent).toHaveBeenCalledTimes(1);
      expect(mockSearchContent).toHaveBeenCalledWith('',
        expect.objectContaining({
          contentTypes: ['error', 'tool_error'],
          repositories: ['my-repo'],
        })
      );
    });

    it('does not add to recent searches (browse mode has no query)', async () => {
      const store = useSearchStore();

      const initialCount = store.recentSearches.length;

      store.browseErrors();
      await nextTick();
      await nextTick();

      expect(store.recentSearches).toHaveLength(initialCount);
    });

    it('updates isBrowseMode computed correctly', () => {
      const store = useSearchStore();
      store.query = 'some query';
      expect(store.isBrowseMode).toBe(false);

      store.browseErrors();
      expect(store.isBrowseMode).toBe(true);
    });
  });
});
