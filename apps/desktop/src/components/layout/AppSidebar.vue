<script setup lang="ts">
import { useLocalStorage } from "@tracepilot/ui";
import {
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  Code,
  Columns2,
  Compass,
  GitBranch,
  Heart,
  LayoutGrid,
  Moon,
  Network,
  Play,
  Plug,
  Rocket,
  Search,
  Settings,
  Sliders,
  Sparkles,
  Sun,
  Upload,
  Wrench,
  Zap,
} from "lucide-vue-next";
import { type Component, computed } from "vue";
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

const sidebarIconMap: Record<string, Component> = {
  sessions: LayoutGrid,
  search: Search,
  analytics: BarChart3,
  health: Heart,
  tools: Wrench,
  code: Code,
  models: Network,
  compare: Columns2,
  replay: Play,
  export: Upload,
  orchestration: Compass,
  worktrees: GitBranch,
  launcher: Rocket,
  config: Sliders,
  mcp: Plug,
  skills: Zap,
};

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

const { visiblePrimaryNav, visibleAdvancedNav, orchestrationNav, visibleConfigNav } =
  useSidebarNav();

const activeSidebarId = computed(() => (route.meta?.sidebarId as string) || "sessions");
const sessionCount = computed(() => sessionsStore.visibleSessionCount);
const currentTheme = computed(() => prefsStore.theme);
const isMac = navigator.platform.toUpperCase().includes("MAC");

function toggleTheme() {
  prefsStore.theme = currentTheme.value === "dark" ? "light" : "dark";
}

const dismissedVersion = useLocalStorage<string | null>(DISMISSED_KEY, null, {
  serializer: { read: (raw) => raw, write: (v) => v ?? "" },
  flush: "sync",
});

const isCollapsed = useLocalStorage<boolean>(STORAGE_KEYS.sidebarCollapsed, false);

function toggleCollapsed() {
  isCollapsed.value = !isCollapsed.value;
}

const hasUpdate = computed(() => {
  if (updateResult.value?.hasUpdate !== true) return false;
  return updateResult.value.latestVersion !== dismissedVersion.value;
});

function dismissUpdate() {
  if (updateResult.value?.latestVersion) {
    dismissedVersion.value = updateResult.value.latestVersion;
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
  <aside
    class="sidebar"
    :class="{ collapsed: isCollapsed }"
    role="navigation"
    aria-label="Primary"
    data-testid="app-sidebar"
  >
    <!-- Brand -->
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon" aria-hidden="true">
        <LogoIcon :size="24" />
      </div>
      <span class="sidebar-brand-text">TracePilot</span>
      <button
        v-if="!isCollapsed"
        type="button"
        class="sidebar-collapse-toggle"
        data-testid="sidebar-collapse-toggle"
        aria-label="Collapse sidebar"
        :aria-pressed="isCollapsed"
        title="Collapse sidebar"
        @click="toggleCollapsed"
      >
        <ChevronLeft :size="14" :stroke-width="1.5" aria-hidden="true" />
      </button>
    </div>

    <!-- Collapsed-only expand handle: a clear, discoverable affordance. -->
    <button
      v-if="isCollapsed"
      type="button"
      class="sidebar-expand-handle"
      data-testid="sidebar-brand-expand"
      aria-label="Expand sidebar"
      title="Expand sidebar"
      @click="toggleCollapsed"
    >
      <ChevronRight :size="12" :stroke-width="1.75" aria-hidden="true" />
    </button>

    <!-- Navigation -->
    <nav class="sidebar-nav">
      <!-- Primary -->
      <router-link
        v-for="item in visiblePrimaryNav"
        :key="item.id"
        :to="item.to"
        :data-nav-id="item.id"
        :data-testid="`nav-${item.id}`"
        :title="item.label"
        class="sidebar-nav-item"
        :class="{ active: activeSidebarId === item.id }"
        :aria-current="activeSidebarId === item.id ? 'page' : undefined"
        @click="item.id === 'sessions' && emit('nav-sessions')"
      >
        <span class="nav-icon" aria-hidden="true">
          <component
            v-if="sidebarIconMap[item.icon]"
            :is="sidebarIconMap[item.icon]"
            :size="16"
            :stroke-width="1.5"
          />
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
      <h2 class="sidebar-section-title">Advanced</h2>

      <router-link
        v-for="item in visibleAdvancedNav"
        :key="item.id"
        :to="item.to"
        :data-nav-id="item.id"
        :data-testid="`nav-${item.id}`"
        :title="item.label"
        class="sidebar-nav-item"
        :class="{ active: activeSidebarId === item.id }"
        :aria-current="activeSidebarId === item.id ? 'page' : undefined"
      >
        <span class="nav-icon" aria-hidden="true">
          <component
            v-if="sidebarIconMap[item.icon]"
            :is="sidebarIconMap[item.icon]"
            :size="16"
            :stroke-width="1.5"
          />
        </span>
        <span>{{ item.label }}</span>
      </router-link>

      <!-- Orchestration section -->
      <h2 class="sidebar-section-title">Orchestration</h2>

      <router-link
        v-for="item in orchestrationNav"
        :key="item.id"
        :to="item.to"
        :data-nav-id="item.id"
        :data-testid="`nav-${item.id}`"
        :title="item.label"
        class="sidebar-nav-item"
        :class="{ active: activeSidebarId === item.id }"
        :aria-current="activeSidebarId === item.id ? 'page' : undefined"
      >
        <span class="nav-icon" aria-hidden="true">
          <component
            v-if="sidebarIconMap[item.icon]"
            :is="sidebarIconMap[item.icon]"
            :size="16"
            :stroke-width="1.5"
          />
        </span>
        <span>{{ item.label }}</span>
      </router-link>

      <!-- Configuration section -->
      <template v-if="visibleConfigNav.length > 0">
        <h2 class="sidebar-section-title">Configuration</h2>

        <router-link
          v-for="item in visibleConfigNav"
          :key="item.id"
          :to="item.to"
          :data-nav-id="item.id"
          :title="item.label"
          class="sidebar-nav-item"
          :class="{ active: activeSidebarId === item.id }"
          :aria-current="activeSidebarId === item.id ? 'page' : undefined"
        >
          <span class="nav-icon" aria-hidden="true">
            <component
              v-if="sidebarIconMap[item.icon]"
              :is="sidebarIconMap[item.icon]"
              :size="16"
              :stroke-width="1.5"
            />
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
        title="Settings"
        class="sidebar-nav-item"
        :class="{ active: activeSidebarId === 'settings' }"
        :aria-current="activeSidebarId === 'settings' ? 'page' : undefined"
      >
        <span class="nav-icon" aria-hidden="true">
          <Settings :size="16" :stroke-width="1.5" />
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
              <span class="sidebar-update-icon" aria-hidden="true">
                <Sparkles :size="14" :stroke-width="1.5" />
              </span>
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
          <Bell :size="14" :stroke-width="1.5" aria-hidden="true" />
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
          <Sun v-if="currentTheme === 'dark'" :size="14" :stroke-width="1.5" aria-hidden="true" />
          <Moon v-else :size="14" :stroke-width="1.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  </aside>
</template>
