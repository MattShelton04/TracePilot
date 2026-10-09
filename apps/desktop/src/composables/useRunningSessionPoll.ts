import { usePolling } from "@tracepilot/ui";
import { computed } from "vue";

/** Detail refresh cadence for a running session TracePilot cannot stream. */
export const RUNNING_SESSION_POLL_MS = 3000;

export interface UseRunningSessionPollOptions {
  /**
   * True while the session runs, its source has no live stream, and the view
   * may refresh. Polling stops as soon as it turns false (the session went
   * idle) and resumes when it turns true again.
   */
  active: () => boolean;
  refresh: () => Promise<unknown>;
}

/**
 * Keeps a running session's detail view (Conversation, Timeline, Metrics)
 * current when its source cannot be streamed, as Claude Code sessions can't.
 * Running Copilot sessions refresh from the live stream instead
 * (`useLivePersistedSync`), so callers leave them out. Pauses while the
 * window is hidden; unchanged sessions are cheap to refresh because the
 * backend caches events by source fingerprint.
 */
export function useRunningSessionPoll(options: UseRunningSessionPollOptions) {
  const active = computed(options.active);
  const poll = usePolling(
    async () => {
      await options.refresh();
    },
    { intervalMs: RUNNING_SESSION_POLL_MS, immediate: false, active },
  );
  poll.start();
  return poll;
}
