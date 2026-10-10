import { onMounted, watch } from "vue";
import { useAnalyticsStore } from "@/stores/analytics";

type AnalyticsFetchMethod = "fetchAnalytics" | "fetchToolAnalysis" | "fetchCodeImpact";

/**
 * Shared lifecycle boilerplate for analytics pages.
 *
 * Fetches available repositories on mount, invokes the named fetch method,
 * and re-fetches whenever the selected repository, source or date range
 * changes.
 * Results are cached per filter combination, so switching back to a range
 * that was already loaded is instant; the store drops those caches when a
 * reindex finishes and bumps `dataRevision`, which triggers one background
 * refetch here that keeps the current results on screen until it lands.
 *
 * @param method - The store fetch method name to call.
 * @returns The analytics store instance for convenient destructuring.
 */
export function useAnalyticsPage(method: AnalyticsFetchMethod) {
  const store = useAnalyticsStore();

  onMounted(() => {
    void store.watchIndexUpdates();
    store.fetchAvailableRepos();
    store[method]();
  });

  watch(
    [() => store.selectedRepo, () => store.selectedSource, () => store.dateRange],
    () => {
      store[method]();
    },
    { deep: true },
  );

  // A reindex can finish at any time, often just after the page has loaded.
  // Refresh in place so the page keeps its layout instead of flashing back
  // to the loading state.
  watch(
    () => store.dataRevision,
    () => {
      store[method]({ background: true });
    },
  );

  return { store };
}
