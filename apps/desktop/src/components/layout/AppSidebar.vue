<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import LogoIcon from "@/components/icons/LogoIcon.vue";
import SdkStatusIndicator from "@/components/layout/SdkStatusIndicator.vue";
import { useAppVersion } from "@/composables/useAppVersion";
import { useSidebarNav } from "@/composables/useSidebarNav";
import { useUpdateCheck } from "@/composables/useUpdateCheck";
import { useWhatsNew } from "@/composables/useWhatsNew";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { useAlertsStore } from "@/stores/alerts";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";

const DISMISSED_KEY = STORAGE_KEYS.dismissedUpdate;

const emit = defineEmits<{
  "view-update-details": [];
  "nav-sessions": [];
}>();

const { appVersion } = useAppVersion();
const { updateResult } = useUpdateCheck();
const { openWhatsNew } = useWhatsNew();

const route = useRoute();
const sessionsStore = useSessionsStore();
const prefsStore = usePreferencesStore();
const alertsStore = useAlertsStore();

const {
  visiblePrimaryNav,
  visibleAdvancedNav,
  orchestrationNav,
  visibleTasksNav,
  visibleConfigNav,
} = useSidebarNav();

const activeSidebarId = computed(() => (route.meta?.sidebarId as string) || "sessions");
const sessionCount = computed(() => sessionsStore.visibleSessionCount);
const currentTheme = computed(() => prefsStore.theme);
const isMac = navigator.platform.toUpperCase().includes("MAC");

function toggleTheme() {
  prefsStore.theme = currentTheme.value === "dark" ? "light" : "dark";
}

const dismissedVersion = ref(localStorage.getItem(DISMISSED_KEY));

const hasUpdate = computed(() => {
  if (updateResult.value?.hasUpdate !== true) return false;
  return updateResult.value.latestVersion !== dismissedVersion.value;
});

function dismissUpdate() {
  if (updateResult.value?.latestVersion) {
    const version = updateResult.value.latestVersion;
    localStorage.setItem(DISMISSED_KEY, version);
    dismissedVersion.value = version;
  }
}

async function handleWhatsNewPreview() {
  const latestVersion = updateResult.value?.latestVersion;
  if (latestVersion) {
    await openWhatsNew(
      appVersion.value,
      latestVersion,
      updateResult.value?.releaseUrl ?? undefined,
    );
  }
}

async function handleVersionClick() {
  await openWhatsNew("0.0.0", appVersion.value);
}
</script>

<template>
  <aside class="sidebar" role="navigation" aria-label="Main navigation" data-testid="app-sidebar">
    <!-- Brand -->
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon" aria-hidden="true">
        <LogoIcon :size="24" />
      </div>
      <span class="sidebar-brand-text">TracePilot</span>
    </div>

    <!-- Navigation -->
    <nav class="sidebar-nav">
      <!-- Primary -->
      <router-link
        v-for="item in visiblePrimaryNav"
        :key="item.id"
        :to="item.to"
        :data-nav-id="item.id"
        :data-testid="`nav-${item.id}`"
        class="sidebar-nav-item"
        :class="{ active: activeSidebarId === item.id }"
        @click="item.id === 'sessions' && emit('nav-sessions')"
      >
        <span class="nav-icon">
          <!-- sessions -->
          <svg v-if="item.icon === 'sessions'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>
          <!-- search -->
          <svg v-else-if="item.icon === 'search'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6.5" cy="6.5" r="4.5"/><path d="M10 10l4 4"/></svg>
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
        <kbd v-else-if="item.id === 'search'" class="sidebar-nav-badge sidebar-kbd">
          {{ isMac ? '⌘' : 'Ctrl+' }}K
        </kbd>
      </router-link>

      <!-- Advanced section -->
      <div class="sidebar-section-title">Advanced</div>

      <router-link
        v-for="item in visibleAdvancedNav"
        :key="item.id"
        :to="item.to"
        :data-nav-id="item.id"
        :data-testid="`nav-${item.id}`"
        class="sidebar-nav-item"
        :class="{ active: activeSidebarId === item.id }"
      >
        <span class="nav-icon">
          <!-- models -->
          <svg v-if="item.icon === 'models'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="4" cy="4" r="2.5"/><circle cx="12" cy="4" r="2.5"/><circle cx="8" cy="12" r="2.5"/><path d="M6 5l2 5M10 5l-2 5"/></svg>
          <!-- compare -->
          <svg v-else-if="item.icon === 'compare'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="5.5" height="14" rx="1"/><rect x="9.5" y="1" width="5.5" height="14" rx="1"/></svg>
          <!-- replay -->
          <svg v-else-if="item.icon === 'replay'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5,3 13,8 5,13" fill="currentColor" stroke="none"/></svg>
          <!-- export -->
          <svg v-else-if="item.icon === 'export'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M4 6l4-4 4 4M2 12h12v2H2z"/></svg>
        </span>
        <span>{{ item.label }}</span>
      </router-link>

      <!-- Orchestration section -->
      <div class="sidebar-section-title">Orchestration</div>

      <router-link
        v-for="item in orchestrationNav"
        :key="item.id"
        :to="item.to"
        :data-nav-id="item.id"
        :data-testid="`nav-${item.id}`"
        class="sidebar-nav-item"
        :class="{ active: activeSidebarId === item.id }"
      >
        <span class="nav-icon">
          <!-- orchestration (command center) -->
          <svg v-if="item.icon === 'orchestration'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="14" height="14" rx="2"/><circle cx="8" cy="8" r="2"/><path d="M8 3v3M8 10v3M3 8h3M10 8h3"/></svg>
          <!-- worktrees -->
          <svg v-else-if="item.icon === 'worktrees'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2v12M3 8h4v6M3 4h8v4"/></svg>
          <!-- launcher -->
          <svg v-else-if="item.icon === 'launcher'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 14V5l8-3v12"/><path d="M4 9h8"/></svg>
          <!-- config -->
          <svg v-else-if="item.icon === 'config'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h12M2 12h12"/><circle cx="5" cy="4" r="1.5" fill="currentColor"/><circle cx="11" cy="8" r="1.5" fill="currentColor"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/></svg>
        </span>
        <span>{{ item.label }}</span>
      </router-link>

      <!-- AI Tasks section -->
      <template v-if="visibleTasksNav.length > 0">
        <div class="sidebar-section-title">AI Tasks</div>

        <router-link
          v-for="item in visibleTasksNav"
          :key="item.id"
          :to="item.to"
          :data-nav-id="item.id"
          :data-testid="`nav-${item.id}`"
          class="sidebar-nav-item"
          :class="{ active: activeSidebarId === item.id }"
        >
          <span class="nav-icon">
            <!-- ai-tasks (task list) -->
            <svg v-if="item.icon === 'ai-tasks'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 2h8a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V4a2 2 0 012-2z"/><path d="M5 6h6M5 8.5h4M5 11h2"/></svg>
            <!-- ai-monitor (heartbeat) -->
            <svg v-else-if="item.icon === 'ai-monitor'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8h3l1.5-4 2 8L10 6l1.5 2H15"/></svg>
            <!-- ai-presets (template) -->
            <svg v-else-if="item.icon === 'ai-presets'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="1" width="12" height="14" rx="1.5"/><path d="M5 4.5h6M5 7.5h6M5 10.5h3"/></svg>
          </span>
          <span>{{ item.label }}</span>
        </router-link>
      </template>

      <!-- Configuration section -->
      <template v-if="visibleConfigNav.length > 0">
        <div class="sidebar-section-title">Configuration</div>

        <router-link
          v-for="item in visibleConfigNav"
          :key="item.id"
          :to="item.to"
          :data-nav-id="item.id"
          class="sidebar-nav-item"
          :class="{ active: activeSidebarId === item.id }"
        >
          <span class="nav-icon">
            <!-- mcp -->
            <svg v-if="item.icon === 'mcp'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="5" rx="1"/><rect x="2" y="9" width="12" height="5" rx="1"/><circle cx="4.5" cy="4.5" r="0.75" fill="currentColor" stroke="none"/><circle cx="4.5" cy="11.5" r="0.75" fill="currentColor" stroke="none"/><path d="M11 4.5h1M11 11.5h1"/></svg>
            <!-- skills -->
            <svg v-else-if="item.icon === 'skills'" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 1L5 9h4l-2 6 6-8H9l2-6z"/></svg>
          </span>
          <span>{{ item.label }}</span>
        </router-link>
      </template>

      <!-- Settings (inside nav, separated visually) -->
      <div class="sidebar-settings-separator"></div>
      <router-link
        to="/settings"
        data-nav-id="settings"
        data-testid="nav-settings"
        class="sidebar-nav-item"
        :class="{ active: activeSidebarId === 'settings' }"
      >
        <span class="nav-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M6.7 1h2.6l.4 2.1a5.5 5.5 0 0 1 1.3.8l2-.8 1.3 2.2-1.6 1.4a5.6 5.6 0 0 1 0 1.6l1.6 1.4-1.3 2.2-2-.8a5.5 5.5 0 0 1-1.3.8L9.3 15H6.7l-.4-2.1a5.5 5.5 0 0 1-1.3-.8l-2 .8-1.3-2.2 1.6-1.4a5.6 5.6 0 0 1 0-1.6L1.7 6.3 3 4.1l2 .8a5.5 5.5 0 0 1 1.3-.8L6.7 1Z" />
            <circle cx="8" cy="8" r="2" />
          </svg>
        </span>
        <span>Settings</span>
      </router-link>
    </nav>

    <!-- Footer -->
    <div class="sidebar-footer-area">
      <!-- Update available notification -->
      <Transition name="sidebar-update-slide">
        <div v-if="hasUpdate" class="sidebar-update-notice">
          <div class="sidebar-update-header">
            <div class="sidebar-update-content">
              <span class="sidebar-update-icon">🎉</span>
              <span class="sidebar-update-text">
                <strong>v{{ updateResult?.latestVersion }}</strong> available
              </span>
            </div>
            <button
              class="sidebar-update-dismiss"
              aria-label="Dismiss update notification"
              @click="dismissUpdate"
            >
              ×
            </button>
          </div>
          <div class="sidebar-update-actions">
            <button class="sidebar-update-btn" @click="emit('view-update-details')">
              Update
            </button>
            <button class="sidebar-update-btn-secondary" @click="handleWhatsNewPreview">
              What's New
            </button>
          </div>
        </div>
      </Transition>

      <div class="sidebar-footer">
        <button
          class="sidebar-version-btn"
          title="View release notes"
          @click="handleVersionClick"
        >
          v{{ appVersion }}
        </button>
        <SdkStatusIndicator />
        <button
          v-if="prefsStore.alertsEnabled"
          class="alert-bell-btn"
          :class="{ 'has-unread': alertsStore.hasUnread }"
          :aria-label="`Alerts${alertsStore.unreadCount > 0 ? ` (${alertsStore.unreadCount} unread)` : ''}`"
          @click="alertsStore.toggleDrawer()"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M4 6a4 4 0 018 0c0 2 1 4 2 5H2c1-1 2-3 2-5z" />
            <path d="M6.5 13a1.5 1.5 0 003 0" />
          </svg>
          <span v-if="alertsStore.unreadCount > 0" class="alert-badge">
            {{ alertsStore.unreadCount > 9 ? '9+' : alertsStore.unreadCount }}
          </span>
        </button>
        <button
          class="theme-toggle"
          :aria-label="`Current theme: ${currentTheme}. Click to switch.`"
          :aria-pressed="currentTheme === 'dark'"
          @click="toggleTheme"
        >
          <!-- Sun (shown in dark mode) -->
          <svg v-if="currentTheme === 'dark'" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M12.5 3.5l-1.5 1.5M5 11l-1.5 1.5" />
          </svg>
          <!-- Moon (shown in light mode) -->
          <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M13.5 8.5a5.5 5.5 0 01-6-6 5.5 5.5 0 106 6z" />
          </svg>
        </button>
      </div>
    </div>
  </aside>
</template>
