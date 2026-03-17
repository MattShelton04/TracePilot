import { ref, watch, onBeforeUnmount, type Ref } from "vue";

export interface AutoRefreshOptions {
  /** Callback to invoke on each refresh tick. */
  onRefresh: () => Promise<void> | void;
  /** Whether auto-refresh is enabled. */
  enabled?: Ref<boolean>;
  /** Interval in seconds. */
  intervalSeconds?: Ref<number>;
}

/**
 * Composable for manual + auto-refresh with debounce protection.
 *
 * Features:
 * - Manual refresh with in-flight guard (no double-fetches)
 * - Auto-refresh with configurable interval
 * - Pauses when document tab is hidden (Page Visibility API)
 * - Cleans up on unmount
 */
export function useAutoRefresh(options: AutoRefreshOptions) {
  const { onRefresh } = options;
  const enabled = options.enabled ?? ref(false);
  const intervalSeconds = options.intervalSeconds ?? ref(5);
  const refreshing = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  async function refresh() {
    if (refreshing.value) return;
    refreshing.value = true;
    try {
      await onRefresh();
    } finally {
      refreshing.value = false;
    }
  }

  function scheduleNext() {
    stopTimer();
    if (disposed || !enabled.value || document.hidden) return;
    timer = setTimeout(async () => {
      if (disposed) return;
      await refresh();
      if (!disposed) scheduleNext();
    }, intervalSeconds.value * 1000);
  }

  function stopTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // Pause/resume on visibility change
  function handleVisibility() {
    if (disposed) return;
    if (document.hidden) {
      stopTimer();
    } else if (enabled.value) {
      scheduleNext();
    }
  }
  document.addEventListener("visibilitychange", handleVisibility);

  // Watch enabled flag
  const unwatchEnabled = watch(enabled, (val) => {
    if (disposed) return;
    if (val) {
      scheduleNext();
    } else {
      stopTimer();
    }
  }, { immediate: true });

  // Watch interval changes — restart timer with new interval
  const unwatchInterval = watch(intervalSeconds, () => {
    if (!disposed && enabled.value) {
      scheduleNext();
    }
  });

  onBeforeUnmount(() => {
    disposed = true;
    stopTimer();
    document.removeEventListener("visibilitychange", handleVisibility);
    unwatchEnabled();
    unwatchInterval();
  });

  return {
    refresh,
    refreshing,
    enabled,
    intervalSeconds,
  };
}
