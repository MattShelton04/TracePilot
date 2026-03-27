import { defineStore } from 'pinia';
import { ref, computed, watch, nextTick } from 'vue';
import type {
  SearchResult,
  SearchContentType,
  SearchFacetsResponse,
  SearchStatsResponse,
  SearchIndexingProgress,
} from '@tracepilot/types';
import {
  searchContent,
  getSearchStats,
  getSearchFacets,
  getSearchRepositories,
  getSearchToolNames,
  rebuildSearchIndex,
  ftsIntegrityCheck,
  ftsOptimize,
  ftsHealth,
} from '@tracepilot/client';
import type { FtsHealthInfo } from '@tracepilot/client';
import { toErrorMessage } from '@tracepilot/ui';
import { logWarn } from '@/utils/logger';
import { safeListen } from '@/utils/tauriEvents';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { useAsyncGuard } from '@/composables/useAsyncGuard';

export interface SessionGroup {
  sessionId: string;
  sessionSummary: string | null;
  sessionRepository: string | null;
  sessionBranch: string | null;
  results: SearchResult[];
}

export interface RecentSearch {
  query: string;
  timestamp: number;
  resultCount: number;
}

const RECENT_SEARCHES_KEY = 'tracepilot-recent-searches';
const MAX_RECENT_SEARCHES = 10;

function loadRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT_SEARCHES) : [];
  } catch { return []; }
}

function saveRecentSearches(searches: RecentSearch[]) {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches.slice(0, MAX_RECENT_SEARCHES)));
  } catch { /* localStorage full or unavailable */ }
}

/** Qualifier syntax: extract `type:`, `repo:`, `tool:`, `session:`, `sort:` from query. */
export interface ParsedQualifiers {
  cleanQuery: string;
  types: SearchContentType[];
  repo: string | null;
  tool: string | null;
  session: string | null;
  sort: 'relevance' | 'newest' | 'oldest' | null;
}

const QUALIFIER_RE = /\b(type|repo|tool|session|sort):(?:"([^"]+)"|(\S+))/gi;

export function parseQualifiers(raw: string): ParsedQualifiers {
  const result: ParsedQualifiers = {
    cleanQuery: raw,
    types: [],
    repo: null,
    tool: null,
    session: null,
    sort: null,
  };

  let match: RegExpExecArray | null;
  const consumed: [number, number][] = [];

  while ((match = QUALIFIER_RE.exec(raw)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3]; // quoted value or unquoted
    consumed.push([match.index, match.index + match[0].length]);
    switch (key) {
      case 'type':
        result.types.push(val as SearchContentType);
        break;
      case 'repo':
        result.repo = val;
        break;
      case 'tool':
        result.tool = val;
        break;
      case 'session':
        result.session = val;
        break;
      case 'sort':
        if (['relevance', 'newest', 'oldest'].includes(val)) {
          result.sort = val as 'relevance' | 'newest' | 'oldest';
        }
        break;
    }
  }

  // Strip consumed qualifiers from query
  if (consumed.length > 0) {
    let clean = '';
    let pos = 0;
    for (const [start, end] of consumed) {
      clean += raw.slice(pos, start);
      pos = end;
    }
    clean += raw.slice(pos);
    result.cleanQuery = clean.replace(/\s+/g, ' ').trim();
  }

  return result;
}

export interface FacetOverrides {
  contentTypes?: string[];
  repo?: string | null;
  tool?: string | null;
  session?: string | null;
}

export const useSearchStore = defineStore('search', () => {
  // ── Query state ──────────────────────────────────────────────
  const query = ref('');
  const contentTypes = ref<SearchContentType[]>([]);
  const excludeContentTypes = ref<SearchContentType[]>([]);
  const repository = ref<string | null>(null);
  const toolName = ref<string | null>(null);
  const dateFrom = ref<string | null>(null);
  const dateTo = ref<string | null>(null);
  const sessionId = ref<string | null>(null);
  const sortBy = ref<'relevance' | 'newest' | 'oldest'>('relevance');
  const page = ref(1);
  const pageSize = ref(50);

  // When true, watcher-triggered searches are suppressed (URL hydration in progress)
  let hydrating = false;

  // ── Results state ────────────────────────────────────────────
  const results = ref<SearchResult[]>([]);
  const totalCount = ref(0);
  const hasMore = ref(false);
  const latencyMs = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const resultViewMode = ref<'flat' | 'grouped'>('flat');

  // ── Facets & stats ───────────────────────────────────────────
  const stats = ref<SearchStatsResponse | null>(null);
  const facets = ref<SearchFacetsResponse | null>(null);
  const statsLoading = ref(false);

  // ── Available filter options ─────────────────────────────────
  const availableRepositories = ref<string[]>([]);
  const availableToolNames = ref<string[]>([]);

  // ── Rebuild / search-indexing state ──────────────────────────
  const rebuilding = ref(false);
  const searchIndexing = ref(false);
  const searchIndexingProgress = ref<SearchIndexingProgress | null>(null);

  // ── FTS health / maintenance ────────────────────────────────
  const healthInfo = ref<FtsHealthInfo | null>(null);
  const healthLoading = ref(false);
  const maintenanceMessage = ref<string | null>(null);

  // ── Recent searches ────────────────────────────────────────
  const recentSearches = ref<RecentSearch[]>(loadRecentSearches());

  // Global event listeners — initialized once, persist across route navigation
  let listenersInitialized = false;
  const unlisteners: UnlistenFn[] = [];

  async function initEventListeners() {
    if (listenersInitialized) return;
    listenersInitialized = true;

    try {
      unlisteners.push(
        await safeListen('search-indexing-started', () => {
          searchIndexing.value = true;
          searchIndexingProgress.value = null;
        }),
        await safeListen<SearchIndexingProgress>('search-indexing-progress', (event) => {
          searchIndexingProgress.value = event.payload;
        }),
        await safeListen('search-indexing-finished', () => {
          searchIndexing.value = false;
          searchIndexingProgress.value = null;
          fetchStats();
          fetchFilterOptions();
          fetchHealth();
          // Re-run current search if results are showing
          if (hasQuery.value || hasActiveFilters.value || hasResults.value) {
            scheduleSearch(false);
          } else {
            fetchFacets();
          }
        }),
      );
    } catch {
      // not in Tauri environment
    }
  }

  // Initialize listeners eagerly when the store is first created
  initEventListeners();

  // ── Computed ─────────────────────────────────────────────────
  const hasResults = computed(() => results.value.length > 0);
  const hasQuery = computed(() => query.value.trim().length > 0);
  const isBrowseMode = computed(() => !hasQuery.value);
  const totalPages = computed(() => Math.ceil(totalCount.value / pageSize.value));
  const hasActiveFilters = computed(() => {
    return contentTypes.value.length > 0
      || excludeContentTypes.value.length > 0
      || repository.value !== null
      || toolName.value !== null
      || dateFrom.value !== null
      || dateTo.value !== null
      || sessionId.value !== null;
  });

  // Session-grouped view: group flat results by sessionId
  const groupedResults = computed<SessionGroup[]>(() => {
    if (results.value.length === 0) return [];
    const map = new Map<string, SessionGroup>();
    for (const r of results.value) {
      let group = map.get(r.sessionId);
      if (!group) {
        group = {
          sessionId: r.sessionId,
          sessionSummary: r.sessionSummary ?? null,
          sessionRepository: r.sessionRepository ?? null,
          sessionBranch: r.sessionBranch ?? null,
          results: [],
        };
        map.set(r.sessionId, group);
      }
      group.results.push(r);
    }
    return Array.from(map.values());
  });

  // ── Single search scheduler (replaces multiple watchers) ────
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressPageWatcher = false;
  const searchGuard = useAsyncGuard();
  const DEBOUNCE_MS = 150;

  /**
   * Schedule a search. All state changes funnel through here.
   * - resetPage: reset to page 1 (true for query/filter changes, false for page changes)
   * - debounce: add delay (true for typing, false for filter clicks)
   */
  function scheduleSearch(resetPage: boolean, debounce = false) {
    if (hydrating) return; // Suppress during URL hydration

    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }

    if (resetPage && page.value !== 1) {
      suppressPageWatcher = true;
      page.value = 1;
    }

    if (debounce) {
      searchTimer = setTimeout(() => {
        searchTimer = null;
        executeSearch();
      }, DEBOUNCE_MS);
    } else {
      // Use nextTick to coalesce synchronous state changes (e.g. presets)
      nextTick(() => executeSearch());
    }
  }

  async function executeSearch() {
    // In browse mode, default to newest sort since relevance is meaningless
    const effectiveSort = isBrowseMode.value && sortBy.value === 'relevance'
      ? 'newest'
      : sortBy.value;

    // Parse inline qualifiers (e.g. "type:error repo:myapp fix bug")
    const parsed = parseQualifiers(query.value);
    // Always use parsed.cleanQuery — empty string means "no text, filter only"
    const searchQuery = parsed.cleanQuery;

    // Merge qualifier-derived filters with explicit UI filters
    const mergedContentTypes = parsed.types.length > 0
      ? [...new Set([...contentTypes.value, ...parsed.types])]
      : contentTypes.value;
    const mergedRepo = parsed.repo ?? repository.value;
    const mergedTool = parsed.tool ?? toolName.value;
    const mergedSession = parsed.session ?? sessionId.value;
    const mergedSort = parsed.sort ?? effectiveSort;

    const token = searchGuard.start();
    loading.value = true;
    error.value = null;

    try {
      let dateFromUnix: number | undefined;
      let dateToUnix: number | undefined;
      if (dateFrom.value) {
        dateFromUnix = Math.floor(new Date(dateFrom.value).getTime() / 1000);
      }
      if (dateTo.value) {
        dateToUnix = Math.floor(new Date(dateTo.value).getTime() / 1000);
      }

      const response = await searchContent(searchQuery, {
        contentTypes: mergedContentTypes.length > 0 ? mergedContentTypes : undefined,
        excludeContentTypes: excludeContentTypes.value.length > 0 ? excludeContentTypes.value : undefined,
        repositories: mergedRepo ? [mergedRepo] : undefined,
        toolNames: mergedTool ? [mergedTool] : undefined,
        sessionId: mergedSession ?? undefined,
        dateFromUnix,
        dateToUnix,
        limit: pageSize.value,
        offset: (page.value - 1) * pageSize.value,
        sortBy: mergedSort !== 'relevance' ? mergedSort : undefined,
      });

      if (!searchGuard.isValid(token)) return;

      results.value = response.results;
      totalCount.value = response.totalCount;
      hasMore.value = response.hasMore;
      latencyMs.value = response.latencyMs;

      // Record to recent searches (only for text queries, not browse mode)
      if (query.value.trim().length > 0 && response.totalCount > 0) {
        addRecentSearch(query.value.trim(), response.totalCount);
      }

      // Fetch facets using the same parsed query and merged filters as the search.
      // Use searchQuery directly (empty string = browse mode); don't fall back to raw
      // query.value which may contain qualifier syntax like "type:error".
      const facetQuery = searchQuery || undefined;
      fetchFacets(facetQuery, {
        contentTypes: mergedContentTypes,
        repo: mergedRepo,
        tool: mergedTool,
        session: mergedSession,
      });
    } catch (err: unknown) {
      if (!searchGuard.isValid(token)) return;
      error.value = toErrorMessage(e);
      results.value = [];
      totalCount.value = 0;
      hasMore.value = false;
      latencyMs.value = 0;
    } finally {
      if (searchGuard.isValid(token)) loading.value = false;
    }
  }

  // Query changes → debounced search (resets page)
  watch(query, () => scheduleSearch(true, true));

  // Filter changes → immediate search (resets page)
  watch(
    [contentTypes, excludeContentTypes, repository, toolName, dateFrom, dateTo, sessionId, sortBy],
    () => scheduleSearch(true),
    { deep: true },
  );

  // Page changes → immediate search (no page reset)
  watch(page, () => {
    if (suppressPageWatcher) {
      suppressPageWatcher = false;
      return;
    }
    scheduleSearch(false);
  });

  // ── Quick browse presets ─────────────────────────────────────
  function applyBrowsePreset(types: SearchContentType[]) {
    hydrating = true;
    page.value = 1;
    query.value = '';
    contentTypes.value = types;
    excludeContentTypes.value = [];
    repository.value = null;
    toolName.value = null;
    dateFrom.value = null;
    dateTo.value = null;
    sessionId.value = null;
    sortBy.value = 'newest';
    nextTick(() => {
      hydrating = false;
      scheduleSearch(false);
    });
  }

  function browseErrors() {
    applyBrowsePreset(['error', 'tool_error']);
  }

  function browseUserMessages() {
    applyBrowsePreset(['user_message']);
  }

  function browseToolCalls() {
    applyBrowsePreset(['tool_call']);
  }

  function browseReasoning() {
    applyBrowsePreset(['reasoning']);
  }

  function browseToolResults() {
    applyBrowsePreset(['tool_result']);
  }

  function browseSubagents() {
    applyBrowsePreset(['subagent']);
  }

  // ── Recent search management ──────────────────────────────
  function addRecentSearch(q: string, count: number) {
    const existing = recentSearches.value.filter(s => s.query !== q);
    existing.unshift({ query: q, timestamp: Date.now(), resultCount: count });
    recentSearches.value = existing.slice(0, MAX_RECENT_SEARCHES);
    saveRecentSearches(recentSearches.value);
  }

  function applyRecentSearch(q: string) {
    query.value = q;
  }

  function removeRecentSearch(q: string) {
    recentSearches.value = recentSearches.value.filter(s => s.query !== q);
    saveRecentSearches(recentSearches.value);
  }

  function clearRecentSearches() {
    recentSearches.value = [];
    saveRecentSearches([]);
  }

  // ── Helpers ───────────────────────────────────────────────
  /** Safely extract text from an HTML snippet (handles code like `a < b && c > d`). */
  function stripHtml(html: string): string {
    if (!html) return '';
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return doc.body.textContent ?? '';
    } catch {
      // Fallback: only strip known safe tags (<mark>, </mark>)
      return html.replace(/<\/?mark>/gi, '');
    }
  }

  // ── Export / copy ─────────────────────────────────────────
  async function copyResultsToClipboard(resultsToCopy?: SearchResult[]): Promise<boolean> {
    const items = resultsToCopy ?? results.value;
    if (items.length === 0) return false;
    const text = items.map(r => {
      const meta = [r.contentType.replace(/_/g, ' '), r.toolName].filter(Boolean).join(' · ');
      const plainSnippet = stripHtml(r.snippet);
      const header = r.sessionSummary ? `[${r.sessionSummary}] ${meta}` : `[${meta}]`;
      return `${header}\n${plainSnippet}`;
    }).join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { return false; }
  }

  async function copySingleResult(result: SearchResult): Promise<boolean> {
    try {
      const plainSnippet = stripHtml(result.snippet);
      const parts: string[] = [];
      if (result.sessionSummary) parts.push(`Session: ${result.sessionSummary}`);
      const meta = [result.contentType.replace(/_/g, ' ')];
      if (result.toolName) meta.push(`tool: ${result.toolName}`);
      if (result.turnNumber != null) meta.push(`turn ${result.turnNumber}`);
      parts.push(meta.join(' · '));
      parts.push('');
      parts.push(plainSnippet);
      if (result.sessionRepository) parts.push(`\nRepo: ${result.sessionRepository}`);
      await navigator.clipboard.writeText(parts.join('\n'));
      return true;
    } catch { return false; }
  }

  // ── Facets & stats ───────────────────────────────────────────
  const facetGuard = useAsyncGuard();

  async function fetchFacets(forQuery?: string, overrides?: FacetOverrides) {
    const token = facetGuard.start();
    try {
      let dateFromUnix: number | undefined;
      let dateToUnix: number | undefined;
      if (dateFrom.value) dateFromUnix = Math.floor(new Date(dateFrom.value).getTime() / 1000);
      if (dateTo.value) dateToUnix = Math.floor(new Date(dateTo.value).getTime() / 1000);

      const ct = overrides?.contentTypes ?? contentTypes.value;
      const repo = overrides?.repo ?? repository.value;
      const tool = overrides?.tool ?? toolName.value;
      const session = overrides?.session !== undefined ? overrides.session : sessionId.value;

      const result = await getSearchFacets(forQuery, {
        contentTypes: ct.length > 0 ? ct : undefined,
        excludeContentTypes: excludeContentTypes.value.length > 0 ? excludeContentTypes.value : undefined,
        repositories: repo ? [repo] : undefined,
        toolNames: tool ? [tool] : undefined,
        sessionId: session ?? undefined,
        dateFromUnix,
        dateToUnix,
      });
      if (!facetGuard.isValid(token)) return;
      facets.value = result;
    } catch (err: unknown) {
      if (!facetGuard.isValid(token)) return;
      logWarn('[search] Failed to fetch search facets:', e);
    }
  }

  async function fetchStats() {
    statsLoading.value = true;
    try {
      stats.value = await getSearchStats();
    } catch (err: unknown) {
      logWarn('[search] Failed to fetch search stats:', e);
    } finally {
      statsLoading.value = false;
    }
  }

  async function fetchFilterOptions() {
    try {
      const [repos, tools] = await Promise.all([
        getSearchRepositories(),
        getSearchToolNames(),
      ]);
      availableRepositories.value = repos;
      availableToolNames.value = tools;
    } catch {
      // non-fatal
    }
  }

  // ── Rebuild ──────────────────────────────────────────────────
  async function rebuild() {
    if (rebuilding.value || searchIndexing.value) return;
    rebuilding.value = true;
    error.value = null;
    try {
      await rebuildSearchIndex();
      await Promise.all([fetchStats(), fetchFacets(), fetchFilterOptions()]);
      if (hasQuery.value || hasActiveFilters.value || hasResults.value) {
        await executeSearch();
      }
    } catch (err: unknown) {
      error.value = toErrorMessage(e);
    } finally {
      rebuilding.value = false;
    }
  }

  // ── FTS Maintenance ─────────────────────────────────────────
  async function fetchHealth() {
    healthLoading.value = true;
    try {
      healthInfo.value = await ftsHealth();
    } catch (err: unknown) {
      healthInfo.value = null;
    } finally {
      healthLoading.value = false;
    }
  }

  async function runIntegrityCheck() {
    maintenanceMessage.value = null;
    try {
      maintenanceMessage.value = await ftsIntegrityCheck();
    } catch (err: unknown) {
      maintenanceMessage.value = `Error: ${String(e)}`;
    }
  }

  async function runOptimize() {
    maintenanceMessage.value = null;
    try {
      maintenanceMessage.value = await ftsOptimize();
      await fetchHealth(); // refresh health after optimize
    } catch (err: unknown) {
      maintenanceMessage.value = `Error: ${String(e)}`;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────
  function clearFilters() {
    contentTypes.value = [];
    excludeContentTypes.value = [];
    repository.value = null;
    toolName.value = null;
    dateFrom.value = null;
    dateTo.value = null;
    sessionId.value = null;
    sortBy.value = 'relevance';
    page.value = 1;
  }

  function clearAll() {
    // Suppress watchers during multi-ref reset
    hydrating = true;
    query.value = '';
    clearFilters();
    results.value = [];
    totalCount.value = 0;
    hasMore.value = false;
    latencyMs.value = 0;
    error.value = null;
    nextTick(() => { hydrating = false; });
  }

  function setPage(p: number) {
    page.value = Math.max(1, Math.min(p, totalPages.value || 1));
  }

  function nextPage() {
    if (hasMore.value) setPage(page.value + 1);
  }

  function prevPage() {
    if (page.value > 1) setPage(page.value - 1);
  }

  return {
    // Query state
    query,
    contentTypes,
    excludeContentTypes,
    repository,
    toolName,
    dateFrom,
    dateTo,
    sessionId,
    sortBy,
    page,
    pageSize,
    // Results state
    results,
    totalCount,
    hasMore,
    latencyMs,
    loading,
    error,
    resultViewMode,
    groupedResults,
    // Facets & stats
    stats,
    facets,
    statsLoading,
    availableRepositories,
    availableToolNames,
    // Rebuild
    rebuilding,
    searchIndexing,
    searchIndexingProgress,
    // Recent searches
    recentSearches,
    // Computed
    hasResults,
    hasQuery,
    isBrowseMode,
    hasActiveFilters,
    totalPages,
    // Actions
    executeSearch,
    fetchFacets,
    fetchStats,
    fetchFilterOptions,
    rebuild,
    clearFilters,
    clearAll,
    setPage,
    nextPage,
    prevPage,
    initEventListeners,
    browseErrors,
    browseUserMessages,
    browseToolCalls,
    browseReasoning,
    browseToolResults,
    browseSubagents,
    applyRecentSearch,
    removeRecentSearch,
    clearRecentSearches,
    copyResultsToClipboard,
    copySingleResult,
    // FTS maintenance
    healthInfo,
    healthLoading,
    maintenanceMessage,
    fetchHealth,
    runIntegrityCheck,
    runOptimize,
    // Hydration control (for URL sync)
    beginHydration: () => { hydrating = true; },
    endHydration: () => { hydrating = false; },
    // Load stats/facets without executing a search (for browse presets view)
    async fetchStatsOnly() {
      await Promise.all([fetchStats(), fetchFacets(), fetchFilterOptions()]);
    },
  };
});
