/**
 * The session list's pull request poll: at most once a minute, while the
 * window has focus and is visible, ask GitHub for the state of the shown
 * cards' primary pull requests that may still change (open, draft, or never
 * looked up). The cards update in place through the sessions store.
 *
 * Main window only, only while the setting is on (the store's `canLookUp`),
 * and only while the list is on screen (`active`: App.vue keeps the list
 * mounted, hidden, under an open session tab). Tauri doesn't fire `visibilitychange` on an app switch, so
 * window focus and blur pause and resume it; coming back asks at once only
 * when a minute has passed since the last call.
 */
import type { SessionListItem } from "@tracepilot/types";
import { onScopeDispose, watch } from "vue";
import { usePullRequestStatusStore } from "@/stores/pullRequestStatus";

/** Least time between two list lookups. */
export const LIST_POLL_INTERVAL_MS = 60_000;
/** Most sessions one lookup names; the backend fetches at most 50 of them. */
export const LIST_POLL_MAX_SESSIONS = 200;
/** Least wait before the next lookup once one finished. */
const MIN_RESCHEDULE_MS = 1_000;

/** The sessions whose primary pull request may still change, in list order. */
export function listPollCandidates(sessions: readonly SessionListItem[]): string[] {
  const ids: string[] = [];
  for (const session of sessions) {
    const linked = session.linkedPullRequests;
    if (!linked) continue;
    const state = linked.primary.state;
    if (state === "merged" || state === "closed") continue;
    ids.push(session.id);
    if (ids.length >= LIST_POLL_MAX_SESSIONS) break;
  }
  return ids;
}

/**
 * `sessions`: the cards the list renders, top first. `active`: whether the
 * list is on screen (defaults to always).
 */
export function useListPullRequestPoll(
  sessions: () => readonly SessionListItem[],
  active: () => boolean = () => true,
) {
  const status = usePullRequestStatusStore();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let focused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
  let disposed = false;
  /** A lookup is running; its end arms the next one. */
  let polling = false;

  const candidates = () => listPollCandidates(sessions());

  function running(): boolean {
    return !disposed && focused && !document.hidden && active() && status.canLookUp;
  }

  function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  /** Ms until a minute has passed since the last lookup. */
  function wait(): number {
    const last = status.lastListPollAt;
    return last == null ? 0 : Math.max(0, last + LIST_POLL_INTERVAL_MS - Date.now());
  }

  /** Arms the next lookup; with nothing to ask about it waits for the list to change. */
  function schedule(minDelay = 0) {
    stop();
    if (polling || !running() || candidates().length === 0) return;
    timer = setTimeout(() => void poll(), Math.max(wait(), minDelay));
  }

  async function poll() {
    timer = null;
    if (polling || !running()) return;
    if (wait() > 0) {
      schedule();
      return;
    }
    const ids = candidates();
    if (!ids.length) return;
    polling = true;
    try {
      await status.refreshList(ids);
    } finally {
      polling = false;
    }
    // A minute from the end of this one; never a tight loop, whatever the clock says.
    schedule(MIN_RESCHEDULE_MS);
  }

  function onFocus() {
    focused = true;
    schedule();
  }

  function onBlur() {
    focused = false;
    stop();
  }

  function onVisibility() {
    if (document.hidden) stop();
    else schedule();
  }

  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);

  // A list that loads, filters or loses its last open pull request re-arms
  // the timer; the minute between lookups still holds.
  watch(
    () => [status.canLookUp, active(), candidates().join("\n")] as const,
    () => schedule(),
    { immediate: true },
  );

  onScopeDispose(() => {
    disposed = true;
    stop();
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
  });
}
