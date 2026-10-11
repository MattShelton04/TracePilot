import { onMounted, onScopeDispose, watch } from "vue";
import {
  type AnalyticsDatasetName,
  type AnalyticsFetchOptions,
  useAnalyticsStore,
} from "@/stores/analytics";

type AnalyticsFetchMethod = "fetchAnalytics" | "fetchToolAnalysis" | "fetchCodeImpact";

const DATASET: Record<AnalyticsFetchMethod, AnalyticsDatasetName> = {
  fetchAnalytics: "analytics",
  fetchToolAnalysis: "toolAnalysis",
  fetchCodeImpact: "codeImpact",
};

export interface AnalyticsPageOptions {
  /** Other datasets the page shows, prefetched with its own. */
  alsoPrefetch?: () => AnalyticsDatasetName[];
}

/**
 * Shared lifecycle boilerplate for analytics pages.
 *
 * Fetches available repositories on mount, invokes the named fetch method,
 * and re-fetches whenever the selected repository, source or date range
 * changes. Results are cached per filter combination, so switching back to
 * a range that was already loaded is instant.
 *
 * Every fetch after the first runs in the background: the page keeps its
 * current results on screen (dimmed through the store's `*Refreshing` flag)
 * until the new ones land, instead of swapping to the loading state. Once a
 * fetch lands, the nearby filters (other preset ranges and sources) are
 * prefetched while the app is idle. The store drops its caches when a
 * reindex finishes and bumps `dataRevision`, which refetches here too.
 *
 * @param method - The store fetch method name to call.
 * @returns The analytics store instance for convenient destructuring.
 */
export function useAnalyticsPage(method: AnalyticsFetchMethod, options: AnalyticsPageOptions = {}) {
  const store = useAnalyticsStore();
  let latest = 0;

  async function load(fetchOptions?: AnalyticsFetchOptions) {
    const call = ++latest;
    store.cancelPrefetch();
    await store[method]({ ...fetchOptions, background: true });
    if (call !== latest) return;
    void store.prefetchNearby([DATASET[method], ...(options.alsoPrefetch?.() ?? [])]);
  }

  onMounted(() => {
    void store.watchIndexUpdates();
    store.fetchAvailableRepos();
    void load();
  });

  watch(
    [() => store.selectedRepo, () => store.selectedSource, () => store.dateRange],
    () => {
      void load();
    },
    { deep: true },
  );

  // A reindex can finish at any time, often just after the page has loaded.
  watch(
    () => store.dataRevision,
    () => {
      void load();
    },
  );

  onScopeDispose(() => {
    latest += 1;
    store.cancelPrefetch();
  });

  return { store };
}
