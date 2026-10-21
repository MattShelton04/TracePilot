/**
 * An open session detail's pull request poll: about once a minute, while the
 * window has focus and is visible, ask again about the session's pull
 * requests while one of them may still change (open, draft, or never looked
 * up). Merged and closed ones are final, so a session with only those waits.
 *
 * The ask is the same unforced lookup as opening the session: the backend
 * re-fetches an open pull request only once its last fetch is 10 minutes old
 * (`OPEN_STALE_AFTER`), so most polls read the index and start no `gh`
 * process. The session list has its own poll, which pauses while a session
 * tab covers the list.
 *
 * Main window only, only while the setting is on (the store's `canLookUp`),
 * and only while the detail is on screen (`active`). Tauri doesn't fire
 * `visibilitychange` on an app switch, so window focus and blur pause and
 * resume it; coming back asks at once only when a minute has passed.
 */
import { type SessionPullRequest, sessionPullRequestState } from "@tracepilot/types";
import { onScopeDispose, watch } from "vue";
import { usePullRequestStatusStore } from "@/stores/pullRequestStatus";

/** Least time between two polls of the open session. */
export const SESSION_POLL_INTERVAL_MS = 60_000;
/** Least wait before the next poll once one finished. */
const MIN_RESCHEDULE_MS = 1_000;

/** Whether one of these pull requests may still change on GitHub. */
export function sessionPollDue(pullRequests: readonly SessionPullRequest[]): boolean {
  return pullRequests.some((pr) => {
    const state = sessionPullRequestState(pr);
    return state !== "merged" && state !== "closed";
  });
}

export interface SessionPullRequestPollOptions {
  /** The open session; a new one restarts the minute (its open looked it up). */
  sessionId: () => string | null;
  /** The session's linked pull requests. */
  pullRequests: () => readonly SessionPullRequest[];
  /** Whether the detail is on screen (defaults to always). */
  active?: () => boolean;
  /** The unforced lookup; it never throws. */
  refresh: () => Promise<unknown>;
}

export function useSessionPullRequestPoll(options: SessionPullRequestPollOptions) {
  const status = usePullRequestStatusStore();
  const active = options.active ?? (() => true);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let focused = typeof document.hasFocus === "function" ? document.hasFocus() : true;
  let disposed = false;
  /** A poll is running; its end arms the next one. */
  let polling = false;
  /** When the open session was last asked about; its open counts as one. */
  let lastPollAt = Date.now();

  function running(): boolean {
    return (
      !disposed &&
      focused &&
      !document.hidden &&
      active() &&
      status.canLookUp &&
      !!options.sessionId()
    );
  }

  function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  /** Ms until a minute has passed since the last ask. */
  function wait(): number {
    return Math.max(0, lastPollAt + SESSION_POLL_INTERVAL_MS - Date.now());
  }

  function schedule(minDelay = 0) {
    stop();
    if (polling || !running() || !sessionPollDue(options.pullRequests())) return;
    timer = setTimeout(() => void poll(), Math.max(wait(), minDelay));
  }

  async function poll() {
    timer = null;
    if (polling || !running()) return;
    if (wait() > 0) {
      schedule();
      return;
    }
    polling = true;
    lastPollAt = Date.now();
    try {
      await options.refresh();
    } finally {
      polling = false;
      lastPollAt = Date.now();
    }
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

  // Another session starts its own minute; a pull request that merges stops
  // the poll, and one that appears (or reopens) starts it.
  watch(
    () =>
      [
        options.sessionId(),
        status.canLookUp,
        active(),
        sessionPollDue(options.pullRequests()),
      ] as const,
    ([id], previous) => {
      if (previous && id !== previous[0]) lastPollAt = Date.now();
      schedule();
    },
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
