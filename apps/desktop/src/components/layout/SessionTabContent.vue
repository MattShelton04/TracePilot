<script setup lang="ts">
/**
 * SessionTabContent — renders all open session tabs, showing only the
 * active one. Each tab is a separate SessionDetailTabView instance with
 * its own composable (via provide/inject), eliminating the singleton
 * store problem.
 *
 * We use v-for + v-show instead of keep-alive because Vue's keep-alive
 * matches on component *name*, not *key*. Since every tab renders the
 * same component (SessionDetailTabView), the :include approach cannot
 * distinguish instances. Rendering all tabs simultaneously with v-show
 * preserves scroll position, expanded sections, and loaded data.
 *
 * Tabs are destroyed on close (removed from tabs array → removed from
 * v-for), freeing their composable and DOM resources.
 */
import { computed } from "vue";
import SessionDetailTabView from "@/views/SessionDetailTabView.vue";
import { useSessionTabsStore } from "@/stores/sessionTabs";

const tabStore = useSessionTabsStore();

const activeSessionId = computed(() => tabStore.activeTab?.sessionId ?? null);
const hasTabs = computed(() => tabStore.tabCount > 0);
</script>

<template>
  <div v-if="hasTabs" class="session-tab-content">
    <SessionDetailTabView
      v-for="tab in tabStore.tabs"
      v-show="tab.sessionId === activeSessionId"
      :key="`sd-tab-${tab.sessionId}`"
      :session-id="tab.sessionId"
      :active-sub-tab="tab.activeSubTab"
      @update:active-sub-tab="tabStore.setSubTab(tab.sessionId, $event)"
    />
  </div>
  <div v-else class="session-tab-empty">
    <p class="text-muted">Open a session from the sidebar to begin.</p>
  </div>
</template>

<style scoped>
.session-tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.session-tab-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 0.875rem;
}
</style>
