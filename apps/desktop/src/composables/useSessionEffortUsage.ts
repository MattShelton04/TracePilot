/**
 * useSessionEffortUsage — the open session's user turns per model and
 * reasoning effort. Reloads when the session changes or its event log grows,
 * so a running session's latest requests appear.
 */
import { getSessionEffortUsage } from "@tracepilot/client";
import type { SessionEffortUsage } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { ref, watch } from "vue";
import type { SessionDetailContext } from "@/composables/useSessionDetail";

export function useSessionEffortUsage(store: SessionDetailContext) {
  const usage = ref<SessionEffortUsage | null>(null);
  const error = ref<string | null>(null);
  let request = 0;

  async function load(sessionId: string) {
    const current = ++request;
    try {
      const response = await getSessionEffortUsage(sessionId);
      if (current !== request) return;
      usage.value = response.usage;
      error.value = null;
    } catch (cause) {
      if (current !== request) return;
      error.value = toErrorMessage(cause);
    }
  }

  watch(
    () => [store.sessionId, store.detail?.eventCount] as const,
    ([sessionId], previous) => {
      if (previous && sessionId !== previous[0]) usage.value = null;
      if (sessionId) void load(sessionId);
    },
    { immediate: true },
  );

  function retry() {
    if (store.sessionId) void load(store.sessionId);
  }

  return { usage, error, retry };
}
