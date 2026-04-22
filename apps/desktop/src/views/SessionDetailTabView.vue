<script setup lang="ts">
/**
 * SessionDetailTabView — per-tab session detail view.
 *
 * Creates its own session detail instance via createSessionDetailInstance(),
 * provides it to children via provide(SESSION_DETAIL_KEY), and delegates
 * ALL header/actions rendering to SessionDetailPanel. Inner tab content
 * is rendered via dynamic component :is (not router-view).
 *
 * This enables multiple concurrent session detail views, each with isolated state.
 */
import { computed, defineAsyncComponent, provide, watch } from "vue";
import SessionDetailPanel from "@/components/session/SessionDetailPanel.vue";
import { NAVIGATE_CHECKPOINT_KEY } from "@/composables/useCheckpointNavigation";
import {
  createSessionDetailInstance,
  SESSION_DETAIL_KEY,
  toSessionDetailContext,
} from "@/composables/useSessionDetail";
import { useWindowRole } from "@/composables/useWindowRole";
import { useSessionTabsStore } from "@/stores/sessionTabs";

// ── Lazy-loaded inner tab components ──────────────────────────────────
const innerTabComponents: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  overview: defineAsyncComponent(() => import("@/views/tabs/OverviewTab.vue")),
  conversation: defineAsyncComponent(() => import("@/views/tabs/ConversationTab.vue")),
  events: defineAsyncComponent(() => import("@/views/tabs/EventsTab.vue")),
  todos: defineAsyncComponent(() => import("@/views/tabs/TodosTab.vue")),
  metrics: defineAsyncComponent(() => import("@/views/tabs/MetricsTab.vue")),
  "token-flow": defineAsyncComponent(() => import("@/views/tabs/TokenFlowTab.vue")),
  explorer: defineAsyncComponent(() => import("@/views/tabs/ExplorerTab.vue")),
  timeline: defineAsyncComponent(() => import("@/views/SessionTimelineView.vue")),
};

const props = defineProps<{
  sessionId: string;
  activeSubTab: string;
}>();

const emit = defineEmits<{
  "update:activeSubTab": [value: string];
}>();

// ── Per-instance session detail composable ───────────────────────────
const rawInstance = createSessionDetailInstance();
const store = toSessionDetailContext(rawInstance);
provide(SESSION_DETAIL_KEY, store);

const { isViewer } = useWindowRole();
const tabStore = useSessionTabsStore();

const currentInnerComponent = computed(
  () => innerTabComponents[props.activeSubTab] ?? innerTabComponents.overview,
);

// ── Auto-refresh gate: pauses when this tab is not the active one ────
// In viewer windows, always visible (single session per window)
const isTabVisible = computed(
  () => isViewer() || tabStore.activeTab?.sessionId === props.sessionId,
);

// Update tab label when session summary loads (main window only)
watch(
  () => store.detail?.summary,
  (summary) => {
    if (summary && !isViewer()) {
      tabStore.updateLabel(props.sessionId, summary);
    }
  },
);

function onIsActiveChange(active: boolean) {
  if (!isViewer()) tabStore.setTabActive(props.sessionId, active);
}

// ── Checkpoint navigation (conversation → overview tab) ─────────
provide(NAVIGATE_CHECKPOINT_KEY, (checkpointNumber: number) => {
  store.focusCheckpoint(checkpointNumber);
  emit("update:activeSubTab", "overview");
});
</script>

<template>
  <SessionDetailPanel
    :store="store"
    :session-id="sessionId"
    :router="null"
    tab-mode="local"
    :active-sub-tab="activeSubTab"
    :fill-content="activeSubTab === 'explorer'"
    :refresh-enabled="isTabVisible"
    @update:active-sub-tab="emit('update:activeSubTab', $event)"
    @update:is-active="onIsActiveChange"
  >
    <component :is="currentInnerComponent" />
  </SessionDetailPanel>
</template>
