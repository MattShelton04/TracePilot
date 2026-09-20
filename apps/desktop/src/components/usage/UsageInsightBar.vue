<script setup lang="ts">
/**
 * Dismissible strip of short observations. An insight that carries a filter
 * renders as a button which narrows the list behind it.
 */
import { useDismissable } from "@tracepilot/ui";
import { Lightbulb, X } from "lucide-vue-next";

export interface UsageInsight {
  id: string;
  tone: "info" | "success" | "warning";
  text: string;
  /** True when selecting the insight filters the list behind it. */
  actionable?: boolean;
}

const props = defineProps<{
  insights: UsageInsight[];
  /** localStorage suffix, so each page remembers its own dismissal. */
  storageKey: string;
}>();

const emit = defineEmits<{ select: [id: string] }>();

const { isDismissed, dismiss } = useDismissable(props.storageKey);
</script>

<template>
  <div v-if="insights.length && !isDismissed" class="insight-bar">
    <Lightbulb class="insight-bar__icon" :size="14" :stroke-width="1.75" aria-hidden="true" />
    <ul class="insight-bar__list">
      <li v-for="insight in insights" :key="insight.id" :class="`insight insight--${insight.tone}`">
        <button
          v-if="insight.actionable"
          type="button"
          class="insight__action"
          @click="emit('select', insight.id)"
        >{{ insight.text }}</button>
        <span v-else>{{ insight.text }}</span>
      </li>
    </ul>
    <button
      type="button"
      class="insight-bar__dismiss"
      aria-label="Dismiss insights"
      @click="dismiss"
    >
      <X :size="13" :stroke-width="2" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.insight-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.insight-bar__icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--warning-fg);
}

.insight-bar__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  flex: 1;
  min-width: 0;
}

.insight {
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.insight--warning {
  color: var(--warning-fg);
}

.insight--success {
  color: var(--success-fg);
}

.insight__action {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: left;
  border-bottom: 1px dashed var(--border-default);
}

.insight__action:hover {
  color: var(--accent-fg);
  border-bottom-color: var(--accent-fg);
}

.insight-bar__dismiss {
  flex-shrink: 0;
  padding: 2px;
  border: 0;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  line-height: 0;
  border-radius: var(--radius-sm);
}

.insight-bar__dismiss:hover {
  color: var(--text-primary);
  background: var(--canvas-inset, var(--canvas-default));
}
</style>
