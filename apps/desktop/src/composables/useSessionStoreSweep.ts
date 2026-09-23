import { refreshSessionEnrichment } from "@tracepilot/client";
import { onBeforeUnmount, watch } from "vue";
import { logWarn } from "@/utils/logger";

export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** The main window refreshes after bootstrap and periodically while open. */
export function useSessionStoreSweep(ready: () => boolean) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let disposed = false;

  async function sweep() {
    if (disposed || inFlight || !ready()) return;
    inFlight = true;
    try {
      // Disabled passes purge cached evidence too. Retrying them matters if
      // a toggle initially races a running index operation.
      await refreshSessionEnrichment();
    } catch (error) {
      logWarn("[session-store] Background refresh deferred:", error);
    } finally {
      inFlight = false;
    }
  }

  // Settings persists a toggle before refreshing. Starting a second sweep
  // from the flag watcher would race that save and occupy the indexing gate.
  const stopWatch = watch(ready, () => void sweep());
  function setup() {
    if (timer !== null || disposed) return;
    void sweep();
    timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  }
  function cleanup() {
    disposed = true;
    stopWatch();
    if (timer !== null) clearInterval(timer);
    timer = null;
  }
  onBeforeUnmount(cleanup);
  return { setup, cleanup, sweep };
}
