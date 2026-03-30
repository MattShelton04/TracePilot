import { formatNumber } from "@tracepilot/ui";
import { computed, ref } from "vue";

/**
 * Animated counter interpolation for smooth numeric display.
 *
 * - Maintains target and current values for sessions, tokens, events, repos
 * - `lerpCounters()` should be called on each animation frame to advance interpolation
 * - Provides formatted display computed refs
 */
export function useAnimatedCounters() {
  const targetSessions = ref(0);
  const targetTokens = ref(0);
  const targetEvents = ref(0);
  const targetRepos = ref(0);

  const currentSessions = ref(0);
  const currentTokens = ref(0);
  const currentEvents = ref(0);
  const currentRepos = ref(0);

  /** Lerp all counters toward their targets. Call once per animation frame. */
  function lerpCounters() {
    const rate = 0.15;
    currentSessions.value += (targetSessions.value - currentSessions.value) * rate;
    currentTokens.value += (targetTokens.value - currentTokens.value) * rate;
    currentEvents.value += (targetEvents.value - currentEvents.value) * rate;
    currentRepos.value += (targetRepos.value - currentRepos.value) * rate;

    // Snap when close
    if (Math.abs(targetSessions.value - currentSessions.value) < 0.5)
      currentSessions.value = targetSessions.value;
    if (Math.abs(targetTokens.value - currentTokens.value) < 0.5)
      currentTokens.value = targetTokens.value;
    if (Math.abs(targetEvents.value - currentEvents.value) < 0.5)
      currentEvents.value = targetEvents.value;
    if (Math.abs(targetRepos.value - currentRepos.value) < 0.5)
      currentRepos.value = targetRepos.value;
  }

  const displaySessions = computed(() => String(Math.round(currentSessions.value)));
  const displayTokens = computed(() => formatNumber(Math.round(currentTokens.value)));
  const displayEvents = computed(() => formatNumber(Math.round(currentEvents.value)));
  const displayRepos = computed(() => String(Math.round(currentRepos.value)));

  return {
    targetSessions,
    targetTokens,
    targetEvents,
    targetRepos,
    displaySessions,
    displayTokens,
    displayEvents,
    displayRepos,
    lerpCounters,
  };
}
