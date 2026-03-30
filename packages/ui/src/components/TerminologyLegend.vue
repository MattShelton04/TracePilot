<script setup lang="ts">
import { ref } from "vue";
import ExpandChevron from "./ExpandChevron.vue";

defineProps<{
  items: { term: string; definition: string }[];
}>();

const open = ref(false);
</script>

<template>
  <div class="terminology-legend">
    <button
      class="terminology-toggle"
      @click="open = !open"
      :aria-expanded="open"
    >
      ℹ Terminology
      <ExpandChevron :expanded="open" size="sm" />
    </button>
    <Transition name="fade">
      <dl v-if="open" class="terminology-list">
        <div v-for="item in items" :key="item.term" class="term-entry">
          <dt>{{ item.term }}</dt>
          <dd>{{ item.definition }}</dd>
        </div>
      </dl>
    </Transition>
  </div>
</template>

<style scoped>
.terminology-legend {
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 6px 12px;
}

.terminology-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  padding: 2px 0;
  transition: color var(--transition-fast);
  width: 100%;
}

.terminology-toggle:hover {
  color: var(--text-primary);
}

.terminology-list {
  margin: 8px 0 4px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.term-entry {
  display: flex;
  gap: 8px;
  align-items: baseline;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.term-entry dt {
  font-weight: 600;
  color: var(--text-primary);
  min-width: 80px;
  flex-shrink: 0;
}

.term-entry dd {
  margin: 0;
  color: var(--text-secondary);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--transition-fast, 0.15s ease);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
