<script setup lang="ts">
/**
 * Live prompt-cache countdown for a running session, driven by the expiry
 * Copilot CLI records when the agent goes idle. Ticks on the client between
 * refreshes; hidden unless the CLI recorded the expiry.
 */
import type { PromptCacheTimeline } from "@tracepilot/types";
import { formatTime } from "@tracepilot/types";
import { Tooltip } from "@tracepilot/ui";
import { Timer } from "lucide-vue-next";
import { computed } from "vue";
import { useLiveClock } from "@/composables/useLiveClock";
import { findLiveWindow, formatCountdown, formatIdle, liveCacheStatus } from "@/utils/promptCache";

const props = defineProps<{ timeline: PromptCacheTimeline | null }>();

const { now } = useLiveClock(1000);
const liveWindow = computed(() => findLiveWindow(props.timeline));
const status = computed(() =>
  liveWindow.value?.expiresAt
    ? liveCacheStatus(liveWindow.value.expiresAt, now.value.getTime())
    : null,
);

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

const tooltip = computed(() => {
  const current = liveWindow.value;
  if (!current) return "";
  return [
    current.model ?? "Unknown model",
    current.ttlSeconds ? `TTL ${formatIdle(current.ttlSeconds)}` : null,
    current.expiresAt ? `expires ${formatTime(current.expiresAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
});
</script>

<template>
  <Tooltip v-if="status" :text="tooltip" position="bottom">
    <span
      class="cache-chip"
      :class="`cache-chip--${status.state}`"
      role="timer"
      :aria-label="`${label}. ${tooltip}`"
      data-testid="prompt-cache-chip"
    >
      <Timer :size="14" aria-hidden="true" />
      <span class="cache-chip__text">{{ label }}</span>
    </span>
  </Tooltip>
</template>

<style scoped>
.cache-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}
.cache-chip__text {
  font-variant-numeric: tabular-nums;
}
.cache-chip--warm {
  color: var(--success-fg);
  border-color: var(--success-muted);
  background: var(--success-subtle);
}
.cache-chip--expiring {
  color: var(--warning-fg);
  border-color: var(--warning-muted);
  background: var(--warning-subtle);
}
</style>
