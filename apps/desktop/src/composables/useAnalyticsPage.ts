import { onMounted, watch } from 'vue';
import { useAnalyticsStore } from '@/stores/analytics';

/**
 * Shared lifecycle boilerplate for analytics pages.
 *
 * Fetches available repositories on mount, invokes the given fetch function,
 * and re-fetches (with `force: true`) whenever the selected repository or
 * date range changes.
 *
 * **Important:** `fetchFn` is only called asynchronously (inside `onMounted`
 * and `watch` callbacks). Callers may reference variables that are assigned
 * from the return value of this function inside the callback — this is safe
 * because the callback is never invoked synchronously.
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
