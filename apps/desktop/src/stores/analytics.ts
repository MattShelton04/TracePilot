import { getAnalytics, getCodeImpact, getToolAnalysis } from '@tracepilot/client';
import type { AnalyticsData, CodeImpactData, ToolAnalysisData } from '@tracepilot/types';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useCachedFetch } from '@/composables/useCachedFetch';
import { usePreferencesStore } from './preferences';
import { useSessionsStore } from './sessions';

/** Parameters for analytics fetch operations */
interface AnalyticsFetchParams {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  hideEmpty?: boolean;
}

/** Options accepted by all analytics fetch actions. */
export interface AnalyticsFetchOptions {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  force?: boolean;
}

export const useAnalyticsStore = defineStore('analytics', () => {
  // Repository filter — sourced from sessions store to avoid redundant listSessions() calls
  const selectedRepo = ref<string | null>(null);
  const availableRepos = computed(() => {
    const sessionsStore = useSessionsStore();
    return sessionsStore.repositories as string[];
  });

  // Time range filter
  const selectedTimeRange = ref<'all' | '7d' | '30d' | '90d' | 'custom'>('all');
  const customFromDate = ref<string | undefined>(undefined);
  const customToDate = ref<string | undefined>(undefined);

  const dateRange = computed<{ fromDate?: string; toDate?: string }>(() => {
    if (selectedTimeRange.value === 'all') return {};
    if (selectedTimeRange.value === 'custom') {
      return { fromDate: customFromDate.value, toDate: customToDate.value };
    }
    const days = { '7d': 7, '30d': 30, '90d': 90 }[selectedTimeRange.value];
    const from = new Date();
    from.setDate(from.getDate() - days);
    const yyyy = from.getFullYear();
    const mm = String(from.getMonth() + 1).padStart(2, '0');
    const dd = String(from.getDate()).padStart(2, '0');
    return { fromDate: `${yyyy}-${mm}-${dd}` };
  });

  function setTimeRange(
    range: 'all' | '7d' | '30d' | '90d' | 'custom',
    from?: string,
    to?: string,
  ) {
    selectedTimeRange.value = range;
    if (range === 'custom') {
      customFromDate.value = from;
      customToDate.value = to;
    }
  }

  // Create cached fetch instances for each data type
  const analyticsFetcher = useCachedFetch<AnalyticsData, AnalyticsFetchParams>({
    fetcher: (params) => getAnalytics(params),
    cacheKeyFn: (params) =>
      `analytics:${params.fromDate ?? ''}:${params.toDate ?? ''}:${params.repo ?? ''}:${params.hideEmpty ?? ''}`,
  });

  const toolAnalysisFetcher = useCachedFetch<ToolAnalysisData, AnalyticsFetchParams>({
    fetcher: (params) => getToolAnalysis(params),
    cacheKeyFn: (params) =>
      `toolAnalysis:${params.fromDate ?? ''}:${params.toDate ?? ''}:${params.repo ?? ''}:${params.hideEmpty ?? ''}`,
  });

  const codeImpactFetcher = useCachedFetch<CodeImpactData, AnalyticsFetchParams>({
    fetcher: (params) => getCodeImpact(params),
    cacheKeyFn: (params) =>
      `codeImpact:${params.fromDate ?? ''}:${params.toDate ?? ''}:${params.repo ?? ''}:${params.hideEmpty ?? ''}`,
  });

  /** Ensure the sessions store is populated so availableRepos has data. */
  async function fetchAvailableRepos() {
    const sessionsStore = useSessionsStore();
    if (sessionsStore.sessions.length === 0) {
      await sessionsStore.fetchSessions();
    }
  }

  // ── Shared fetch factory ──────────────────────────────────────
  // All three analytics fetch actions share the same parameter-building logic.

  function buildFetchAction(fetcher: {
    fetch: (params: AnalyticsFetchParams, opts?: { force?: boolean }) => Promise<unknown>;
  }) {
    return async (options?: AnalyticsFetchOptions) => {
      const prefs = usePreferencesStore();
      const merged = { ...dateRange.value, ...options };
      const params: AnalyticsFetchParams = {
        fromDate: merged.fromDate,
        toDate: merged.toDate,
        repo: merged.repo ?? selectedRepo.value ?? undefined,
        hideEmpty: prefs.hideEmptySessions,
      };
      await fetcher.fetch(params, { force: options?.force });
    };
  }

  const fetchAnalytics = buildFetchAction(analyticsFetcher);
  const fetchToolAnalysis = buildFetchAction(toolAnalysisFetcher);
  const fetchCodeImpact = buildFetchAction(codeImpactFetcher);

  async function refreshAll(options?: { fromDate?: string; toDate?: string }) {
    await Promise.all([
      fetchAnalytics({ ...options, force: true }),
      fetchToolAnalysis({ ...options, force: true }),
      fetchCodeImpact({ ...options, force: true }),
    ]);
  }

  /** Change the active repository filter. Cache keys already include repo so no clear needed. */
  function setRepo(repo: string | null) {
    selectedRepo.value = repo;
  }

  function $reset() {
    analyticsFetcher.reset();
    toolAnalysisFetcher.reset();
    codeImpactFetcher.reset();
    selectedRepo.value = null;
    selectedTimeRange.value = 'all';
    customFromDate.value = undefined;
    customToDate.value = undefined;
  }

  // Invalidate analytics cache when hideEmptySessions preference changes
  const allFetchers = [analyticsFetcher, toolAnalysisFetcher, codeImpactFetcher];
  const prefs = usePreferencesStore();
  watch(
    () => prefs.hideEmptySessions,
    () => {
      for (const f of allFetchers) f.clearCache();
    },
  );

  return {
    // State - use fetcher refs directly
    analytics: analyticsFetcher.data,
    toolAnalysis: toolAnalysisFetcher.data,
    codeImpact: codeImpactFetcher.data,
    analyticsLoading: analyticsFetcher.loading,
    toolAnalysisLoading: toolAnalysisFetcher.loading,
    codeImpactLoading: codeImpactFetcher.loading,
    analyticsError: analyticsFetcher.error,
    toolAnalysisError: toolAnalysisFetcher.error,
    codeImpactError: codeImpactFetcher.error,
    selectedRepo,
    availableRepos,
    selectedTimeRange,
    customFromDate,
    customToDate,
    dateRange,

    // Actions
    fetchAnalytics,
    fetchToolAnalysis,
    fetchCodeImpact,
    fetchAvailableRepos,
    refreshAll,
    setRepo,
    setTimeRange,
    $reset,
  };
});
