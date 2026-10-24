<script setup lang="ts">
/**
 * SessionDetailView — route-driven session detail view.
 *
 * Uses the Pinia singleton store and delegates ALL header/actions/tab-nav
 * rendering to SessionDetailPanel. Inner tab content is provided via
 * router-view (child routes).
 */

import type { Ref } from "vue";
import { computed, inject, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SessionDetailPanel from "@/components/session/SessionDetailPanel.vue";
import { NAVIGATE_CHECKPOINT_KEY } from "@/composables/useCheckpointNavigation";
import {
  type ConversationNavigationTarget,
  NAVIGATE_CONVERSATION_KEY,
} from "@/composables/useConversationNavigation";
import { usePerfMonitor } from "@/composables/usePerfMonitor";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { useSessionSource } from "@/composables/useSessionSource";
import { useSubTabScroll } from "@/composables/useSubTabScroll";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { hiddenSessionTabRedirect } from "@/router/sessionTabGuard";
import { useSessionDetailStore } from "@/stores/sessionDetail";

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

// A deep link can reach a tab before the session's source is known; leave it
// once the detail loads if the source cannot fill that tab.
const { source } = useSessionSource(
  () => sessionId.value,
  () => store.detail,
);
watch(
  () => [store.detail, source.value, route.name] as const,
  ([detail, known]) => {
    if (detail?.id !== sessionId.value) return;
    const redirect = hiddenSessionTabRedirect(route, known);
    if (redirect) void router.replace(redirect);
  },
  { immediate: true },
);

// Each tab route remembers its scroll position in the panel's shared scroller.
const panel = ref<{ $el?: unknown } | null>(null);
useSubTabScroll({
  el: () => (panel.value?.$el instanceof HTMLElement ? panel.value.$el : null),
  sessionId: () => sessionId.value,
  subTab: () => String(route.name),
  // A deep link to a turn ("Show in conversation", Search) or a checkpoint scrolls there instead.
  hasFocusTarget: (tab) =>
    (tab === ROUTE_NAMES.sessionConversation &&
      (route.query.turn != null || route.query.event != null)) ||
    (tab === ROUTE_NAMES.sessionOverview && store.pendingCheckpointFocus != null),
});

// Note: we intentionally do NOT call store.reset() on unmount.
// The store handles re-initialization when switching sessions via loadDetail(newId).

// Checkpoint navigation (conversation → overview tab) for route mode
provide(NAVIGATE_CHECKPOINT_KEY, (checkpointNumber: number) => {
  store.focusCheckpoint(checkpointNumber);
  if (route.name !== ROUTE_NAMES.sessionOverview) {
    pushRoute(router, ROUTE_NAMES.sessionOverview, { params: { id: sessionId.value } });
  }
});
provide(NAVIGATE_CONVERSATION_KEY, (target: ConversationNavigationTarget) => {
  pushRoute(router, ROUTE_NAMES.sessionConversation, {
    params: { id: sessionId.value },
    query: {
      turn: String(target.turnIndex),
      ...(target.eventIndex != null ? { event: String(target.eventIndex) } : {}),
    },
  });
});
</script>

<template>
  <SessionDetailPanel
    ref="panel"
    :store="(store as unknown as SessionDetailContext)"
    :session-id="sessionId"
    :router="router"
    :refresh-enabled="routeViewVisible"
    :fill-content="route.name === ROUTE_NAMES.sessionExplorer"
    tab-mode="router"
  >
    <router-view :key="`${sessionId}-${String(route.name)}`" />
  </SessionDetailPanel>
</template>
