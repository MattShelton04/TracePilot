import { provideSessionEnded } from "@tracepilot/ui";
import { type ComputedRef, computed, type MaybeRefOrGetter, toValue } from "vue";
import { useSessionsStore } from "@/stores/sessions";

/**
 * Whether unfinished work in the session may still finish, so its duration
 * counts up to now. A session that is not live (for Copilot, one whose
 * process has shut down or gone away) records no more results, so such work
 * never finished and its duration is unknown. A session whose list item is
 * not loaded yet keeps counting up to now.
 */
export function useCountsUpToNow(
  sessionId: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<boolean> {
  const sessions = useSessionsStore();
  return computed(() => {
    const id = toValue(sessionId);
    const item = sessions.sessions.find((s) => s.id === id);
    return !item || item.isRunning;
  });
}

/**
 * Tells the tool-call tree below whether the session has ended (it is not
 * live, see {@link useCountsUpToNow}, and `isLive` does not say otherwise),
 * so calls that never reported a result read as settled rather than pending.
 */
export function useProvideSessionEnded(
  sessionId: MaybeRefOrGetter<string | null | undefined>,
  isLive: () => boolean = () => false,
): ComputedRef<boolean> {
  const mayStillRun = useCountsUpToNow(sessionId);
  const ended = computed(() => !mayStillRun.value && !isLive());
  provideSessionEnded(ended);
  return ended;
}
