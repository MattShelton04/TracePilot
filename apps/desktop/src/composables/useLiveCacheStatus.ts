/**
 * useLiveCacheStatus — the live prompt-cache countdown for the next resume.
 *
 * Driven by the expiry Copilot CLI records when the agent goes idle, and
 * ticked on the client between refreshes. Includes ended sessions, whose
 * cache TTL keeps running. `status` is null unless the CLI recorded an expiry
 * for a window that no prompt has resumed yet.
 */
import type { PromptCacheTimeline } from "@tracepilot/types";
import { formatTime } from "@tracepilot/types";
import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useLiveClock } from "@/composables/useLiveClock";
import { findLiveWindow, formatCountdown, formatIdle, liveCacheStatus } from "@/utils/promptCache";

export function useLiveCacheStatus(timeline: MaybeRefOrGetter<PromptCacheTimeline | null>) {
  const { now } = useLiveClock(1000);
  const window = computed(() => findLiveWindow(toValue(timeline)));
  const status = computed(() =>
    window.value?.expiresAt ? liveCacheStatus(window.value.expiresAt, now.value.getTime()) : null,
  );

  /** "Cache warm · 17:42", "Cache expiring · 3:10" or "Cache expired 12m ago". */
  const label = computed(() => {
    const current = status.value;
    if (!current) return "";
    if (current.state === "expired") {
      return `Cache expired ${formatIdle(-current.remainingMs / 1000)} ago`;
    }
    const countdown = formatCountdown(current.remainingMs);
    return current.state === "expiring"
      ? `Cache expiring · ${countdown}`
      : `Cache warm · ${countdown}`;
  });

  /** What the countdown means, for surfaces with room to say it. */
  const description = computed(() => {
    const current = status.value;
    if (!current) return "";
    if (current.state === "expired") {
      return `Expired ${formatIdle(-current.remainingMs / 1000)} ago · the next prompt re-sends the full context`;
    }
    return `${formatCountdown(current.remainingMs)} left before the prompt cache expires`;
  });

  const tooltip = computed(() => {
    const current = window.value;
    if (!current) return "";
    return [
      current.model ?? "Unknown model",
      current.ttlSeconds ? `TTL ${formatIdle(current.ttlSeconds)}` : null,
      current.expiresAt ? `expires ${formatTime(current.expiresAt)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  return { window, status, label, description, tooltip };
}
