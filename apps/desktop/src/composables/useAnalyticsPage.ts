import { onMounted, watch } from "vue";
import { useAnalyticsStore } from "@/stores/analytics";

type AnalyticsFetchMethod = "fetchAnalytics" | "fetchToolAnalysis" | "fetchCodeImpact";

/**
 * Shared lifecycle boilerplate for analytics pages.
 *
 * Fetches available repositories on mount, invokes the named fetch method,
 * and re-fetches whenever the selected repository or date range changes.
 * Results are cached per filter combination, so switching back to a range
 * that was already loaded is instant; the store drops those caches when a
 * reindex finishes and bumps `dataRevision`, which triggers one refetch here.
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
    [() => store.selectedRepo, () => store.dateRange, () => store.dataRevision],
    () => {
      store[method]();
    },
    { deep: true },
  );

  return { store };
}
