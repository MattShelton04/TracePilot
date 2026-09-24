<script setup lang="ts">
/**
 * Prompt-cache countdown for the next resume, including ended sessions, driven
 * by the expiry Copilot CLI records when the agent goes idle. Ticks on the client
 * between refreshes; hidden unless the CLI recorded the expiry.
 */
import type { PromptCacheTimeline } from "@tracepilot/types";
import { Tooltip } from "@tracepilot/ui";
import { Timer } from "lucide-vue-next";
import { useLiveCacheStatus } from "@/composables/useLiveCacheStatus";

const props = defineProps<{ timeline: PromptCacheTimeline | null }>();

const { status, label, tooltip } = useLiveCacheStatus(() => props.timeline);
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
