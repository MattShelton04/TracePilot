import { provideSessionEnded } from "@tracepilot/ui";
import { type ComputedRef, computed, type MaybeRefOrGetter, toValue } from "vue";
import { useSessionLiveState } from "@/composables/useSessionLiveState";
import { useSdkStore } from "@/stores/sdk";
import { useSessionsStore } from "@/stores/sessions";

/**
 * Whether unfinished work in the session may still finish, so its duration
 * counts up to now. The session may still run while any source says so: its
 * list item (not loaded yet, or running), the detail panel's own liveness
 * check (the header's Busy/Active, fresher than the list after a resume), or
 * an attached SDK stream. Otherwise it records no more results (for Copilot,
 * its process shut down or went away), so such work never finished and its
 * duration is unknown. Copilot treats a lock untouched for 24 hours as stale,
 * so a CLI left waiting longer than that reads as ended.
 */
export function useCountsUpToNow(
  sessionId: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<boolean> {
  const sessions = useSessionsStore();
  const sdk = useSdkStore();
  const live = useSessionLiveState();
  return computed(() => {
    const id = toValue(sessionId);
    const item = sessions.sessions.find((s) => s.id === id);
    if (!item || item.isRunning || live.value.running) return true;
    return !!id && (sdk.sessionStatesById?.[id] != null || sdk.liveTurnsBySessionId?.[id] != null);
  });
}

/**
 * Tells the tool-call tree below whether the session has ended (it may no
 * longer run, see {@link useCountsUpToNow}), so calls that never reported a
 * result read as settled rather than pending.
 */
export function useProvideSessionEnded(
  sessionId: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<boolean> {
  const mayStillRun = useCountsUpToNow(sessionId);
  const ended = computed(() => !mayStillRun.value);
  provideSessionEnded(ended);
  return ended;
}
