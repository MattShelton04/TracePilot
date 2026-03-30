import { onMounted, watch } from "vue";
import { useAnalyticsStore } from "@/stores/analytics";

type AnalyticsFetchMethod = "fetchAnalytics" | "fetchToolAnalysis" | "fetchCodeImpact";

/**
 * Shared lifecycle boilerplate for analytics pages.
 *
 * Fetches available repositories on mount, invokes the named fetch method,
 * and re-fetches (with `force: true`) whenever the selected repository or
 * date range changes.
 *
 * @param method - The store fetch method name to call.
 * @returns The analytics store instance for convenient destructuring.
 */
export function useAnalyticsPage(method: AnalyticsFetchMethod) {
  const store = useAnalyticsStore();

  onMounted(() => {
    store.fetchAvailableRepos();
    store[method]();
  });

  watch(
    [() => store.selectedRepo, () => store.dateRange],
    () => {
      store[method]({ force: true });
    },
    { deep: true },
  );

  return { store };
}
