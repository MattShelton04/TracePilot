<script setup lang="ts">
/**
 * Divider shown before a prompt that resumed the session after an idle
 * window: how long it was idle and whether the prompt cache was still warm.
 * Clicking it expands a detail card. Estimated windows use a dashed style.
 */
import type { CacheWindow } from "@tracepilot/types";
import { formatAiCredits } from "@tracepilot/ui";
import { computed, ref, useId } from "vue";
import { usePromptCacheCost } from "@/composables/usePromptCacheCost";
import {
  changeKindLabel,
  describeResume,
  resumeChipLabel,
  windowDetailRows,
} from "@/utils/promptCache";

const props = defineProps<{ window: CacheWindow }>();

const expanded = ref(false);
const cardId = useId();
const { windowMissCredits } = usePromptCacheCost();

const tone = computed(() => {
  const { outcome, prefixChanges } = props.window;
  if (outcome === "warm") return prefixChanges.length > 0 ? "attention" : "warm";
  if (outcome === "expired" || outcome === "modelChanged") return "cold";
  return "neutral";
});
const estimated = computed(() => props.window.confidence === "estimated");
const text = computed(() => describeResume(props.window));
const chip = computed(() => resumeChipLabel(props.window));
const rows = computed(() => {
  const result = windowDetailRows(props.window);
  const credits = windowMissCredits(props.window);
  if (credits != null) result.push({ label: "Est. extra cost", value: formatAiCredits(credits) });
  return result;
});
</script>

<template>
  <div
    class="cache-divider"
    :class="[`cache-divider--${tone}`, { 'cache-divider--estimated': estimated }]"
    data-testid="cache-resume-divider"
  >
    <div class="cache-divider__row">
      <div class="cache-divider__line" />
      <button
        type="button"
        class="cache-divider__label"
        :aria-expanded="expanded"
        :aria-controls="cardId"
        @click="expanded = !expanded"
      >
        <span class="cache-divider__chip">{{ chip }}</span>
        <span>{{ text }}</span>
        <span v-if="estimated" class="cache-divider__estimated">Estimated</span>
      </button>
      <div class="cache-divider__line" />
    </div>
    <div v-if="expanded" :id="cardId" class="cache-divider__card" data-testid="cache-resume-detail">
      <dl>
        <template v-for="row in rows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>
      <ul v-if="window.prefixChanges.length" class="cache-divider__causes">
        <li v-for="change in window.prefixChanges" :key="change.kind">
          <span class="cache-divider__cause-kind">{{ changeKindLabel(change.kind) }}</span>
          <span>{{ change.summary }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.cache-divider {
  padding: 8px 0;
  --divider-color: var(--border-muted);
  --divider-fg: var(--text-tertiary);
}
.cache-divider__row {
  display: flex;
  align-items: center;
  gap: 12px;
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
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  font-size: 0.75rem;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.cache-divider__label:hover {
  color: var(--text-secondary);
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
.cache-divider__card {
  max-width: 420px;
  margin: 8px auto 0;
  padding: 8px 12px;
  border: 1px solid var(--divider-color);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.cache-divider--estimated .cache-divider__card {
  border-style: dashed;
}
.cache-divider__card dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0;
}
.cache-divider__card dt {
  color: var(--text-tertiary);
}
.cache-divider__card dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.cache-divider__causes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 8px 0 0;
  padding: 8px 0 0;
  list-style: none;
  border-top: 1px solid var(--border-subtle);
}
.cache-divider__causes li {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.cache-divider__cause-kind {
  flex-shrink: 0;
  padding: 0 8px;
  border-radius: var(--radius-full);
  background: var(--warning-subtle);
  color: var(--warning-fg);
  font-weight: 600;
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
