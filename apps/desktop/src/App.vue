<script setup lang="ts">
import { useRoute } from 'vue-router';
import { computed } from 'vue';

const route = useRoute();
const isHome = computed(() => route.name === 'sessions');
</script>

<template>
  <div class="min-h-screen bg-[var(--bg)] text-[var(--text)]">
    <header class="border-b border-[var(--border)] px-6 py-3">
      <div class="max-w-7xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-3">
          <router-link to="/" class="text-lg font-bold text-[var(--accent)] hover:opacity-90 no-underline">
            TracePilot
          </router-link>
          <span class="text-xs text-[var(--text-muted)]">Copilot CLI Session Explorer</span>
        </div>
        <nav class="flex items-center gap-4">
          <router-link
            to="/"
            class="text-sm no-underline"
            :class="isHome ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'"
          >
            Sessions
          </router-link>
          <router-link
            to="/search"
            class="text-sm no-underline"
            :class="route.name === 'search' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'"
          >
            Search
          </router-link>
        </nav>
      </div>
    </header>
    <main class="max-w-7xl mx-auto px-6 py-6">
      <router-view />
    </main>
  </div>
</template>
