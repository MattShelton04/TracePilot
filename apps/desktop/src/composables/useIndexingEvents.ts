import type { UnlistenFn } from "@tauri-apps/api/event";
import { IPC_EVENTS } from "@tracepilot/client";
import type { IndexingProgressPayload } from "@tracepilot/types";
import { onBeforeUnmount } from "vue";
import { safeListen } from "@/utils/tauriEvents";

export interface IndexingEventsCallbacks {
  onStarted: () => void;
  onProgress: (payload: IndexingProgressPayload) => void;
  onFinished: () => void;
  /**
   * A search-index pass finished. Search rebuilds emit only search-indexing
   * events, so anything that reads the index size listens here too.
   */
  onSearchIndexingFinished?: () => void;
}

/**
 * Manages Tauri event listeners for the indexing lifecycle.
 *
 * - Call `setup()` in onMounted (before triggering indexing) to register listeners
 * - Listeners are automatically cleaned up on unmount, including any that
 *   finish registering afterwards
 */
export function useIndexingEvents(callbacks: IndexingEventsCallbacks) {
  let unlisteners: UnlistenFn[] = [];
  let disposed = false;

  function keep(unlisten: UnlistenFn) {
    if (disposed) unlisten();
    else unlisteners.push(unlisten);
  }

  /** Register all Tauri event listeners. Must be awaited. */
  async function setup() {
    keep(
      await safeListen(IPC_EVENTS.INDEXING_STARTED, () => {
        callbacks.onStarted();
      }),
    );

    keep(
      await safeListen<IndexingProgressPayload>(IPC_EVENTS.INDEXING_PROGRESS, (event) => {
        callbacks.onProgress(event.payload);
      }),
    );

    keep(
      await safeListen(IPC_EVENTS.INDEXING_FINISHED, () => {
        callbacks.onFinished();
      }),
    );

    const onSearchFinished = callbacks.onSearchIndexingFinished;
    if (onSearchFinished) {
      keep(await safeListen(IPC_EVENTS.SEARCH_INDEXING_FINISHED, () => onSearchFinished()));
    }
  }

  function cleanup() {
    for (const unlisten of unlisteners) unlisten();
    unlisteners = [];
  }

  function dispose() {
    disposed = true;
    cleanup();
  }

  onBeforeUnmount(dispose);

  return { setup, cleanup };
}
