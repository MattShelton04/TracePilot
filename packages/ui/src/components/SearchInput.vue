<script setup lang="ts">
const model = defineModel<string>({ default: '' });
defineProps<{ placeholder?: string; shortcutHint?: string }>();

function clear() {
  model.value = '';
}
</script>
<template>
  <div class="search-container">
    <svg class="search-icon" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      v-model="model"
      type="text"
      class="search-input"
      :placeholder="placeholder || 'Search...'"
      :aria-label="placeholder || 'Search'"
    />
    <span v-if="shortcutHint && !model" class="search-shortcut">{{ shortcutHint }}</span>
    <button
      v-if="model"
      type="button"
      class="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded"
      style="color: var(--text-tertiary);"
      aria-label="Clear search"
      @click="clear"
    >
      <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>
