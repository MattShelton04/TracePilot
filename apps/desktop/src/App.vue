<script setup lang="ts">
import { ConfirmDialog, ToastContainer } from "@tracepilot/ui";
import { computed, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import IndexingLoadingScreen from "@/components/IndexingLoadingScreen.vue";
import AlertCenterDrawer from "@/components/layout/AlertCenterDrawer.vue";
import AppSidebar from "@/components/layout/AppSidebar.vue";
import BreadcrumbNav from "@/components/layout/BreadcrumbNav.vue";
import SessionTabContent from "@/components/layout/SessionTabContent.vue";
import SessionTabStrip from "@/components/layout/SessionTabStrip.vue";
import SearchPalette from "@/components/SearchPalette.vue";
import SetupWizard from "@/components/SetupWizard.vue";
import UpdateInstructionsModal from "@/components/UpdateInstructionsModal.vue";
import WhatsNewModal from "@/components/WhatsNewModal.vue";
import { useBootstrapPhase } from "@/composables/useBootstrapPhase";
import { useBreadcrumbs } from "@/composables/useBreadcrumbs";
import { useWhatsNew } from "@/composables/useWhatsNew";
import { useWindowLifecycle } from "@/composables/useWindowLifecycle";
import { useWindowRole } from "@/composables/useWindowRole";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useSessionTabsStore } from "@/stores/sessionTabs";
import { openExternal } from "@/utils/openExternal";

const route = useRoute();
const router = useRouter();
const tabStore = useSessionTabsStore();
const { isMain } = useWindowRole();

const showUpdateModal = ref(false);

// Window + event listener ownership lives in a dedicated composable so HMR
// and window teardown can release the handles (Phase 1A.7).  MUST be invoked
// synchronously from <script setup> so `onScopeDispose` attaches correctly
// — the composable itself gates on `enabled` so it is cheap to install
// unconditionally and takes effect once the window role resolves.
useWindowLifecycle({
  enabled: () => isMain(),
  onPopupClosed: (sessionId) => {
    tabStore.unregisterPopup(sessionId);
  },
});

const { phase, expectedSessionCount, onSetupSaved, onSetupComplete, onIndexingComplete } =
  useBootstrapPhase();

const {
  showWhatsNew,
  whatsNewPreviousVersion,
  whatsNewCurrentVersion,
  whatsNewEntries,
  whatsNewReleaseUrl,
  closeWhatsNew,
} = useWhatsNew();

/**
 * Tab view vs router-view switching logic.
 *
 * The tab strip has a "Sessions" home pill. Clicking it deactivates all tabs
 * and returns to the session list. Navigating via sidebar (settings, etc.)
 * also hides the tab view. Activating a tab brings it back.
 */

/** Routes that are compatible with showing the tab view on top */
const isSessionRoute = computed(() => {
  const name = route.name as string | undefined;
  return !name || name === "sessions" || name === "not-found" || route.path.startsWith("/session/");
});

/** Whether the tab view is currently displaying */
const isTabViewActive = computed(
  () => tabStore.tabCount > 0 && tabStore.activeTab !== null && isSessionRoute.value,
);

// Expose route-view visibility so child components (SessionDetailView)
// can disable auto-refresh when hidden behind the tab view.
const routeViewVisible = computed(() => !isTabViewActive.value);
provide("routeViewVisible", routeViewVisible);

// When the user navigates away from session-compatible routes (e.g. settings),
// deactivate tab selection so the router-view shows through.
// Note: navigating to "/" (sessions list) is handled by sidebar's @nav-sessions
// and tab strip's @go-home, not this watcher.
let suppressTabDeactivation = false;

watch(
  () => route.fullPath,
  () => {
    if (suppressTabDeactivation) return;
    if (!isSessionRoute.value) {
      tabStore.deactivateAll();
    }
  },
);

// Re-show tab view when a tab is activated (e.g. clicking tab strip)
watch(
  () => tabStore.activeTab,
  (tab) => {
    if (tab && !isSessionRoute.value) {
      // Suppress the route watcher so it doesn't immediately deactivate
      suppressTabDeactivation = true;
      pushRoute(router, ROUTE_NAMES.sessions).finally(() => {
        suppressTabDeactivation = false;
      });
    }
  },
);

function onTabGoHome() {
  tabStore.deactivateAll();
  pushRoute(router, ROUTE_NAMES.sessions);
}

const { breadcrumbs } = useBreadcrumbs(isTabViewActive);
</script>

<template>
  <SetupWizard
    v-if="phase === 'setup'"
    @setup-saved="onSetupSaved"
    @setup-complete="onSetupComplete"
  />
  <IndexingLoadingScreen
    v-else-if="phase === 'indexing'"
    :total-sessions="expectedSessionCount"
    @complete="onIndexingComplete"
  />
  <div v-else-if="phase === 'app'" class="app-layout">
    <!-- Ambient background (matches setup wizard aesthetic) -->
    <div class="app-bg" aria-hidden="true">
      <div class="app-dot-grid" />
      <div class="app-orb app-orb-1" />
      <div class="app-orb app-orb-2" />
    </div>
    <AppSidebar @view-update-details="showUpdateModal = true" @nav-sessions="onTabGoHome" />
    <div class="main-content">
      <div class="page-header-bar">
        <BreadcrumbNav :items="breadcrumbs" />
      </div>
      <SessionTabStrip :is-session-route="isSessionRoute" @go-home="onTabGoHome" />
      <ErrorBoundary>
        <SessionTabContent v-show="isTabViewActive" />
        <router-view v-show="!isTabViewActive" />
      </ErrorBoundary>
    </div>
  </div>

  <!-- Update instructions modal -->
  <UpdateInstructionsModal
    v-if="showUpdateModal"
    @close="showUpdateModal = false"
  />

  <!-- What's New modal (shown on version change or reopened from settings) -->
  <WhatsNewModal
    v-if="showWhatsNew"
    :previous-version="whatsNewPreviousVersion"
    :current-version="whatsNewCurrentVersion"
    :entries="whatsNewEntries"
    :release-url="whatsNewReleaseUrl"
    @close="closeWhatsNew"
    @open-external="openExternal"
  />

  <!-- Global UI hosts — mounted once, consumed by composables everywhere -->
  <ToastContainer />
  <ConfirmDialog />
  <SearchPalette />
  <AlertCenterDrawer />
</template>

<style scoped>
.app-bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.app-dot-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: 24px 24px;
}

.app-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.07;
}

.app-orb-1 {
  width: 600px;
  height: 600px;
  background: var(--accent-emphasis);
  top: -200px;
  right: -150px;
}

.app-orb-2 {
  width: 500px;
  height: 500px;
  background: var(--done-emphasis);
  bottom: -180px;
  left: -120px;
}

.app-layout {
  position: relative;
  z-index: 1;
}
</style>
