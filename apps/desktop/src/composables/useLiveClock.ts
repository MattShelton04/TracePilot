import { useVisibilityGatedPoll } from "@tracepilot/ui";
import { computed, onMounted, ref } from "vue";

/**
 * Updates a reactive `now` ref every `intervalMs` milliseconds while the
 * component (or effect scope) is active, and exposes an HH:MM:SS string.
 *
 * Visibility-gated: the timer pauses while `document.hidden` and fires an
 * immediate tick on regain so the displayed time isn't stuck at its
 * pre-hide value.
 */
export function useLiveClock(intervalMs = 1000) {
  const now = ref(new Date());

  const { start } = useVisibilityGatedPoll(
    () => {
      now.value = new Date();
    },
    intervalMs,
    { immediate: false },
  );

  onMounted(() => {
    start();
  });

  const liveTime = computed(() => {
    const d = now.value;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  });

  return { now, liveTime };
}
