/**
 * Look up a session detail's pull requests on GitHub and reload them when
 * the lookup changed something. The detail panel runs it per session open,
 * per manual refresh and on its poll; the Overview's Refresh button forces it.
 * Main window only, and only while the setting is on (the store checks).
 */
import { type PullRequestLookup, pullRequestRefreshChanged } from "@tracepilot/types";
import { computed } from "vue";
import { usePullRequestStatusStore } from "@/stores/pullRequestStatus";

/** The part of a session detail instance this needs. */
export interface PullRequestStatusTarget {
  readonly sessionId: string | null;
  reloadPullRequests: () => Promise<void>;
}

export function useSessionPullRequestStatus(store: PullRequestStatusTarget) {
  const status = usePullRequestStatusStore();

  /**
   * Look up the open session (`force`: every pull request, not only the due
   * ones). Nothing happens when the session changed since `expected`.
   * Answers how the lookup went, or null when it didn't run or the session
   * changed meanwhile.
   */
  async function refresh(
    force = false,
    expected = store.sessionId,
  ): Promise<PullRequestLookup | null> {
    const id = store.sessionId;
    if (!id || id !== expected || !status.canLookUp) return null;
    const result = await status.refreshSession(id, force);
    // A session switch drops the answer; the new session asks for its own.
    if (!result || store.sessionId !== id) return null;
    if (pullRequestRefreshChanged(result)) await store.reloadPullRequests();
    return store.sessionId === id ? result.lookup : null;
  }

  return {
    refresh,
    /** The open session's lookup is running. */
    refreshing: computed(() => status.isRefreshing(store.sessionId)),
    /** Lookups can run here: main window, setting on. */
    available: computed(() => status.canLookUp),
  };
}
