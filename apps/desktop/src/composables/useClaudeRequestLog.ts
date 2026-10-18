import { getSessionRequestLog } from "@tracepilot/client";
import type { RecordedShape, RequestLog } from "@tracepilot/types";
import { toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { computed, type MaybeRefOrGetter, ref, toValue, watch } from "vue";

/**
 * What Claude Code recorded of a session's API requests, loaded when the
 * "Recorded requests" view opens and again for each session. A late answer
 * for an earlier session is dropped.
 */
export function useClaudeRequestLog(sessionId: MaybeRefOrGetter<string | null | undefined>) {
  const guard = useAsyncGuard();
  const log = ref<RequestLog | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const selectedHash = ref<string | null>(null);

  async function load() {
    const id = toValue(sessionId);
    const token = guard.start();
    if (!id) {
      log.value = null;
      loading.value = false;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const result = await getSessionRequestLog(id);
      if (!guard.isValid(token)) return;
      log.value = result;
      if (!result.shapes.some((shape) => shape.hash === selectedHash.value)) {
        selectedHash.value = result.shapes[0]?.hash ?? null;
      }
    } catch (cause) {
      if (guard.isValid(token)) error.value = toErrorMessage(cause);
    } finally {
      if (guard.isValid(token)) loading.value = false;
    }
  }

  watch(
    () => toValue(sessionId),
    () => {
      log.value = null;
      selectedHash.value = null;
      void load();
    },
    { immediate: true },
  );

  const selectedShape = computed<RecordedShape | null>(
    () => log.value?.shapes.find((shape) => shape.hash === selectedHash.value) ?? null,
  );
  /** Recorded before Claude Code 2.1.301, which wrote no request records. */
  const isEmpty = computed(() => log.value != null && log.value.records === 0);

  return { log, loading, error, selectedHash, selectedShape, isEmpty, reload: load };
}
