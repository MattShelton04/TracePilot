import { onMounted, watch } from 'vue';
import { useAnalyticsStore } from '@/stores/analytics';

/**
 * Shared lifecycle boilerplate for analytics pages.
 *
 * Fetches available repositories on mount, invokes the given fetch function,
 * and re-fetches (with `force: true`) whenever the selected repository or
 * date range changes.
 *
 * @param fetchFn - The store fetch action to call (e.g. `store.fetchAnalytics`).
 * @returns The analytics store instance for convenient destructuring.
 */
export function useAnalyticsPage(fetchFn: (opts?: { force?: boolean }) => Promise<void>) {
  const store = useAnalyticsStore();

  onMounted(() => {
    store.fetchAvailableRepos();
    fetchFn();
  });

  watch(
    [() => store.selectedRepo, () => store.dateRange],
    () => { fetchFn({ force: true }); },
    { deep: true },
  );

  return { store };
}
