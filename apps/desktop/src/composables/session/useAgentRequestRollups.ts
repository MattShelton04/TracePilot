/**
 * useAgentRequestRollups — per-agent recorded request figures for a session.
 *
 * Read from the Copilot CLI's own session store, so "the feature is off",
 * "no source could be read" and "the source recorded nothing for this
 * session" stay three separate answers. The caller keeps its shutdown-based
 * agent totals either way: these roll-ups add columns, they do not replace
 * a total whose coverage they cannot match.
 */

import { getAgentRequestRollups } from "@tracepilot/client";
import type { AgentRequestRollup, AgentRequestRollupResponse } from "@tracepilot/types";
import { toErrorMessage, useAsyncGuard, useSessionTabLoader } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { useSessionStoreEvents } from "@/composables/useSessionStoreEvents";
import { usePreferencesStore } from "@/stores/preferences";
import { logWarn } from "@/utils/logger";

export function useAgentRequestRollups(getSessionId: () => string | null | undefined) {
  const preferences = usePreferencesStore();
  const enabled = computed(() => preferences.isFeatureEnabled("sessionStoreEnrichment"));

  const guard = useAsyncGuard();
  const response = ref<AgentRequestRollupResponse | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(): Promise<void> {
    const sessionId = getSessionId();
    if (!sessionId || !enabled.value) return;
    const token = guard.start();
    error.value = null;
    loading.value = true;
    try {
      const result = await getAgentRequestRollups(sessionId);
      if (guard.isValid(token)) response.value = result;
    } catch (e) {
      // The shutdown-based breakdown must survive an unreadable store.
      logWarn("[useAgentRequestRollups] Failed to read agent request roll-ups:", e);
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

  /** False only when no source could be consulted at all. */
  const available = computed(() => response.value?.available ?? false);
  const rollups = computed<AgentRequestRollup[]>(() => response.value?.rollups ?? []);

  return {
    enabled,
    loading,
    error,
    available,
    rollups,
    loaded: computed(() => response.value !== null),
  };
}

export type AgentRequestRollups = ReturnType<typeof useAgentRequestRollups>;
