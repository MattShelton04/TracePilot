/**
 * useSessionLiveState — provide/inject key and helper that let a session's
 * tabs read whether its process is running, as the detail header shows it.
 */
import type { RunStatus } from "@tracepilot/types";
import type { ComputedRef, InjectionKey } from "vue";
import { computed, inject } from "vue";

export interface SessionLiveState {
  /** A live process owns the session. */
  running: boolean;
  /** What that process is doing, for sources that record it. */
  status: RunStatus | null;
}

export const SESSION_LIVE_STATE_KEY: InjectionKey<ComputedRef<SessionLiveState>> =
  Symbol("sessionLiveState");

/**
 * The injected live state, or "not running" outside a session detail panel
 * (e.g. in isolated component tests).
 */
export function useSessionLiveState(): ComputedRef<SessionLiveState> {
  return inject(
    SESSION_LIVE_STATE_KEY,
    () => computed(() => ({ running: false, status: null })),
    true,
  );
}
