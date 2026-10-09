import { type ComputedRef, computed, type MaybeRefOrGetter, toValue } from "vue";
import { useSessionsStore } from "@/stores/sessions";

/**
 * Whether a live process owns the session, from its list item. Work left
 * unfinished in a session that is not live has no end, so its duration is
 * unknown rather than counted up to now.
 */
export function useSessionLive(
  sessionId: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<boolean> {
  const sessions = useSessionsStore();
  return computed(() => {
    const id = toValue(sessionId);
    return sessions.sessions.find((s) => s.id === id)?.isRunning ?? false;
  });
}
