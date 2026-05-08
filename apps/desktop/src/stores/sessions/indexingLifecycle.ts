import { reindexSessions } from "@tracepilot/client";
import type { SessionListItem } from "@tracepilot/types";
import { runAction, toErrorMessage, useInflightPromise } from "@tracepilot/ui";
import type { Ref, ShallowRef } from "vue";
import { isAlreadyIndexingError } from "@/utils/backendErrors";
import { logError, logWarn } from "@/utils/logger";

export interface IndexingLifecycleDeps {
  /** Backing session list — wholesale-replaced on every fetch/refresh. */
  sessions: ShallowRef<SessionListItem[]>;
  loading: Ref<boolean>;
  indexing: Ref<boolean>;
  error: Ref<string | null>;
  /** Backend session-list fetcher (typically `listSessions`). */
  fetchAllSessions: () => Promise<SessionListItem[]>;
}

export interface IndexingLifecycle {
  fetchSessions: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  reindex: () => Promise<void>;
  ensureIndex: (opts?: { force?: boolean }) => Promise<void>;
}

/** Minimum interval between background ensureIndex calls (2 min). */
const MIN_INDEX_INTERVAL_MS = 2 * 60 * 1000;

/**
 * Indexing throttle + cache + dedupe state machine for the sessions store.
 *
 * Owns three in-flight slots (fetch, index, post-index refresh) plus the
 * `lastIndexedAt` throttle. Pure factory — no Pinia, no Vue lifecycle
 * beyond reading/writing the refs that the store passes in.
 */
export function createIndexingLifecycle(deps: IndexingLifecycleDeps): IndexingLifecycle {
  const { sessions, loading, indexing, error, fetchAllSessions } = deps;

  // Both fetchSessions and refreshSessions share this slot so a silent
  // background refresh coalesces with any concurrent explicit fetch.
  const fetchInflight = useInflightPromise<void>();
  const indexInflight = useInflightPromise<[number, number]>();
  const postIndexRefreshInflight = useInflightPromise<SessionListItem[]>();
  let lastIndexedAt = 0;

  async function fetchSessions() {
    const existing = fetchInflight.current();
    if (existing) return existing;
    return fetchInflight.run(async () => {
      await runAction({
        loading,
        error,
        action: fetchAllSessions,
        onSuccess: (result) => {
          sessions.value = result;
        },
      });
    });
  }

  async function refreshSessions() {
    const existing = fetchInflight.current();
    if (existing) return existing;
    return fetchInflight.run(async () => {
      try {
        sessions.value = await fetchAllSessions();
        error.value = null;
      } catch (e) {
        logError("[sessions] Silent refresh failed:", e);
      }
    });
  }

  async function refreshSessionsAfterIndex() {
    return postIndexRefreshInflight.run(() => fetchAllSessions());
  }

  async function reindex() {
    const existingIndex = indexInflight.current();
    if (existingIndex) {
      try {
        await existingIndex;
        sessions.value = await refreshSessionsAfterIndex();
      } catch (e) {
        if (!isAlreadyIndexingError(e)) {
          error.value = toErrorMessage(e);
        }
      }
      return;
    }

    await runAction({
      loading: indexing,
      error,
      action: async () => {
        try {
          await indexInflight.run(() => reindexSessions());
        } catch (e) {
          if (!isAlreadyIndexingError(e)) {
            throw e;
          }
        }
        return refreshSessionsAfterIndex();
      },
      onSuccess: (result) => {
        sessions.value = result;
      },
    });
  }

  /**
   * Ensure the index is up-to-date without blocking the UI.
   *
   * Throttled to at most once per `MIN_INDEX_INTERVAL_MS` to avoid redundant
   * reindexes when the user navigates back to the session list. The periodic
   * auto-refresh path passes `force: true` to bypass the throttle so newly
   * created sessions on disk become visible on the next tick. The reindex
   * itself is incremental and cheap; coalescing is handled via
   * `indexInflight` so a genuinely concurrent reindex won't be duplicated.
   */
  async function ensureIndex(opts: { force?: boolean } = {}) {
    const force = opts.force ?? false;
    const existingIndex = indexInflight.current();
    if (existingIndex) {
      try {
        await existingIndex;
      } catch (e) {
        logWarn("[sessions] Background reindex in progress failed", e);
      }
      try {
        sessions.value = await refreshSessionsAfterIndex();
      } catch (e) {
        logWarn("[sessions] Failed to refresh session list after background reindex", e);
      }
      return;
    }

    if (!force && Date.now() - lastIndexedAt < MIN_INDEX_INTERVAL_MS) {
      await refreshSessions();
      return;
    }

    try {
      await indexInflight.run(() => reindexSessions());
      lastIndexedAt = Date.now();
      sessions.value = await refreshSessionsAfterIndex();
    } catch (e) {
      // Silent — this is a background optimization, not user-initiated
      logWarn("[sessions] Background ensureIndex failed", e);
    }
  }

  return {
    fetchSessions,
    refreshSessions,
    reindex,
    ensureIndex,
  };
}
