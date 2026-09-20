<script setup lang="ts">
import { computed } from "vue";
import { getReasoningBody, getReasoningSummary } from "../utils/reasoning";
import ExpandChevron from "./ExpandChevron.vue";

const props = defineProps<{
  /** Reasoning text blocks to display. */
  reasoning: string[];
  /** Whether the content is currently expanded. */
  expanded: boolean;
}>();

const summary = computed(() =>
  props.reasoning
    .map(getReasoningSummary)
    .filter((heading): heading is string => heading !== null)
    .join(" · "),
);

defineEmits<{
  toggle: [];
}>();
</script>

<template>
  <div v-if="reasoning.length > 0" class="reasoning-block">
    <button
      class="reasoning-toggle"
      :aria-expanded="expanded"
      @click="$emit('toggle')"
    >
      <ExpandChevron :expanded="expanded" />
      <slot name="prefix" />
      <span class="reasoning-label">💭 {{ reasoning.length }} reasoning block{{ reasoning.length !== 1 ? "s" : "" }}</span>
      <span v-if="summary" class="reasoning-summary" :title="summary">{{ summary }}</span>
    </button>
    <div v-if="expanded" class="reasoning-content" tabindex="0">
      <template v-for="(text, rIdx) in reasoning" :key="rIdx">
        <hr v-if="rIdx > 0" class="reasoning-divider" />
        {{ getReasoningBody(text) }}
      </template>
    </div>
  </div>
</template>

<style scoped>
.reasoning-block { min-width: 0; }
.reasoning-toggle { max-width: 100%; min-width: 0; text-align: left; }
.reasoning-label { flex-shrink: 0; }
.reasoning-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}
.reasoning-toggle:focus-visible { outline: 2px solid var(--accent-fg); outline-offset: 2px; }
</style>
