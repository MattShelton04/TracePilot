import type { BridgeEvent } from "@tracepilot/types";
import { onScopeDispose } from "vue";
import { useSdkStore } from "@/stores/sdk";

/**
 * Durable event types: each is appended to the session's `events.jsonl` as it
 * happens, so the persisted view can show it after a refresh. Ephemeral
 * events (deltas, partial tool output, usage) never reach disk and stay in
 * the live overlay instead (live attach plan, F7).
 */
export const DURABLE_REFRESH_EVENTS: ReadonlySet<string> = new Set([
  "user.message",
  "assistant.message",
  "assistant.turn_end",
  "tool.execution_start",
  "tool.execution_complete",
  "subagent.started",
  "subagent.completed",
  "subagent.failed",
  "session.idle",
  "session.error",
  "session.compaction_complete",
]);

/** Trailing debounce for bursts (e.g. parallel tool calls). */
export const LIVE_REFRESH_DEBOUNCE_MS = 400;
/** Upper bound on staleness while events keep arriving. */
export const LIVE_REFRESH_MAX_WAIT_MS = 2000;

export interface UseLivePersistedSyncOptions {
  sessionId: () => string | null | undefined;
  refresh: () => unknown;
}

/**
 * Keeps the persisted session view in step with a live stream (ADR-0016).
 *
 * While TracePilot streams a session (attached, or the legacy TCP bridge),
 * the live overlay renders ephemeral text and tool output immediately, and
 * every durable event schedules a debounced refresh of the persisted data so
 * the saved turn replaces the overlay within a few hundred milliseconds —
 * including prompts typed in the terminal, which TracePilot did not send.
 */
export function useLivePersistedSync(options: UseLivePersistedSyncOptions) {
  const sdk = useSdkStore();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstPendingAt: number | null = null;

  function flush() {
    timer = null;
    firstPendingAt = null;
    void options.refresh();
  }

  function schedule() {
    const now = Date.now();
    firstPendingAt ??= now;
    if (timer) clearTimeout(timer);
    const waited = now - firstPendingAt;
    const delay = Math.max(
      0,
      Math.min(LIVE_REFRESH_DEBOUNCE_MS, LIVE_REFRESH_MAX_WAIT_MS - waited),
    );
    timer = setTimeout(flush, delay);
  }

  function onEvent(event: BridgeEvent) {
    const sid = options.sessionId();
    if (!sid || event.sessionId !== sid) return;
    if (DURABLE_REFRESH_EVENTS.has(event.eventType)) schedule();
  }

  const unsubscribe = sdk.onBridgeEvent(onEvent);
  onScopeDispose(() => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  });

  return { onEvent };
}
