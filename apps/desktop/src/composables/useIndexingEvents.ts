import { onBeforeUnmount } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { IndexingProgressPayload } from '@tracepilot/types'

export interface IndexingEventsCallbacks {
  onStarted: () => void
  onProgress: (payload: IndexingProgressPayload) => void
  onFinished: () => void
}

/**
 * Manages Tauri event listeners for the indexing lifecycle.
 *
 * - Call `setup()` in onMounted (before triggering indexing) to register listeners
 * - Listeners are automatically cleaned up on unmount
 */
export function useIndexingEvents(callbacks: IndexingEventsCallbacks) {
  let unlistenStarted: UnlistenFn | null = null
  let unlistenProgress: UnlistenFn | null = null
  let unlistenFinished: UnlistenFn | null = null

  /** Register all Tauri event listeners. Must be awaited. */
  async function setup() {
    unlistenStarted = await listen('indexing-started', () => {
      callbacks.onStarted()
    })

    unlistenProgress = await listen<IndexingProgressPayload>('indexing-progress', (event) => {
      callbacks.onProgress(event.payload)
    })

    unlistenFinished = await listen('indexing-finished', () => {
      callbacks.onFinished()
    })
  }

  function cleanup() {
    unlistenStarted?.()
    unlistenProgress?.()
    unlistenFinished?.()
    unlistenStarted = null
    unlistenProgress = null
    unlistenFinished = null
  }

  onBeforeUnmount(cleanup)

  return { setup, cleanup }
}
