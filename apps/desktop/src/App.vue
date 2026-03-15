<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import AppSidebar from '@/components/layout/AppSidebar.vue';
import BreadcrumbNav from '@/components/layout/BreadcrumbNav.vue';
import { useSessionsStore } from '@/stores/sessions';
import { usePreferencesStore } from '@/stores/preferences';

const route = useRoute();
const sessionsStore = useSessionsStore();
const prefsStore = usePreferencesStore();

onMounted(() => {
  sessionsStore.fetchSessions();
});

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
  <div class="app-layout">
    <AppSidebar />
    <div class="main-content">
      <div class="page-header-bar">
        <BreadcrumbNav :items="breadcrumbs" />
      </div>
      <router-view />
    </div>
  </div>
</template>
