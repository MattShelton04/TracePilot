<script setup lang="ts">
import { ref } from "vue";

const model = defineModel<string>({ default: "" });
defineProps<{ placeholder?: string; shortcutHint?: string }>();
const inputRef = ref<HTMLInputElement | null>(null);

defineOptions({ inheritAttrs: false });

function clear() {
  model.value = "";
  inputRef.value?.focus({ preventScroll: true });
}
</script>
<template>
  <div class="search-container" v-bind="$attrs">
    <svg class="search-icon" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      ref="inputRef"
      v-model="model"
      type="text"
      class="search-input"
      :class="{ 'search-input--clearable': model }"
      :placeholder="placeholder || 'Search...'"
      :aria-label="placeholder || 'Search'"
      data-testid="search-input-field"
    />
    <span v-if="shortcutHint && !model" class="search-shortcut">{{ shortcutHint }}</span>
    <button
      v-if="model"
      type="button"
      class="search-clear"
      aria-label="Clear search"
      @click="clear"
    >
      <svg width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.search-container {
  position: relative;
  min-width: 0;
}

.search-input--clearable {
  padding-right: 40px;
}

.search-clear {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.search-clear:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.search-clear:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: -2px;
}
</style>
