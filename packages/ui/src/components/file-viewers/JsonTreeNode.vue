<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    value: unknown;
    label?: string;
    depth?: number;
    initiallyExpanded?: boolean;
  }>(),
  {
    depth: 0,
    initiallyExpanded: false,
  },
);

const expanded = ref(props.initiallyExpanded || props.depth === 0);
const visibleLimit = ref(100);
const isContainer = computed(() => props.value !== null && typeof props.value === "object");
const entries = computed<[string, unknown][]>(() => {
  if (Array.isArray(props.value)) {
    return props.value.map((value, index) => [String(index), value]);
  }
  if (isContainer.value) {
    return Object.entries(props.value as Record<string, unknown>);
  }
  return [];
});
const visibleEntries = computed(() => entries.value.slice(0, visibleLimit.value));
const hiddenCount = computed(() => Math.max(0, entries.value.length - visibleLimit.value));

const summary = computed(() => {
  if (Array.isArray(props.value)) return `Array(${props.value.length})`;
  if (isContainer.value) return `{${entries.value.length}}`;
  if (props.value === null) return "null";
  if (typeof props.value === "string") return JSON.stringify(props.value);
  return String(props.value);
});

const scalarClass = computed(
  () => `json-node__scalar--${props.value === null ? "null" : typeof props.value}`,
);
</script>

<template>
  <div class="json-node" :class="{ 'json-node--root': depth === 0 }">
    <button
      v-if="isContainer"
      class="json-node__row json-node__row--toggle"
      type="button"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="json-node__chevron">{{ expanded ? "▾" : "▸" }}</span>
      <span v-if="label !== undefined" class="json-node__key">{{ label }}</span>
      <span class="json-node__summary">{{ summary }}</span>
    </button>

    <div v-else class="json-node__row">
      <span v-if="label !== undefined" class="json-node__key">{{ label }}</span>
      <span class="json-node__scalar" :class="scalarClass">{{ summary }}</span>
    </div>

    <div v-if="isContainer && expanded" class="json-node__children">
      <JsonTreeNode
        v-for="[key, child] in visibleEntries"
        :key="key"
        :label="key"
        :value="child"
        :depth="depth + 1"
      />
      <button
        v-if="hiddenCount > 0"
        class="json-node__more"
        type="button"
        @click="visibleLimit += 100"
      >
        Show 100 more ({{ hiddenCount }} remaining)
      </button>
    </div>
  </div>
</template>

<style scoped>
.json-node {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.json-node__children {
  margin-left: 14px;
  padding-left: 9px;
  border-left: 1px solid var(--border-muted);
}

.json-node__row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-height: 24px;
  width: 100%;
  padding: 3px 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
}

.json-node__row--toggle {
  cursor: pointer;
}

.json-node__row:hover {
  background: var(--canvas-subtle);
}

.json-node__chevron {
  width: 10px;
  color: var(--text-tertiary);
}

.json-node__key {
  color: var(--syn-prop);
  overflow-wrap: anywhere;
}

.json-node__key::after {
  content: ":";
  color: var(--text-tertiary);
}

.json-node__summary {
  color: var(--text-tertiary);
}

.json-node__scalar {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.json-node__scalar--string { color: var(--syn-string); }
.json-node__scalar--number { color: var(--syn-number); }
.json-node__scalar--boolean { color: var(--syn-keyword); }
.json-node__scalar--null { color: var(--text-tertiary); font-style: italic; }

.json-node__more {
  margin: 4px 6px;
  padding: 4px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-subtle);
  color: var(--accent-fg);
  cursor: pointer;
  font-size: 0.6875rem;
}
</style>
