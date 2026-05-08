/**
 * useReplaySessionLoader — owns session detail loading for SessionReplayView.
 *
 * Watches a reactive session id and orchestrates the same fetch sequence the
 * view used to perform inline (detail → turns + todos + shutdownMetrics) with a
 * stale-request token guard so out-of-order responses for an old session id
 * cannot flip `initialLoading` back to false against a newer load. No DOM
 * access; safe to call inside any setup() context.
 */

import { onScopeDispose, type Ref, ref, watch } from "vue";
import type { SessionDetailContext } from "@/composables/useSessionDetail";

export interface ReplaySessionLoader {
  initialLoading: Ref<boolean>;
  loadSession: (id: string) => Promise<void>;
  retryLoadTurns: () => void;
  dispose: () => void;
}

export function useReplaySessionLoader(
  store: SessionDetailContext,
  sessionId: Ref<string | undefined>,
): ReplaySessionLoader {
  const initialLoading = ref(false);
  let loadToken = 0;
  let disposed = false;

  async function loadSession(id: string) {
    const token = ++loadToken;
    initialLoading.value = true;
    try {
      await store.loadDetail(id);
      if (token !== loadToken || disposed) return;
      await Promise.all([store.loadTurns(), store.loadTodos(), store.loadShutdownMetrics()]);
    } finally {
      if (token === loadToken) {
        initialLoading.value = false;
      }
    }
  }

  function retryLoadTurns() {
    store.loaded.delete("turns");
    store.loadTurns();
  }

  const stopWatch = watch(
    sessionId,
    (id) => {
      if (id) loadSession(id);
    },
    { immediate: true },
  );

  function dispose() {
    if (disposed) return;
    disposed = true;
    // Invalidate any inflight load so its `finally` cannot toggle state.
    loadToken++;
    stopWatch();
  }

  onScopeDispose(dispose);

  return { initialLoading, loadSession, retryLoadTurns, dispose };
}
