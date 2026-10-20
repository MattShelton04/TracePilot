/**
 * Live GitHub state for linked pull requests.
 *
 * The backend asks GitHub through the `gh` CLI and caches what it learns in
 * the index; this store only triggers those lookups from the main window,
 * remembers how the last one went (for the Overview's note), and gives the
 * session list the new states. Pop-out viewers never look anything up: they
 * read what the main window fetched.
 */
import { refreshListPullRequests, refreshSessionPullRequests } from "@tracepilot/client";
import type { PullRequestLookup, PullRequestRefreshResult } from "@tracepilot/types";
import { runMutation } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref, shallowRef, watch } from "vue";
import { useWindowRole } from "@/composables/useWindowRole";
import { logWarn } from "@/utils/logger";
import { usePreferencesStore } from "./preferences";
import { useSessionsStore } from "./sessions";

/** Lookups that need the user to act, so the Overview explains them once. */
export type PullRequestLookupNotice = Extract<
  PullRequestLookup,
  "disabled" | "notInstalled" | "signedOut"
>;

export const usePullRequestStatusStore = defineStore("pullRequestStatus", () => {
  const prefs = usePreferencesStore();
  const sessions = useSessionsStore();
  const { isMain } = useWindowRole();

  /** How the last lookup went; null until one ran in this window. */
  const lookup = ref<PullRequestLookup | null>(null);
  const error = ref<string | null>(null);
  /** Sessions whose pull requests are being looked up. */
  const refreshingIds = shallowRef<ReadonlySet<string>>(new Set());
  /** When the session list last asked (ms), for its once-a-minute poll. */
  const lastListPollAt = ref<number | null>(null);
  const listPolling = ref(false);
  const inFlight = new Map<string, Promise<PullRequestRefreshResult | null>>();

  /** Lookups run only from the main window, and only while the setting is on. */
  const canLookUp = computed(() => isMain() && prefs.pullRequestLookup);

  /** What the Overview's note explains: the setting is off, or `gh` can't be used. */
  const notice = computed<PullRequestLookupNotice | null>(() => {
    if (!isMain()) return null;
    if (!prefs.pullRequestLookup) return "disabled";
    const last = lookup.value;
    return last === "disabled" || last === "notInstalled" || last === "signedOut" ? last : null;
  });

  // A lookup from before the switch moved no longer describes the setting.
  watch(
    () => prefs.pullRequestLookup,
    () => {
      lookup.value = null;
    },
  );

  function setRefreshing(sessionId: string, on: boolean) {
    const next = new Set(refreshingIds.value);
    if (on) next.add(sessionId);
    else next.delete(sessionId);
    refreshingIds.value = next;
  }

  function isRefreshing(sessionId: string | null | undefined): boolean {
    return !!sessionId && refreshingIds.value.has(sessionId);
  }

  function record(result: PullRequestRefreshResult) {
    lookup.value = result.lookup;
    sessions.applyPullRequestStates(result.updated);
  }

  /**
   * Look up the session's pull requests that are due (all of them with
   * `force`) and its pushed branches. One lookup per session at a time: a
   * second call while one runs gets the first one's result. Null when it
   * didn't run or failed.
   */
  function refreshSession(
    sessionId: string,
    force = false,
  ): Promise<PullRequestRefreshResult | null> {
    if (!canLookUp.value || !sessionId) return Promise.resolve(null);
    const running = inFlight.get(sessionId);
    if (running) return running;
    setRefreshing(sessionId, true);
    const request = runMutation(error, async () => {
      const result = await refreshSessionPullRequests(sessionId, force);
      record(result);
      return result;
    }).finally(() => {
      inFlight.delete(sessionId);
      setRefreshing(sessionId, false);
      if (error.value) logWarn("[pullRequestStatus] Session lookup failed:", error.value);
    });
    inFlight.set(sessionId, request);
    return request;
  }

  /**
   * The session list's poll: the due primary pull requests of these
   * sessions. The backend makes at most one GitHub call a minute.
   */
  async function refreshList(sessionIds: readonly string[]): Promise<void> {
    if (!canLookUp.value || listPolling.value || !sessionIds.length) return;
    listPolling.value = true;
    lastListPollAt.value = Date.now();
    try {
      await runMutation(error, async () => {
        record(await refreshListPullRequests([...sessionIds]));
      });
      if (error.value) logWarn("[pullRequestStatus] List lookup failed:", error.value);
    } finally {
      listPolling.value = false;
    }
  }

  return {
    lookup,
    error,
    lastListPollAt,
    listPolling,
    canLookUp,
    notice,
    isRefreshing,
    refreshSession,
    refreshList,
  };
});
