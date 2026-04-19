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

  function lerpToward(current: { value: number }, target: { value: number }, rate: number) {
    current.value += (target.value - current.value) * rate;
    if (Math.abs(target.value - current.value) < 0.5) current.value = target.value;
  }

  /** Lerp all counters toward their targets. Call once per animation frame. */
  function lerpCounters() {
    const rate = 0.15;
    lerpToward(currentSessions, targetSessions, rate);
    lerpToward(currentTokens, targetTokens, rate);
    lerpToward(currentEvents, targetEvents, rate);
    lerpToward(currentRepos, targetRepos, rate);
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
