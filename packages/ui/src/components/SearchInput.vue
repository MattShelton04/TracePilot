<script setup lang="ts">
const model = defineModel<string>({ default: '' });
defineProps<{ placeholder?: string }>();
</script>
<template>
  <div class="relative">
    <svg class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
    <input
      v-model="model"
      type="text"
      :placeholder="placeholder || 'Search...'"
      class="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] pl-10 pr-4 py-2 text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
    />
  </div>
</template>
