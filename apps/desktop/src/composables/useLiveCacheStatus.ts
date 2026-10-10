/**
 * useLiveCacheStatus — the live prompt-cache countdown for the next resume.
 *
 * Driven by the expiry Copilot CLI records when the agent goes idle, or for
 * sessions with recorded model calls by an estimate from the recorded TTL
 * tier (`estimated`; `unknown` when no tier was recorded). Ticked on the
 * client between refreshes. Includes ended sessions, whose cache TTL keeps
 * running. `status` is null unless a window no prompt has resumed yet has an
 * expiry.
 */
import type { PromptCacheTimeline } from "@tracepilot/types";
import { formatTime } from "@tracepilot/types";
import { computed, type MaybeRefOrGetter, toValue } from "vue";
import { useLiveClock } from "@/composables/useLiveClock";
import {
  findLiveWindow,
  formatCountdown,
  formatIdle,
  isStaleCacheWindow,
  liveCacheStatus,
} from "@/utils/promptCache";

export function useLiveCacheStatus(timeline: MaybeRefOrGetter<PromptCacheTimeline | null>) {
  const { now } = useLiveClock(1000);
  const window = computed(() => findLiveWindow(toValue(timeline)));
  const estimated = computed(() => toValue(timeline)?.source === "modelCalls");
  const unknown = computed(
    () => estimated.value && window.value != null && !window.value.expiresAt,
  );
  const status = computed(() =>
    window.value?.expiresAt ? liveCacheStatus(window.value.expiresAt, now.value.getTime()) : null,
  );
  /** Idle for over a day past any TTL: too old for a countdown to help. */
  const stale = computed(
    () => window.value != null && isStaleCacheWindow(window.value, now.value.getTime()),
  );

  /**
   * "Cache warm · 17:42", "Cache expiring · 3:10" or "Cache expired 12m ago";
   * estimates read "Estimated cache expiry · 17:42" or "Cache likely expired 12m ago".
   */
  const label = computed(() => {
    if (unknown.value) return "Cache expiry unknown";
    const current = status.value;
    if (!current) return "";
    if (current.state === "expired") {
      return `${estimated.value ? "Cache likely expired" : "Cache expired"} ${formatIdle(-current.remainingMs / 1000)} ago`;
    }
    const countdown = formatCountdown(current.remainingMs);
    if (estimated.value) return `Estimated cache expiry · ${countdown}`;
    return current.state === "expiring"
      ? `Cache expiring · ${countdown}`
      : `Cache warm · ${countdown}`;
  });

  /** What the countdown means, for surfaces with room to say it. */
  const description = computed(() => {
    if (unknown.value) return "No TTL tier was recorded; cache expiry is unknown";
    const current = status.value;
    if (!current) return "";
    if (estimated.value)
      return current.state === "expired"
        ? `Estimated expiry ${formatIdle(-current.remainingMs / 1000)} ago · cache reuse depends on the next request's prefix`
        : `${formatCountdown(current.remainingMs)} until estimated expiry · the next request may use a different prefix`;
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
      estimated.value
        ? "Estimated from the recorded tier and last cache read/write request; the next request may use a different prefix"
        : null,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  return { window, status, unknown, estimated, stale, label, description, tooltip };
}
