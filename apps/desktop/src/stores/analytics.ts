import { getAnalytics, getCodeImpact, getToolAnalysis } from '@tracepilot/client';
import type { AnalyticsData, CodeImpactData, ToolAnalysisData } from '@tracepilot/types';
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { useSessionsStore } from './sessions';
import { usePreferencesStore } from './preferences';

export const useAnalyticsStore = defineStore('analytics', () => {
  // State
  const analytics = ref<AnalyticsData | null>(null);
  const toolAnalysis = ref<ToolAnalysisData | null>(null);
  const codeImpact = ref<CodeImpactData | null>(null);

  const analyticsLoading = ref(false);
  const toolAnalysisLoading = ref(false);
  const codeImpactLoading = ref(false);

  const analyticsError = ref<string | null>(null);
  const toolAnalysisError = ref<string | null>(null);
  const codeImpactError = ref<string | null>(null);

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

  function setTimeRange(range: 'all' | '7d' | '30d' | '90d' | 'custom', from?: string, to?: string) {
    selectedTimeRange.value = range;
    if (range === 'custom') {
      customFromDate.value = from;
      customToDate.value = to;
    }
  }

  // Track what's been loaded to avoid redundant fetches
  const loaded = new Set<string>();

  // In-flight promise dedup: if a fetch is already running for a cache key, return the same promise
  const inflight = new Map<string, Promise<void>>();

  // Request generation counters to prevent stale async writes
  let analyticsGen = 0;
  let toolAnalysisGen = 0;
  let codeImpactGen = 0;

  function cacheKeyFor(prefix: string, options?: { fromDate?: string; toDate?: string; repo?: string; hideEmpty?: boolean }) {
    return `${prefix}:${options?.fromDate ?? ''}:${options?.toDate ?? ''}:${options?.repo ?? ''}:${options?.hideEmpty ?? ''}`;
  }

  /** Ensure the sessions store is populated so availableRepos has data. */
  async function fetchAvailableRepos() {
    const sessionsStore = useSessionsStore();
    if (sessionsStore.sessions.length === 0) {
      await sessionsStore.fetchSessions();
    }
  }

  // Actions
  async function fetchAnalytics(options?: { fromDate?: string; toDate?: string; repo?: string; force?: boolean }) {
    const prefs = usePreferencesStore();
    const merged = { ...dateRange.value, ...options };
    const repo = merged.repo ?? selectedRepo.value ?? undefined;
    const hideEmpty = prefs.hideEmptySessions;
    const cacheKey = cacheKeyFor('analytics', { ...merged, repo, hideEmpty });
    if (!options?.force && loaded.has(cacheKey)) return;
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);

    const gen = ++analyticsGen;
    analyticsLoading.value = true;
    analyticsError.value = null;
    const promise = (async () => {
      try {
        const result = await getAnalytics({
          fromDate: merged.fromDate,
          toDate: merged.toDate,
          repo,
          hideEmpty,
        });
        if (gen !== analyticsGen) return;
        analytics.value = result;
        loaded.add(cacheKey);
      } catch (e) {
        if (gen !== analyticsGen) return;
        analyticsError.value = e instanceof Error ? e.message : String(e);
      } finally {
        inflight.delete(cacheKey);
        if (gen === analyticsGen) analyticsLoading.value = false;
      }
    })();
    inflight.set(cacheKey, promise);
    return promise;
  }

  async function fetchToolAnalysis(options?: {
    fromDate?: string;
    toDate?: string;
    repo?: string;
    force?: boolean;
  }) {
    const prefs = usePreferencesStore();
    const merged = { ...dateRange.value, ...options };
    const repo = merged.repo ?? selectedRepo.value ?? undefined;
    const hideEmpty = prefs.hideEmptySessions;
    const cacheKey = cacheKeyFor('toolAnalysis', { ...merged, repo, hideEmpty });
    if (!options?.force && loaded.has(cacheKey)) return;
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);

    const gen = ++toolAnalysisGen;
    toolAnalysisLoading.value = true;
    toolAnalysisError.value = null;
    const promise = (async () => {
      try {
        const result = await getToolAnalysis({
          fromDate: merged.fromDate,
          toDate: merged.toDate,
          repo,
          hideEmpty,
        });
        if (gen !== toolAnalysisGen) return;
        toolAnalysis.value = result;
        loaded.add(cacheKey);
      } catch (e) {
        if (gen !== toolAnalysisGen) return;
        toolAnalysisError.value = e instanceof Error ? e.message : String(e);
      } finally {
        inflight.delete(cacheKey);
        if (gen === toolAnalysisGen) toolAnalysisLoading.value = false;
      }
    })();
    inflight.set(cacheKey, promise);
    return promise;
  }

  async function fetchCodeImpact(options?: {
    fromDate?: string;
    toDate?: string;
    repo?: string;
    force?: boolean;
  }) {
    const prefs = usePreferencesStore();
    const merged = { ...dateRange.value, ...options };
    const repo = merged.repo ?? selectedRepo.value ?? undefined;
    const hideEmpty = prefs.hideEmptySessions;
    const cacheKey = cacheKeyFor('codeImpact', { ...merged, repo, hideEmpty });
    if (!options?.force && loaded.has(cacheKey)) return;
    if (inflight.has(cacheKey)) return inflight.get(cacheKey);

    const gen = ++codeImpactGen;
    codeImpactLoading.value = true;
    codeImpactError.value = null;
    const promise = (async () => {
      try {
        const result = await getCodeImpact({
          fromDate: merged.fromDate,
          toDate: merged.toDate,
          repo,
          hideEmpty,
        });
        if (gen !== codeImpactGen) return;
        codeImpact.value = result;
        loaded.add(cacheKey);
      } catch (e) {
        if (gen !== codeImpactGen) return;
        codeImpactError.value = e instanceof Error ? e.message : String(e);
      } finally {
        inflight.delete(cacheKey);
        if (gen === codeImpactGen) codeImpactLoading.value = false;
      }
    })();
    inflight.set(cacheKey, promise);
    return promise;
  }

  async function refreshAll(options?: { fromDate?: string; toDate?: string }) {
    loaded.clear();
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
    analytics.value = null;
    toolAnalysis.value = null;
    codeImpact.value = null;
    analyticsLoading.value = false;
    toolAnalysisLoading.value = false;
    codeImpactLoading.value = false;
    analyticsError.value = null;
    toolAnalysisError.value = null;
    codeImpactError.value = null;
    selectedRepo.value = null;
    selectedTimeRange.value = 'all';
    customFromDate.value = undefined;
    customToDate.value = undefined;
    loaded.clear();
  }

  // Invalidate analytics cache when hideEmptySessions preference changes
  const prefs = usePreferencesStore();
  watch(() => prefs.hideEmptySessions, () => {
    loaded.clear();
  });

  return {
    // State
    analytics,
    toolAnalysis,
    codeImpact,
    analyticsLoading,
    toolAnalysisLoading,
    codeImpactLoading,
    analyticsError,
    toolAnalysisError,
    codeImpactError,
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
