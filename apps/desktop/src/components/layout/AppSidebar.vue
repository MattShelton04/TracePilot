<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useSessionsStore } from '@/stores/sessions';
import { usePreferencesStore } from '@/stores/preferences';

const route = useRoute();
const sessionsStore = useSessionsStore();
const prefsStore = usePreferencesStore();

const activeSidebarId = computed(() => (route.meta?.sidebarId as string) || 'sessions');
const sessionCount = computed(() => sessionsStore.sessions.length);
const currentTheme = computed(() => prefsStore.theme);

function toggleTheme() {
  const cycle = { dark: 'light', light: 'system', system: 'dark' } as const;
  prefsStore.theme = cycle[currentTheme.value as keyof typeof cycle] || 'dark';
}

const primaryNav = [
  { id: 'sessions', label: 'Sessions', to: '/', icon: 'sessions' },
  { id: 'analytics', label: 'Analytics', to: '/analytics', icon: 'analytics' },
  { id: 'health', label: 'Health', to: '/health', icon: 'health' },
  { id: 'tools', label: 'Tools', to: '/tools', icon: 'tools' },
  { id: 'code', label: 'Code', to: '/code', icon: 'code' },
];

const advancedNav = [
  { id: 'compare', label: 'Compare', to: '/compare', icon: 'compare' },
  { id: 'replay', label: 'Replay', to: '/replay', icon: 'replay' },
  { id: 'export', label: 'Export', to: '/export', icon: 'export' },
  { id: 'settings', label: 'Settings', to: '/settings', icon: 'settings' },
];
</script>

<template>
  <aside class="sidebar" role="navigation" aria-label="Main navigation">
    <!-- Brand -->
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="8" cy="8" r="5.5" />
          <polyline points="8,4 8,8 11,9.5" />
        </svg>
      </div>
      <span class="sidebar-brand-text">TracePilot</span>
    </div>

    <!-- Navigation -->
    <nav class="sidebar-nav">
      <!-- Primary -->
      <router-link
        v-for="item in primaryNav"
        :key="item.id"
        :to="item.to"
        :data-nav-id="item.id"
        class="sidebar-nav-item"
        :class="{ active: activeSidebarId === item.id }"
      >
        <span class="nav-icon">
          <!-- sessions -->
          <svg v-if="item.icon === 'sessions'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>
          <!-- analytics -->
          <svg v-else-if="item.icon === 'analytics'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="8" width="3" height="6" rx="0.5"/><rect x="6" y="4" width="3" height="10" rx="0.5"/><rect x="11" y="1" width="3" height="13" rx="0.5"/></svg>
          <!-- health -->
          <svg v-else-if="item.icon === 'health'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 14s-5.5-3.5-5.5-7.5C2.5 3.5 4.5 2 6.5 2 7.3 2 8 2.5 8 2.5S8.7 2 9.5 2c2 0 4 1.5 4 4.5S8 14 8 14z"/></svg>
          <!-- tools -->
          <svg v-else-if="item.icon === 'tools'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2l4 4-8 8-4-4z"/><path d="M2 14l2-2"/></svg>
          <!-- code -->
          <svg v-else-if="item.icon === 'code'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="5,4 1,8 5,12"/><polyline points="11,4 15,8 11,12"/><line x1="9" y1="2" x2="7" y2="14"/></svg>
        </span>
        <span>{{ item.label }}</span>
        <span v-if="item.id === 'sessions' && sessionCount > 0" class="sidebar-nav-badge">
          {{ sessionCount }}
        </span>
      </router-link>

      <!-- Advanced section -->
      <div class="sidebar-section-title">Advanced</div>

      <router-link
        v-for="item in advancedNav"
        :key="item.id"
        :to="item.to"
        :data-nav-id="item.id"
        class="sidebar-nav-item"
        :class="{ active: activeSidebarId === item.id }"
      >
        <span class="nav-icon">
          <!-- compare -->
          <svg v-if="item.icon === 'compare'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="5.5" height="14" rx="1"/><rect x="9.5" y="1" width="5.5" height="14" rx="1"/></svg>
          <!-- replay -->
          <svg v-else-if="item.icon === 'replay'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5,3 13,8 5,13" fill="currentColor" stroke="none"/></svg>
          <!-- export -->
          <svg v-else-if="item.icon === 'export'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M4 6l4-4 4 4M2 12h12v2H2z"/></svg>
          <!-- settings -->
          <svg v-else-if="item.icon === 'settings'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13"/></svg>
        </span>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>

    <!-- Footer -->
    <div class="sidebar-footer">
      <span class="sidebar-version">v0.1.0</span>
      <button
        class="theme-toggle"
        :aria-label="`Current theme: ${currentTheme}. Click to switch.`"
        @click="toggleTheme"
      >
        <!-- Sun (shown in dark mode) -->
        <svg v-if="currentTheme === 'dark'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M12.5 3.5l-1.5 1.5M5 11l-1.5 1.5" />
        </svg>
        <!-- Moon (shown in light mode) -->
        <svg v-else-if="currentTheme === 'light'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M13.5 8.5a5.5 5.5 0 01-6-6 5.5 5.5 0 106 6z" />
        </svg>
        <!-- System (shown in system mode) -->
        <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="9" rx="1.5" />
          <line x1="5" y1="14" x2="11" y2="14" />
          <line x1="8" y1="11" x2="8" y2="14" />
        </svg>
      </button>
    </div>
  </aside>
</template>
