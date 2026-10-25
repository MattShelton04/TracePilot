import { reindexSessions } from "@tracepilot/client";
import type { SessionListItem } from "@tracepilot/types";
import { runAction, toErrorMessage, useInflightPromise } from "@tracepilot/ui";
import { type Ref, type ShallowRef, watch } from "vue";
import { isAlreadyIndexingError } from "@/utils/backendErrors";
import { logDebug, logError, logWarn } from "@/utils/logger";

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
  /** Reload after an index pass, never settling for a read that predates it. */
  refreshAfterIndexPass: () => Promise<void>;
  reindex: () => Promise<void>;
  ensureIndex: (opts?: EnsureIndexOptions) => Promise<void>;
}

export interface EnsureIndexOptions {
  /** Reindex even inside the throttle window. */
  force?: boolean;
  /** The user asked for it (Refresh, Retry): a failure shows in `error`. */
  userInitiated?: boolean;
}

/** Minimum interval between background ensureIndex calls (2 min). */
const MIN_INDEX_INTERVAL_MS = 2 * 60 * 1000;

function refreshFailureMessage(e: unknown): string {
  return `Couldn't refresh sessions: ${toErrorMessage(e)}`;
}

/**
 * Indexing throttle + cache + dedupe state machine for the sessions store.
 *
 * Owns three in-flight slots (fetch, index, post-index refresh) plus the
 * `lastIndexedAt` throttle. Pure factory — no Pinia, no Vue lifecycle
 * beyond reading/writing (and synchronously watching) the refs that the
 * store passes in.
 */
export function createIndexingLifecycle(deps: IndexingLifecycleDeps): IndexingLifecycle {
  const { sessions, loading, indexing, error, fetchAllSessions } = deps;

  // Both fetchSessions and refreshSessions share this slot so a silent
  // background refresh coalesces with any concurrent explicit fetch.
  const fetchInflight = useInflightPromise<void>();
  const indexInflight = useInflightPromise<[number, number]>();
  const postIndexRefreshInflight = useInflightPromise<SessionListItem[]>();
  let lastIndexedAt = 0;

  // Bumped whenever an error is shown. A reload that succeeds clears only an
  // error already showing when it started: the backend announces a pass
  // finished before its command rejects, so the reload that announcement
  // starts can land after the failure it must not hide.
  let errorEpoch = 0;
  watch(
    error,
    (value) => {
      if (value !== null) errorEpoch++;
    },
    { flush: "sync" },
  );
  function showError(message: string) {
    errorEpoch++; // also when the same message shows again
    error.value = message;
  }
  function clearErrorShownBefore(epoch: number) {
    if (errorEpoch === epoch) error.value = null;
  }

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
      const epoch = errorEpoch;
      try {
        sessions.value = await fetchAllSessions();
        clearErrorShownBefore(epoch);
      } catch (e) {
        logError("[sessions] Silent refresh failed:", e);
      }
    });
  }

  /**
   * Reload the list after an index pass finished elsewhere. A read already in
   * flight may predate the pass, so wait for it and read once more; reads
   * started once it settles coalesce onto that one trailing read.
   */
  async function refreshAfterIndexPass() {
    const existing = fetchInflight.current();
    if (existing) {
      try {
        await existing;
      } catch {
        // The earlier read reports its own failure; the trailing read still runs.
      }
    }
    return refreshSessions();
  }

  async function refreshSessionsAfterIndex() {
    return postIndexRefreshInflight.run(() => fetchAllSessions());
  }

  async function reindex() {
    const existingIndex = indexInflight.current();
    if (existingIndex) {
      const epoch = errorEpoch;
      try {
        await existingIndex;
        sessions.value = await refreshSessionsAfterIndex();
        clearErrorShownBefore(epoch);
      } catch (e) {
        if (!isAlreadyIndexingError(e)) {
          showError(toErrorMessage(e));
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
   *
   * Background calls stay silent on failure. A `userInitiated` call (the
   * Refresh button, Retry) reports its failure in `error`. Any call that
   * reloads the list clears an `error` already showing when it started.
   */
  async function ensureIndex(opts: EnsureIndexOptions = {}) {
    const force = opts.force ?? false;
    const userInitiated = opts.userInitiated ?? false;
    const epoch = errorEpoch;
    const existingIndex = indexInflight.current();
    if (existingIndex) {
      let failure: { cause: unknown } | null = null;
      try {
        await existingIndex;
      } catch (e) {
        logWarn("[sessions] Background reindex in progress failed", e);
        if (!isAlreadyIndexingError(e)) failure = { cause: e };
      }
      try {
        sessions.value = await refreshSessionsAfterIndex();
        clearErrorShownBefore(epoch);
      } catch (e) {
        logWarn("[sessions] Failed to refresh session list after background reindex", e);
        failure ??= { cause: e };
      }
      if (failure && userInitiated) showError(refreshFailureMessage(failure.cause));
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
      clearErrorShownBefore(epoch);
    } catch (e) {
      // A pass started elsewhere (startup, watcher) already covers it, and
      // reloads the list when it finishes.
      if (isAlreadyIndexingError(e)) {
        logDebug("[sessions] Background ensureIndex skipped; indexing already running");
        return;
      }
      logWarn("[sessions] Background ensureIndex failed", e);
      if (userInitiated) showError(refreshFailureMessage(e));
    }
  }

  return {
    fetchSessions,
    refreshSessions,
    refreshAfterIndexPass,
    reindex,
    ensureIndex,
  };
}
