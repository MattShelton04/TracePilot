import {
  agentsUsageSummary,
  getAnalytics,
  getCodeImpact,
  getToolAnalysis,
  IPC_EVENTS,
  skillsUsageSummary,
} from "@tracepilot/client";
import {
  type AgentUsageSummary,
  type AnalyticsData,
  type CodeImpactData,
  type SessionSource,
  type SkillUsageSummary,
  sourceLabel,
  type ToolAnalysisData,
} from "@tracepilot/types";
import { type CachedFetchResult, useCachedFetch } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useScopedEventListener } from "@/composables/useScopedEventListener";
import {
  type AnalyticsDatasetName,
  type AnalyticsDateRange,
  type AnalyticsFetchParams,
  type AnalyticsTimeRange,
  cacheKey,
  presetRange,
} from "@/utils/analyticsFilters";
import { createAnalyticsPrefetch } from "@/utils/analyticsPrefetch";
import { usePreferencesStore } from "./preferences";
import { useSessionsStore } from "./sessions";

export type {
  AnalyticsDatasetName,
  AnalyticsDateRange,
  AnalyticsTimeRange,
} from "@/utils/analyticsFilters";

// Each analytics payload can be substantial. Sixteen recent filter
// combinations per dataset hold the prefetched neighbours of the current
// filters (the other preset ranges and each source) plus normal range and
// repository switching, without retaining every custom date combination
// explored during a long-running app session.
const ANALYTICS_CACHE_ENTRIES_PER_DATASET = 16;

/** Options accepted by all analytics fetch actions. */
export interface AnalyticsFetchOptions {
  fromDate?: string;
  toDate?: string;
  repo?: string;
  force?: boolean;
  /**
   * Revalidate in place: while results are on screen, keep them there until
   * the new ones land instead of reporting the dataset as loading.
   */
  background?: boolean;
}

export const useAnalyticsStore = defineStore("analytics", () => {
  // Repository filter — sourced from sessions store to avoid redundant listSessions() calls
  const selectedRepo = ref<string | null>(null);
  const availableRepos = computed(() => {
    const sessionsStore = useSessionsStore();
    return sessionsStore.repositories as string[];
  });

  // Source filter: `null` covers every source. The choices come from the
  // sessions store, like the repository list.
  const selectedSource = ref<SessionSource | null>(null);
  const availableSources = computed(() => useSessionsStore().sources);
  /** `"Claude Code "` while a source filter is set, for page subtitles. */
  const sourcePrefix = computed(() =>
    selectedSource.value ? `${sourceLabel(selectedSource.value)} ` : "",
  );

  const selectedTimeRange = ref<AnalyticsTimeRange>("all");
  const customFromDate = ref<string | undefined>(undefined);
  const customToDate = ref<string | undefined>(undefined);

  const dateRange = computed<AnalyticsDateRange>(() =>
    selectedTimeRange.value === "custom"
      ? { fromDate: customFromDate.value, toDate: customToDate.value }
      : presetRange(selectedTimeRange.value),
  );

  function setTimeRange(range: AnalyticsTimeRange, from?: string, to?: string) {
    selectedTimeRange.value = range;
    if (range === "custom") {
      customFromDate.value = from;
      customToDate.value = to;
    }
  }

  // One cached fetch per dataset, keyed by filters. Agents and Skills come
  // from their own index tables, so their panels query them separately.
  const cachedFetch = <T>(
    name: AnalyticsDatasetName,
    fetcher: (params: AnalyticsFetchParams) => Promise<T>,
  ) =>
    useCachedFetch<T, AnalyticsFetchParams>({
      fetcher,
      cacheKeyFn: cacheKey(name),
      maxCacheEntries: ANALYTICS_CACHE_ENTRIES_PER_DATASET,
    });
  const analyticsFetcher = cachedFetch<AnalyticsData>("analytics", (p) => getAnalytics(p));
  const toolAnalysisFetcher = cachedFetch<ToolAnalysisData>("toolAnalysis", (p) =>
    getToolAnalysis(p),
  );
  const codeImpactFetcher = cachedFetch<CodeImpactData>("codeImpact", (p) => getCodeImpact(p));
  const agentsFetcher = cachedFetch<AgentUsageSummary>("agents", (p) => agentsUsageSummary(p));
  const skillsFetcher = cachedFetch<SkillUsageSummary>("skills", (p) => skillsUsageSummary(p));

  /** Ensure the sessions store is populated so availableRepos has data. */
  async function fetchAvailableRepos() {
    const sessionsStore = useSessionsStore();
    if (sessionsStore.sessions.length === 0) {
      await sessionsStore.fetchSessions();
    }
  }

  // ── Shared fetch factory ──────────────────────────────────────
  // All analytics fetch actions share the same parameter-building logic.
  // Pages swap their whole layout for the loading state while `loading` is
  // set, so a background fetch (a filter change or a finished reindex while
  // results are on screen) reports `refreshing` instead: the page keeps its
  // panels, dims them, and updates them in place when the results land.

  function buildParams(
    filters: AnalyticsDateRange & { repo?: string; source?: SessionSource | null },
  ) {
    return {
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      repo: filters.repo ?? selectedRepo.value ?? undefined,
      hideEmpty: usePreferencesStore().hideEmptySessions,
      source: (filters.source === undefined ? selectedSource.value : filters.source) ?? undefined,
    } satisfies AnalyticsFetchParams;
  }

  function buildDataset<T>(fetcher: CachedFetchResult<T, AnalyticsFetchParams>) {
    const revalidating = ref(false);
    let latest = 0;
    const loading = computed(() => fetcher.loading.value && !revalidating.value);
    const refreshing = computed(() => fetcher.loading.value && revalidating.value);

    async function fetch(options?: AnalyticsFetchOptions) {
      const params = buildParams({ ...dateRange.value, ...options });
      // Only the newest call decides. A background call keeps results on
      // screen, also while an earlier background call is still loading; a
      // foreground request that is already loading keeps its loading state.
      const call = ++latest;
      revalidating.value =
        !!options?.background &&
        fetcher.data.value !== null &&
        (revalidating.value || !fetcher.loading.value);
      try {
        await fetcher.fetch(params, { force: options?.force });
      } finally {
        if (call === latest) revalidating.value = false;
      }
    }

    return { loading, refreshing, fetch, prefetch: fetcher.prefetch };
  }

  const datasets = {
    analytics: buildDataset(analyticsFetcher),
    toolAnalysis: buildDataset(toolAnalysisFetcher),
    codeImpact: buildDataset(codeImpactFetcher),
    agents: buildDataset(agentsFetcher),
    skills: buildDataset(skillsFetcher),
  } satisfies Record<AnalyticsDatasetName, unknown>;
  const fetchAnalytics = datasets.analytics.fetch;
  const fetchToolAnalysis = datasets.toolAnalysis.fetch;
  const fetchCodeImpact = datasets.codeImpact.fetch;
  const fetchAgentsSummary = datasets.agents.fetch;
  const fetchSkillsSummary = datasets.skills.fetch;

  const background = createAnalyticsPrefetch({
    prefetch: (name, params) => datasets[name].prefetch(params),
    build: buildParams,
    dateRange: () => dateRange.value,
    sources: () => availableSources.value,
    onWarm: () => void watchIndexUpdates(),
  });

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

  /** Change the active source filter. Cache keys include the source. */
  function setSource(source: SessionSource | null) {
    selectedSource.value = source;
  }

  function $reset() {
    analyticsFetcher.reset();
    toolAnalysisFetcher.reset();
    codeImpactFetcher.reset();
    agentsFetcher.reset();
    skillsFetcher.reset();
    background.reset();
    selectedRepo.value = null;
    selectedSource.value = null;
    selectedTimeRange.value = "all";
    customFromDate.value = undefined;
    customToDate.value = undefined;
  }

  // Invalidate analytics cache when hideEmptySessions preference changes
  const allFetchers = [
    analyticsFetcher,
    toolAnalysisFetcher,
    codeImpactFetcher,
    agentsFetcher,
    skillsFetcher,
  ];
  const prefs = usePreferencesStore();
  watch(
    () => prefs.hideEmptySessions,
    () => {
      for (const f of allFetchers) f.invalidate();
    },
  );

  // Cached results describe the index at the time they were fetched. When a
  // session reindex finishes, drop them and bump `dataRevision` so mounted
  // analytics pages refetch once in the background, instead of showing stale
  // (or, right after first-run indexing, partial) numbers until the filters
  // change.
  const dataRevision = ref(0);
  const watchIndexUpdates = useScopedEventListener(IPC_EVENTS.INDEXING_FINISHED, () => {
    for (const f of allFetchers) f.invalidate();
    dataRevision.value += 1;
    background.rewarm();
  });

  return {
    // State - use fetcher refs directly
    analytics: analyticsFetcher.data,
    toolAnalysis: toolAnalysisFetcher.data,
    codeImpact: codeImpactFetcher.data,
    agentsSummary: agentsFetcher.data,
    skillsSummary: skillsFetcher.data,
    analyticsLoading: datasets.analytics.loading,
    toolAnalysisLoading: datasets.toolAnalysis.loading,
    codeImpactLoading: datasets.codeImpact.loading,
    agentsSummaryLoading: datasets.agents.loading,
    skillsSummaryLoading: datasets.skills.loading,
    analyticsRefreshing: datasets.analytics.refreshing,
    toolAnalysisRefreshing: datasets.toolAnalysis.refreshing,
    codeImpactRefreshing: datasets.codeImpact.refreshing,
    agentsSummaryRefreshing: datasets.agents.refreshing,
    skillsSummaryRefreshing: datasets.skills.refreshing,
    analyticsError: analyticsFetcher.error,
    toolAnalysisError: toolAnalysisFetcher.error,
    codeImpactError: codeImpactFetcher.error,
    agentsSummaryError: agentsFetcher.error,
    skillsSummaryError: skillsFetcher.error,
    selectedRepo,
    availableRepos,
    selectedSource,
    availableSources,
    sourcePrefix,
    selectedTimeRange,
    customFromDate,
    customToDate,
    dateRange,
    dataRevision,

    // Actions
    fetchAnalytics,
    fetchToolAnalysis,
    fetchCodeImpact,
    fetchAgentsSummary,
    fetchSkillsSummary,
    fetchAvailableRepos,
    /** Prefetch nearby filters for the named datasets while idle. */
    prefetchNearby: background.prefetchNearby,
    cancelPrefetch: background.cancel,
    /** Warm the current filters' datasets off screen (at launch). */
    warm: background.warm,
    refreshAll,
    setRepo,
    setSource,
    setTimeRange,
    watchIndexUpdates,
    $reset,
  };
});
