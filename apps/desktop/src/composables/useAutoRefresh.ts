import { onBeforeUnmount, type Ref, ref, watch } from "vue";

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
 * - Manual refresh resets the auto-refresh clock (no rapid double-refresh)
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
    // Cancel any pending auto-refresh so that manual refresh resets the clock.
    // This prevents a rapid double-refresh when the user refreshes shortly
    // before the timer would have fired naturally.
    stopTimer();
    try {
      await onRefresh();
    } finally {
      refreshing.value = false;
      // Reschedule: the next auto-refresh is a full interval from now.
      // refresh() is the single owner of post-refresh rescheduling —
      // whether invoked manually or by the timer callback.
      if (!disposed && enabled.value) scheduleNext();
    }
  }

  function scheduleNext() {
    stopTimer();
    if (disposed || !enabled.value || document.hidden) return;
    timer = setTimeout(async () => {
      if (disposed) return;
      // Swallow any error thrown by onRefresh so the unhandled-rejection handler
      // is not triggered. Errors are still rethrown on the manual-refresh code path.
      // The loop continues because refresh() reschedules in its finally block.
      try {
        await refresh();
      } catch {
        // intentionally ignored — onRefresh is responsible for its own error handling
      }
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
  const unwatchEnabled = watch(
    enabled,
    (val) => {
      if (disposed) return;
      if (val) {
        scheduleNext();
      } else {
        stopTimer();
      }
    },
    { immediate: true },
  );

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
