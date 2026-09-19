<script setup lang="ts">
/**
 * Divider shown before a prompt that resumed the session after an idle
 * window: how long it was idle and whether the prompt cache was predicted
 * to be warm. Estimated windows use a dashed style and say so.
 */
import type { CacheWindow } from "@tracepilot/types";
import { Tooltip } from "@tracepilot/ui";
import { computed } from "vue";
import { describeResume, describeWindowDetail, resumeChipLabel } from "@/utils/promptCache";

const props = defineProps<{ window: CacheWindow }>();

const tone = computed(() => {
  const { outcome, prefixChanges } = props.window;
  if (outcome === "warm") return prefixChanges.length > 0 ? "attention" : "warm";
  if (outcome === "expired" || outcome === "modelChanged") return "cold";
  return "neutral";
});
const estimated = computed(() => props.window.confidence === "estimated");
const text = computed(() => describeResume(props.window));
const chip = computed(() => resumeChipLabel(props.window));
const detail = computed(() => describeWindowDetail(props.window));
</script>

<template>
  <div
    class="cache-divider"
    :class="[`cache-divider--${tone}`, { 'cache-divider--estimated': estimated }]"
    data-testid="cache-resume-divider"
  >
    <div class="cache-divider__line" />
    <Tooltip :text="detail">
      <span class="cache-divider__label" tabindex="0" :aria-label="`${chip}: ${text}. ${detail}`">
        <span class="cache-divider__chip">{{ chip }}</span>
        <span>{{ text }}</span>
        <span v-if="estimated" class="cache-divider__estimated">Estimated</span>
      </span>
    </Tooltip>
    <div class="cache-divider__line" />
  </div>
</template>

<style scoped>
.cache-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  --divider-color: var(--border-muted);
  --divider-fg: var(--text-tertiary);
}
.cache-divider__line {
  flex: 1;
  min-width: 16px;
  border-top: 1px solid var(--divider-color);
}
.cache-divider--estimated .cache-divider__line {
  border-top-style: dashed;
}
.cache-divider__label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
}
.cache-divider__label:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
.cache-divider__chip {
  flex-shrink: 0;
  padding: 0 8px;
  border-radius: var(--radius-full);
  border: 1px solid var(--divider-color);
  color: var(--divider-fg);
  font-weight: 600;
}
.cache-divider--estimated .cache-divider__chip {
  border-style: dashed;
}
.cache-divider__estimated {
  font-style: italic;
}
.cache-divider--warm {
  --divider-color: var(--success-muted);
  --divider-fg: var(--success-fg);
}
.cache-divider--attention {
  --divider-color: var(--warning-muted);
  --divider-fg: var(--warning-fg);
}
.cache-divider--cold {
  --divider-color: var(--neutral-muted);
  --divider-fg: var(--text-secondary);
}
</style>
