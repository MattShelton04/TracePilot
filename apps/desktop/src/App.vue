<script setup lang="ts">
import { checkConfigExists, getConfig, saveConfig } from "@tracepilot/client";
import { ConfirmDialog, ToastContainer } from "@tracepilot/ui";
import { computed, onMounted, provide, ref, watch } from "vue";
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
import { initAppVersion, useAppVersion } from "@/composables/useAppVersion";
import { runUpdateCheck } from "@/composables/useUpdateCheck";
import { useAlertWatcher } from "@/composables/useAlertWatcher";
import { registerNotificationClickHandler } from "@/composables/useAlertDispatcher";
import { resolveWindowRole, useWindowRole } from "@/composables/useWindowRole";
import { useWhatsNew } from "@/composables/useWhatsNew";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";
import { useSessionTabsStore } from "@/stores/sessionTabs";
import { logError } from "@/utils/logger";
import { openExternal } from "@/utils/openExternal";

type AppPhase = "loading" | "setup" | "indexing" | "app";

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const prefsStore = usePreferencesStore();
const tabStore = useSessionTabsStore();
const { appVersion } = useAppVersion();
const { isMain } = useWindowRole();

const phase = ref<AppPhase>("loading");
const expectedSessionCount = ref(0);
const showUpdateModal = ref(false);

const {
  showWhatsNew,
  whatsNewPreviousVersion,
  whatsNewCurrentVersion,
  whatsNewEntries,
  whatsNewReleaseUrl,
  openWhatsNew,
  closeWhatsNew,
} = useWhatsNew();

onMounted(async () => {
  // Resolve window role before any role-gated logic
  await resolveWindowRole();

  // Initialize app version from Tauri runtime (or 'dev' in browser mode)
  await initAppVersion();

  try {
    const exists = await checkConfigExists();
    if (exists) {
      // Check if setup was completed — if not, the user interrupted the
      // setup wizard during indexing.  Restart the entire setup flow.
      const cfg = await getConfig();
      if (!cfg.general.setupComplete) {
        phase.value = "setup";
        return;
      }

      phase.value = "app";
      await sessionsStore.fetchSessions();
      // Signal that the app is fully initialized for automation (CDP / Playwright).
      // Placed here (not main.ts) so it fires only after config + setup checks pass.
      (window as unknown as Record<string, unknown>).__TRACEPILOT_READY__ = true;
      // Wait for preferences to load from config.toml before using config-backed values
      await prefsStore.whenReady;

      // Start alert watcher after prefs + sessions are available (main window only)
      if (isMain()) {
        useAlertWatcher();
        registerNotificationClickHandler();

        // Close all viewer windows when the main window is closed
        import("@tauri-apps/api/window").then(({ getCurrentWindow, getAllWindows }) => {
          const mainWin = getCurrentWindow();
          mainWin.onCloseRequested(async (event) => {
            event.preventDefault();
            try {
              const all = await getAllWindows();
              await Promise.allSettled(
                all.filter((w) => w.label.startsWith("viewer-")).map((w) => w.close()),
              );
            } catch { /* best-effort */ }
            await mainWin.destroy();
          });
        }).catch(() => {});

        // Listen for popup window close events to update monitored session set
        import("@tauri-apps/api/event").then(({ listen }) => {
          listen<{ sessionId: string }>("popup-session-closed", (event) => {
            tabStore.unregisterPopup(event.payload.sessionId);
          });
        }).catch(() => {});
      }

      // Post-load hooks: version change detection + update check
      await checkVersionChange();
      if (prefsStore.checkForUpdates) {
        runUpdateCheck();
      }
    } else {
      phase.value = "setup";
    }
  } catch {
    phase.value = "app";
    sessionsStore.fetchSessions();
    (window as unknown as Record<string, unknown>).__TRACEPILOT_READY__ = true;
  }
});

async function checkVersionChange() {
  const current = appVersion.value;
  if (current === "dev") return;

  const previous = prefsStore.lastSeenVersion;
  if (previous && previous !== current) {
    await openWhatsNew(previous, current);
  }
  prefsStore.lastSeenVersion = current;
}

function onSetupSaved(sessionCount: number) {
  expectedSessionCount.value = sessionCount;
  phase.value = "indexing";
  // Config.toml now exists — re-hydrate preferences so the auto-save watcher
  // is armed and any preference changes made in this session will persist.
  prefsStore.hydrate();
  // Indexing is triggered by the loading screen component itself
  // after it registers its event listeners (prevents race condition).
}

function onSetupComplete() {
  phase.value = "app";
  // Config.toml now exists — arm the auto-save watcher
  prefsStore.hydrate();
  sessionsStore.fetchSessions();
}

async function onIndexingComplete() {
  // Mark setup as fully complete so interrupted indexing won't restart setup
  try {
    const cfg = await getConfig();
    cfg.general.setupComplete = true;
    await saveConfig(cfg);
  } catch (e) {
    logError("[app] Failed to save setupComplete flag:", e);
  }
  phase.value = "app";
  sessionsStore.fetchSessions();
}

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
      router.push("/").finally(() => {
        suppressTabDeactivation = false;
      });
    }
  },
);

function onTabGoHome() {
  tabStore.deactivateAll();
  router.push("/");
}

const breadcrumbs = computed(() => {
  const crumbs: { label: string; to?: string }[] = [{ label: "Sessions", to: "/" }];

  // Tab mode: breadcrumbs reflect the active tab
  if (isTabViewActive.value) {
    const tab = tabStore.activeTab!;
    crumbs.push({ label: tab.label });
    return crumbs;
  }

  if (route.name === "sessions" || route.name === "not-found") {
    return [{ label: "Sessions" }];
  }

  // Session detail pages (legacy route mode)
  if (route.params.id) {
    const detail = sessionsStore.sessions.find((s) => s.id === route.params.id);
    const sessionLabel =
      detail?.summary?.slice(0, 40) || `Session ${String(route.params.id).slice(0, 8)}`;
    crumbs.push({ label: sessionLabel, to: `/session/${route.params.id}/overview` });

    if (route.meta?.title && route.meta.title !== "Session Detail") {
      crumbs.push({ label: route.meta.title as string });
    }
    return crumbs;
  }

  // Top-level pages
  if (route.meta?.title) {
    return [{ label: route.meta.title as string }];
  }

  return crumbs;
});
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
