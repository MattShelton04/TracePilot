<script setup lang="ts">
import { checkConfigExists } from '@tracepilot/client';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ConfirmDialog, ToastContainer } from '@tracepilot/ui';
import ErrorBoundary from '@/components/ErrorBoundary.vue';
import IndexingLoadingScreen from '@/components/IndexingLoadingScreen.vue';
import SearchPalette from '@/components/SearchPalette.vue';
import AppSidebar from '@/components/layout/AppSidebar.vue';
import BreadcrumbNav from '@/components/layout/BreadcrumbNav.vue';
import SetupWizard from '@/components/SetupWizard.vue';
import UpdateInstructionsModal from '@/components/UpdateInstructionsModal.vue';
import WhatsNewModal from '@/components/WhatsNewModal.vue';
import { initAppVersion, useAppVersion } from '@/composables/useAppVersion';
import { runUpdateCheck } from '@/composables/useUpdateCheck';
import { useWhatsNew } from '@/composables/useWhatsNew';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionsStore } from '@/stores/sessions';

type AppPhase = 'loading' | 'setup' | 'indexing' | 'app';

const route = useRoute();
const sessionsStore = useSessionsStore();
const prefsStore = usePreferencesStore();
const { appVersion } = useAppVersion();

const phase = ref<AppPhase>('loading');
const expectedSessionCount = ref(0);
const showUpdateModal = ref(false);

const {
  showWhatsNew,
  whatsNewPreviousVersion,
  whatsNewCurrentVersion,
  whatsNewEntries,
  openWhatsNew,
  closeWhatsNew,
} = useWhatsNew();

onMounted(async () => {
  // Initialize app version from Tauri runtime (or 'dev' in browser mode)
  await initAppVersion();

  try {
    const exists = await checkConfigExists();
    if (exists) {
      phase.value = 'app';
      sessionsStore.fetchSessions();
      // Wait for preferences to load from config.toml before using config-backed values
      await prefsStore.whenReady;
      // Post-load hooks: version change detection + update check
      await checkVersionChange();
      if (prefsStore.checkForUpdates) {
        runUpdateCheck();
      }
    } else {
      phase.value = 'setup';
    }
  } catch {
    phase.value = 'app';
    sessionsStore.fetchSessions();
  }
});

async function checkVersionChange() {
  const current = appVersion.value;
  if (current === 'dev') return;

  const previous = prefsStore.lastSeenVersion;
  if (previous && previous !== current) {
    await openWhatsNew(previous, current);
  }
  prefsStore.lastSeenVersion = current;
}

function onSetupSaved(sessionCount: number) {
  expectedSessionCount.value = sessionCount;
  phase.value = 'indexing';
  // Config.toml now exists — re-hydrate preferences so the auto-save watcher
  // is armed and any preference changes made in this session will persist.
  prefsStore.hydrate();
  // Indexing is triggered by the loading screen component itself
  // after it registers its event listeners (prevents race condition).
}

function onSetupComplete() {
  phase.value = 'app';
  // Config.toml now exists — arm the auto-save watcher
  prefsStore.hydrate();
  sessionsStore.fetchSessions();
}

function onIndexingComplete() {
  phase.value = 'app';
  sessionsStore.fetchSessions();
}

const breadcrumbs = computed(() => {
  const crumbs: { label: string; to?: string }[] = [{ label: 'Sessions', to: '/' }];

  if (route.name === 'sessions' || route.name === 'not-found') {
    return [{ label: 'Sessions' }];
  }

  // Session detail pages
  if (route.params.id) {
    const detail = sessionsStore.sessions.find((s) => s.id === route.params.id);
    const sessionLabel =
      detail?.summary?.slice(0, 40) || `Session ${String(route.params.id).slice(0, 8)}`;
    crumbs.push({ label: sessionLabel, to: `/session/${route.params.id}/overview` });

    if (route.meta?.title && route.meta.title !== 'Session Detail') {
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
    <AppSidebar @view-update-details="showUpdateModal = true" />
    <div class="main-content">
      <div class="page-header-bar">
        <BreadcrumbNav :items="breadcrumbs" />
      </div>
      <ErrorBoundary>
        <router-view />
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
    @close="closeWhatsNew"
  />

  <!-- Global UI hosts — mounted once, consumed by composables everywhere -->
  <ToastContainer />
  <ConfirmDialog />
  <SearchPalette />
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
  background: #6366f1;
  top: -200px;
  right: -150px;
}

.app-orb-2 {
  width: 500px;
  height: 500px;
  background: #8b5cf6;
  bottom: -180px;
  left: -120px;
}

.app-layout {
  position: relative;
  z-index: 1;
}
</style>
