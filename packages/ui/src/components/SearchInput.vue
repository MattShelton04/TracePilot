<script setup lang="ts">
const model = defineModel<string>({ default: '' });
defineProps<{ placeholder?: string }>();

function clear() {
  model.value = '';
}
</script>
<template>
  <div class="relative flex items-center">
    <svg class="absolute left-3 h-4 w-4 text-[var(--color-text-tertiary)] pointer-events-none" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      v-model="model"
      type="text"
      :placeholder="placeholder || 'Search...'"
      :aria-label="placeholder || 'Search'"
      class="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-canvas-default)] pl-10 pr-8 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:border-[var(--color-accent-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-fg)] transition-colors"
    />
    <button
      v-if="model"
      class="absolute right-2.5 h-5 w-5 flex items-center justify-center rounded text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
      aria-label="Clear search"
      @click="clear"
    >
      <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>
