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
import { useRouter } from "vue-router";
import SessionDetailPanel from "@/components/session/SessionDetailPanel.vue";
import { NAVIGATE_CHECKPOINT_KEY } from "@/composables/useCheckpointNavigation";
import {
  type ConversationNavigationTarget,
  NAVIGATE_CONVERSATION_KEY,
} from "@/composables/useConversationNavigation";
import {
  createSessionDetailInstance,
  SESSION_DETAIL_KEY,
  toSessionDetailContext,
} from "@/composables/useSessionDetail";
import { useSessionSource } from "@/composables/useSessionSource";
import { NAVIGATE_SESSION_TAB_KEY } from "@/composables/useSessionTabNavigation";
import { useWindowRole } from "@/composables/useWindowRole";
import { DEFAULT_SESSION_TAB, isSessionTabHidden, SESSION_TABS } from "@/config/sessionTabs";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionTabsStore } from "@/stores/sessionTabs";

// ── Lazy-loaded inner tab components, from the tab registry ───────────
const innerTabComponents = Object.fromEntries(
  SESSION_TABS.map((t) => [t.name, defineAsyncComponent(t.component)]),
);

const props = defineProps<{
  sessionId: string;
  activeSubTab: string;
}>();

const emit = defineEmits<{
  "update:activeSubTab": [value: string];
}>();

// ── Per-instance session detail composable ───────────────────────────
const preferences = usePreferencesStore();
const rawInstance = createSessionDetailInstance(preferences.sessionCacheSize);
const store = toSessionDetailContext(rawInstance);
provide(SESSION_DETAIL_KEY, store);

watch(
  () => preferences.sessionCacheSize,
  (size) => rawInstance.setCacheSize(size),
);

const { isViewer } = useWindowRole();
const tabStore = useSessionTabsStore();
// Main-window tabs use the app's router (Export, Replay); a viewer window
// mounts without one.
const router = isViewer() ? null : useRouter();

const currentInnerComponent = computed(
  () => innerTabComponents[props.activeSubTab] ?? innerTabComponents.overview,
);

// A restored or linked sub-tab may be one this session's source hides.
const { capabilities } = useSessionSource(
  () => props.sessionId,
  () => store.detail,
);
watch(
  () => [store.detail, capabilities.value, props.activeSubTab] as const,
  ([detail, caps, tab]) => {
    if (detail?.id !== props.sessionId) return;
    if (isSessionTabHidden(tab, caps)) {
      emit("update:activeSubTab", DEFAULT_SESSION_TAB);
    }
  },
  { immediate: true },
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
provide(NAVIGATE_CONVERSATION_KEY, (target: ConversationNavigationTarget) => {
  store.focusConversation(target.turnIndex, target.eventIndex ?? null);
  emit("update:activeSubTab", "conversation");
});
// Panels here have no route to push (e.g. Metrics → Context).
provide(NAVIGATE_SESSION_TAB_KEY, (tab: string) => {
  emit("update:activeSubTab", tab);
});
</script>

<template>
  <SessionDetailPanel
    :store="store"
    :session-id="sessionId"
    :router="router"
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
