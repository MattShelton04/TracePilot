/**
 * useObservedRequestPerformance — recorded request latency and cache reuse
 * across sessions, for Model Comparison.
 *
 * The figures come from the Copilot CLI's own session store, so the three
 * "nothing to show" answers stay apart: the feature is off, no source could
 * be read (`available: false`), or the source was read and the current
 * repository/date filters matched no requests. Only the last one is a
 * statement about the user's work.
 */

import { getModelRequestPerformance } from "@tracepilot/client";
import type {
  ModelRequestPerformance,
  RequestPerformance,
  RequestPerformanceFilters,
  RequestPerformanceReport,
} from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/types";
import { useAsyncGuard } from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { useAnalyticsStore } from "@/stores/analytics";
import { usePreferencesStore } from "@/stores/preferences";
import { logWarn } from "@/utils/logger";
import { useSessionStoreEvents } from "./useSessionStoreEvents";

export function useObservedRequestPerformance() {
  const prefs = usePreferencesStore();
  const analytics = useAnalyticsStore();
  const guard = useAsyncGuard();

  const enabled = computed(() => prefs.isFeatureEnabled("sessionStoreEnrichment"));
  const report = ref<RequestPerformanceReport | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** The page's own repository and date filters, sent to the backend as-is. */
  const filters = computed<RequestPerformanceFilters>(() => ({
    fromDate: analytics.dateRange.fromDate ?? null,
    toDate: analytics.dateRange.toDate ?? null,
    repository: analytics.selectedRepo,
  }));

  async function load(): Promise<void> {
    if (!enabled.value) return;
    const token = guard.start();
    loading.value = true;
    error.value = null;
    try {
      const response = await getModelRequestPerformance(filters.value);
      if (!guard.isValid(token)) return;
      report.value = response.report;
    } catch (e) {
      // An optional enrichment source must never take the page down with it.
      logWarn("[useObservedRequestPerformance] Failed to read request performance:", e);
      if (guard.isValid(token)) error.value = toErrorMessage(e);
    } finally {
      if (guard.isValid(token)) loading.value = false;
    }
  }

  watch(
    [enabled, filters],
    () => {
      guard.invalidate();
      report.value = null;
      error.value = null;
      loading.value = false;
      if (enabled.value) void load();
    },
    { immediate: true, deep: true },
  );
  useSessionStoreEvents(load);

  /** False means no source could be read — never "this user made no requests". */
  const available = computed(() => report.value?.available ?? false);
  const overall = computed<RequestPerformance | null>(() => report.value?.overall ?? null);
  const byModel = computed<ModelRequestPerformance[]>(() => report.value?.byModel ?? []);
  /** Sessions behind the sample, so a one-session-dominated shape is visible. */
  const sessionCount = computed(() => report.value?.sessionCount ?? 0);

  /** The source answered and the current filters matched no requests. */
  const emptyForFilters = computed(
    () => available.value && (overall.value?.requestCount ?? 0) === 0,
  );

  function retry(): void {
    error.value = null;
    void load();
  }

  return {
    enabled,
    loading,
    error,
    report,
    available,
    overall,
    byModel,
    sessionCount,
    emptyForFilters,
    loaded: computed(() => report.value !== null),
    retry,
  };
}

export type ObservedRequestPerformance = ReturnType<typeof useObservedRequestPerformance>;
