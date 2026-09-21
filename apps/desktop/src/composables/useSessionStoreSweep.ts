import { IPC_EVENTS, refreshSessionEnrichment } from "@tracepilot/client";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onBeforeUnmount, ref } from "vue";
import { safeListen } from "@/utils/tauriEvents";

/**
 * How often an idle app re-reads the Copilot session store.
 *
 * The store has no change feed — no tombstones, no per-row version — so the
 * only way to notice that the CLI recorded new requests, or rebuilt the file
 * entirely, is to look again. Five minutes is the design's starting point: a
 * tunable figure, not a measured guarantee.
 */
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Keep enrichment current in the background, and expose a revision that
 * bumps whenever a sweep changed something.
 *
 * Views watch `revision` rather than re-reading on a timer of their own: the
 * enrichment tables move independently of `events.jsonl`, so a session's
 * file fingerprint can be unchanged while its request ledger has grown. A
 * sweep that found nothing new leaves the revision alone, so a quiet app
 * does not churn every open view every five minutes.
 */
export function useSessionStoreSweep(enabled: () => boolean) {
  const revision = ref(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  let unlistenFinished: UnlistenFn | null = null;
  let inFlight = false;

  async function sweep() {
    // The backend gate already refuses a concurrent pass, but skipping here
    // avoids a pointless round trip when a manual refresh is running.
    if (inFlight || !enabled()) return;
    inFlight = true;
    try {
      const outcome = await refreshSessionEnrichment();
      if (outcome.refreshed > 0) revision.value += 1;
    } catch {
      // A busy or absent source is the expected quiet case, and this runs on
      // a timer — surfacing it would mean a recurring error the user cannot
      // act on. Settings shows the source's real state on demand.
    } finally {
      inFlight = false;
    }
  }

  async function setup() {
    unlistenFinished = await safeListen(IPC_EVENTS.ENRICHMENT_FINISHED, () => {
      revision.value += 1;
    });
    // One sweep at startup, then on the interval. The startup pass is what
    // picks up requests the CLI recorded while the app was closed.
    void sweep();
    timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  }

  function cleanup() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    unlistenFinished?.();
    unlistenFinished = null;
  }

  onBeforeUnmount(cleanup);

  return { revision, setup, cleanup, sweep };
}
