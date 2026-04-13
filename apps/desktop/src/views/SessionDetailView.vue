<script setup lang="ts">
/**
 * SessionDetailView — route-driven session detail view.
 *
 * Uses the Pinia singleton store and delegates ALL header/actions/tab-nav
 * rendering to SessionDetailPanel. Inner tab content is provided via
 * router-view (child routes).
 */
import { computed, inject, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SessionDetailPanel from "@/components/session/SessionDetailPanel.vue";
import { usePerfMonitor } from "@/composables/usePerfMonitor";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import type { Ref } from "vue";

const route = useRoute();
const router = useRouter();
const store = useSessionDetailStore();
usePerfMonitor("SessionDetailView");

const sessionId = computed(() => route.params.id as string);

// When the tab view is active, this route view is hidden via v-show.
// Disable auto-refresh to avoid wasting resources behind the scenes.
const routeViewVisible = inject<Ref<boolean>>("routeViewVisible", ref(true));

// Reload when route param changes (e.g. navigating between sessions)
watch(sessionId, (newId) => {
  if (newId) store.loadDetail(newId);
});

// Note: we intentionally do NOT call store.reset() on unmount.
// The store handles re-initialization when switching sessions via loadDetail(newId).
</script>

<template>
  <SessionDetailPanel
    :store="(store as unknown as SessionDetailContext)"
    :session-id="sessionId"
    :router="router"
    :refresh-enabled="routeViewVisible"
    tab-mode="router"
  >
    <router-view :key="`${sessionId}-${String(route.name)}`" />
  </SessionDetailPanel>
</template>