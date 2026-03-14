<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionsStore } from '@/stores/sessions';
import ThemeToggle from '@/components/ThemeToggle.vue';

const route = useRoute();
const router = useRouter();
const prefs = usePreferencesStore();
const sessions = useSessionsStore();

const isHome = computed(() => route.name === 'sessions');
const isDetail = computed(() => route.path.startsWith('/session/'));

const navItems = [
  { name: 'Sessions', routeName: 'sessions', icon: 'sessions' },
];

onMounted(() => {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  sessions.fetchSessions();
});
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-[var(--color-canvas-default)] text-[var(--color-text-primary)]">
    <!-- Sidebar -->
    <aside class="hidden md:flex flex-col w-60 flex-shrink-0 border-r border-[var(--color-sidebar-border)] bg-[var(--color-sidebar-bg)]">
      <!-- Logo area -->
      <div class="flex items-center gap-2 px-4 h-12 border-b border-[var(--color-sidebar-border)]">
        <svg class="h-5 w-5 text-[var(--color-accent-fg)]" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z"/>
        </svg>
        <span class="text-sm font-bold text-[var(--color-text-primary)]">TracePilot</span>
      </div>

      <!-- Nav links -->
      <nav class="flex-1 px-2 py-3 space-y-0.5">
        <router-link
          to="/"
          class="flex items-center gap-3 px-3 py-1.5 rounded-md text-sm font-medium no-underline transition-colors"
          :class="isHome
            ? 'bg-[var(--color-sidebar-active)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-text-primary)]'"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Sessions
          <span
            v-if="sessions.sessions.length > 0"
            class="ml-auto inline-flex items-center justify-center rounded-full bg-[var(--color-neutral-muted)] px-1.5 text-[11px] font-medium text-[var(--color-text-secondary)] min-w-[18px]"
          >
            {{ sessions.sessions.length }}
          </span>
        </router-link>
      </nav>

      <!-- Sidebar footer -->
      <div class="px-3 py-3 border-t border-[var(--color-sidebar-border)] flex items-center justify-between">
        <span class="text-[11px] text-[var(--color-text-tertiary)]">v0.1.0</span>
        <ThemeToggle />
      </div>
    </aside>

    <!-- Main content area -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Top header bar (mobile nav + breadcrumb) -->
      <header class="flex items-center h-12 px-4 border-b border-[var(--color-header-border)] bg-[var(--color-header-bg)] flex-shrink-0">
        <!-- Mobile logo (hidden on md+) -->
        <div class="flex md:hidden items-center gap-2 mr-4">
          <svg class="h-5 w-5 text-[var(--color-accent-fg)]" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z"/>
          </svg>
          <span class="text-sm font-bold">TracePilot</span>
        </div>

        <!-- Breadcrumb -->
        <div class="flex items-center gap-1.5 text-sm min-w-0">
          <router-link to="/" class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] no-underline transition-colors">
            Sessions
          </router-link>
          <template v-if="isDetail">
            <svg class="h-4 w-4 text-[var(--color-text-tertiary)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
            <span class="text-[var(--color-text-primary)] truncate">{{ route.params.id }}</span>
          </template>
        </div>

        <!-- Mobile theme toggle -->
        <div class="ml-auto flex md:hidden">
          <ThemeToggle />
        </div>
      </header>

      <!-- Page content -->
      <main class="flex-1 overflow-y-auto">
        <div class="max-w-6xl mx-auto px-8 py-8">
          <router-view />
        </div>
      </main>
    </div>
  </div>
</template>
