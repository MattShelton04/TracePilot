import { watch } from "vue";

/**
 * Composable that watches a reactive sessionId and calls a loader function
 * whenever it changes. Replaces the 5 identical watch patterns across tab views.
 */
export function useSessionTabLoader(
  getSessionId: () => string | null | undefined,
  loadFn: () => Promise<void> | void,
  options?: { onClear?: () => void }
) {
  watch(
    getSessionId,
    (id) => {
      if (options?.onClear) options.onClear();
      if (!id) return;
      void loadFn();
    },
    { immediate: true }
  );
}
