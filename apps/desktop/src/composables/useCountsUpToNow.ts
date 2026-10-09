import { isNonCopilotSource } from "@tracepilot/types";
import { type ComputedRef, computed, type MaybeRefOrGetter, toValue } from "vue";
import { useSessionsStore } from "@/stores/sessions";

/**
 * Whether unfinished work in the session may count its duration up to now.
 * A non-Copilot session that is not live has no end for such work, so its
 * duration is unknown. Copilot sessions, and sessions whose list item is not
 * loaded yet, keep counting up to now.
 */
export function useCountsUpToNow(
  sessionId: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<boolean> {
  const sessions = useSessionsStore();
  return computed(() => {
    const id = toValue(sessionId);
    const item = sessions.sessions.find((s) => s.id === id);
    return !item || !isNonCopilotSource(item.source) || item.isRunning;
  });
}
