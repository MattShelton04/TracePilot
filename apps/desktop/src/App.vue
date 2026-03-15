<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import AppSidebar from '@/components/layout/AppSidebar.vue';
import BreadcrumbNav from '@/components/layout/BreadcrumbNav.vue';
import SetupWizard from '@/components/SetupWizard.vue';
import { useSessionsStore } from '@/stores/sessions';
import { usePreferencesStore } from '@/stores/preferences';
import { checkConfigExists } from '@tracepilot/client';

const route = useRoute();
const sessionsStore = useSessionsStore();
const prefsStore = usePreferencesStore();

const showSetup = ref(true);
const appReady = ref(false);

onMounted(async () => {
  try {
    const exists = await checkConfigExists();
    if (exists) {
      showSetup.value = false;
      sessionsStore.fetchSessions();
    }
  } catch {
    showSetup.value = false;
    sessionsStore.fetchSessions();
  }
  appReady.value = true;
});

function onSetupComplete() {
  showSetup.value = false;
  sessionsStore.fetchSessions();
}

const breadcrumbs = computed(() => {
  const crumbs: { label: string; to?: string }[] = [{ label: 'Sessions', to: '/' }];

  if (route.name === 'sessions' || route.name === 'not-found') {
    return [{ label: 'Sessions' }];
  }

  // Session detail pages
  if (route.params.id) {
    const detail = sessionsStore.sessions.find(s => s.id === route.params.id);
    const sessionLabel = detail?.summary?.slice(0, 40) || `Session ${String(route.params.id).slice(0, 8)}`;
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
  <SetupWizard v-if="appReady && showSetup" @setup-complete="onSetupComplete" />
  <div v-else-if="appReady" class="app-layout">
    <!-- Ambient background (matches setup wizard aesthetic) -->
    <div class="app-bg" aria-hidden="true">
      <div class="app-dot-grid" />
      <div class="app-orb app-orb-1" />
      <div class="app-orb app-orb-2" />
    </div>
    <AppSidebar />
    <div class="main-content">
      <div class="page-header-bar">
        <BreadcrumbNav :items="breadcrumbs" />
      </div>
      <router-view />
    </div>
  </div>
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
