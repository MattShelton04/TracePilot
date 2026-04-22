import type { UnlistenFn } from "@tauri-apps/api/event";
import type { IndexingProgressPayload } from "@tracepilot/types";
import { IPC_EVENTS } from "@tracepilot/client";
import { onBeforeUnmount } from "vue";
import { safeListen } from "@/utils/tauriEvents";

export interface IndexingEventsCallbacks {
  onStarted: () => void;
  onProgress: (payload: IndexingProgressPayload) => void;
  onFinished: () => void;
}

/**
 * Manages Tauri event listeners for the indexing lifecycle.
 *
 * - Call `setup()` in onMounted (before triggering indexing) to register listeners
 * - Listeners are automatically cleaned up on unmount
 */
export function useIndexingEvents(callbacks: IndexingEventsCallbacks) {
  let unlistenStarted: UnlistenFn | null = null;
  let unlistenProgress: UnlistenFn | null = null;
  let unlistenFinished: UnlistenFn | null = null;

  /** Register all Tauri event listeners. Must be awaited. */
  async function setup() {
    unlistenStarted = await safeListen(IPC_EVENTS.INDEXING_STARTED, () => {
      callbacks.onStarted();
    });

    unlistenProgress = await safeListen<IndexingProgressPayload>(IPC_EVENTS.INDEXING_PROGRESS, (event) => {
      callbacks.onProgress(event.payload);
    });

    unlistenFinished = await safeListen(IPC_EVENTS.INDEXING_FINISHED, () => {
      callbacks.onFinished();
    });
  }

  function cleanup() {
    unlistenStarted?.();
    unlistenProgress?.();
    unlistenFinished?.();
    unlistenStarted = null;
    unlistenProgress = null;
    unlistenFinished = null;
  }

  onBeforeUnmount(cleanup);

  return { setup, cleanup };
}
