<script setup lang="ts">
import { usePreferencesStore } from '@/stores/preferences';

const prefs = usePreferencesStore();

function toggle() {
  prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', prefs.theme);
}
</script>

<template>
  <button
    class="flex items-center justify-center h-8 w-8 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--neutral-subtle)] transition-colors"
    :aria-label="`Switch to ${prefs.theme === 'dark' ? 'light' : 'dark'} theme`"
    @click="toggle"
  >
    <!-- Sun icon (shown in dark mode) -->
    <svg v-if="prefs.theme === 'dark'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
    <!-- Moon icon (shown in light mode) -->
    <svg v-else class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  </button>
</template>
