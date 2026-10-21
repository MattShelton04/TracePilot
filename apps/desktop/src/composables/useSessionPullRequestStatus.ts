/**
 * Look up a session detail's pull requests on GitHub and reload them when
 * the lookup changed something. The detail panel runs it once per session
 * open and per manual refresh; the Overview's Refresh button forces it.
 * Main window only, and only while the setting is on (the store checks).
 */
import { pullRequestRefreshChanged } from "@tracepilot/types";
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
   */
  async function refresh(force = false, expected = store.sessionId): Promise<void> {
    const id = store.sessionId;
    if (!id || id !== expected || !status.canLookUp) return;
    const result = await status.refreshSession(id, force);
    // A session switch drops the answer; the new session asks for its own.
    if (!result || store.sessionId !== id || !pullRequestRefreshChanged(result)) return;
    await store.reloadPullRequests();
  }

  return {
    refresh,
    /** The open session's lookup is running. */
    refreshing: computed(() => status.isRefreshing(store.sessionId)),
    /** Lookups can run here: main window, setting on. */
    available: computed(() => status.canLookUp),
  };
}
