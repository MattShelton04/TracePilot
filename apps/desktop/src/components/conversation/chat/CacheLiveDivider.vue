<script setup lang="ts">
/**
 * Trailing divider after the last turn while the session sits idle: the
 * pending counterpart of `CacheResumeDivider`, counting down to the prompt
 * cache's expiry. It disappears once the next prompt resumes the window, and
 * that turn gets the usual resume divider.
 */
import type { PromptCacheTimeline } from "@tracepilot/types";
import { Tooltip } from "@tracepilot/ui";
import { computed } from "vue";
import { useLiveCacheStatus } from "@/composables/useLiveCacheStatus";

const props = defineProps<{ timeline: PromptCacheTimeline | null }>();

const { status, description, tooltip } = useLiveCacheStatus(() => props.timeline);

const chip = computed(() => {
  if (status.value?.state === "expired") return "Cache expired";
  return status.value?.state === "expiring" ? "Cache expiring" : "Cache warm";
});
const tone = computed(() => {
  if (status.value?.state === "expired") return "cold";
  return status.value?.state === "expiring" ? "attention" : "warm";
});
</script>

<template>
  <div
    v-if="status"
    class="cache-live"
    :class="`cache-live--${tone}`"
    role="timer"
    :aria-label="`${chip}. ${description}. ${tooltip}`"
    data-testid="cache-live-divider"
  >
    <div class="cache-live__line" />
    <Tooltip :text="tooltip" position="top">
      <span class="cache-live__label">
        <span class="cache-live__chip">{{ chip }}</span>
        <span class="cache-live__text">{{ description }}</span>
      </span>
    </Tooltip>
    <div class="cache-live__line" />
  </div>
</template>

<style scoped>
.cache-live {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  --divider-color: var(--border-muted);
  --divider-fg: var(--text-tertiary);
}
.cache-live__line {
  flex: 1;
  min-width: 16px;
  border-top: 1px solid var(--divider-color);
}
.cache-live__label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
.cache-live__chip {
  flex-shrink: 0;
  padding: 0 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--divider-color);
  color: var(--divider-fg);
  font-weight: 600;
}
.cache-live__text {
  font-variant-numeric: tabular-nums;
}
.cache-live--warm {
  --divider-color: var(--success-muted);
  --divider-fg: var(--success-fg);
}
.cache-live--attention {
  --divider-color: var(--warning-muted);
  --divider-fg: var(--warning-fg);
}
.cache-live--cold {
  --divider-color: var(--neutral-muted);
  --divider-fg: var(--text-secondary);
}
</style>
