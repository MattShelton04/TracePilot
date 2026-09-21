/**
 * useSessionWorkRefs — linked-work references for the current session.
 *
 * Reads the optional Copilot session store through `@tracepilot/client`. The
 * three "nothing to show" cases are kept apart deliberately: the feature being
 * off, the source being unreadable, and the source having recorded no
 * references are different statements, and only the last one is about this
 * session.
 */
import { getSessionWorkRefs } from "@tracepilot/client";
import type { SessionWorkRefsResponse, StoreAvailability } from "@tracepilot/types";
import { toErrorMessage, useAsyncGuard, useSessionTabLoader } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { useSessionStoreEvents } from "@/composables/useSessionStoreEvents";
import { usePreferencesStore } from "@/stores/preferences";
import { logWarn } from "@/utils/logger";
import { toWorkRefRows } from "@/utils/workRefs";

export function useSessionWorkRefs(getSessionId: () => string | null | undefined) {
  const preferences = usePreferencesStore();
  const enabled = computed(() => preferences.isFeatureEnabled("sessionStoreEnrichment"));

  const guard = useAsyncGuard();
  const response = ref<SessionWorkRefsResponse | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load() {
    const sessionId = getSessionId();
    if (!sessionId || !enabled.value) return;
    const token = guard.start();
    error.value = null;
    loading.value = true;
    try {
      const result = await getSessionWorkRefs(sessionId);
      if (guard.isValid(token)) response.value = result;
    } catch (e) {
      // An optional enrichment source must never break the overview, so the
      // failure is surfaced in place rather than thrown at the tab.
      logWarn("[useSessionWorkRefs] Failed to read linked-work references:", e);
      if (guard.isValid(token)) error.value = toErrorMessage(e);
    } finally {
      if (guard.isValid(token)) loading.value = false;
    }
  }

  useSessionStoreEvents(load);

  useSessionTabLoader(() => (enabled.value ? getSessionId() : null), load, {
    onClear: () => {
      guard.invalidate();
      loading.value = false;
      response.value = null;
      error.value = null;
    },
  });

  const rows = computed(() => toWorkRefRows(response.value?.refs ?? []));

  /** False only when a source could not be consulted at all. */
  const sourceAvailable = computed(() => response.value?.available ?? false);

  const sourceAvailability = computed<StoreAvailability | null>(
    () => response.value?.sourceAvailability ?? null,
  );

  /** True when the source answered and recorded no references for this session. */
  const emptyForSession = computed(
    () => response.value !== null && sourceAvailable.value && rows.value.length === 0,
  );

  function retry() {
    error.value = null;
    void load();
  }

  return {
    enabled,
    loading,
    error,
    rows,
    sourceAvailable,
    sourceAvailability,
    emptyForSession,
    loaded: computed(() => response.value !== null),
    retry,
  };
}
