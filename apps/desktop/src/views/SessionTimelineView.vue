<script setup lang="ts">
import { BtnGroup, EmptyState, formatNumberFull, LoadingOverlay, PageHeader } from "@tracepilot/ui";
import { BarChart3 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import AgentMessagesView from "@/components/timeline/AgentMessagesView.vue";
import AgentTreeView from "@/components/timeline/AgentTreeView.vue";
import NestedSwimlanesView from "@/components/timeline/NestedSwimlanesView.vue";
import TurnWaterfallView from "@/components/timeline/TurnWaterfallView.vue";
import { provideSessionAgentDirectory } from "@/composables/useSessionAgentDirectory";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { sessionModel } from "@/utils/sessionModel";

const store = useSessionDetailContext();
const { directory } = provideSessionAgentDirectory(store);

// Load turns when component mounts (if not already loaded)
watch(
  () => store.detail,
  (d) => {
    if (d) store.loadTurns();
  },
  { immediate: true },
);

// ── View mode toggle ─────────────────────────────────────────
const activeView = ref("agent-tree");

// Messages needs at least one subagent to have anything to show.
const hasSubagents = computed(() => (directory.value?.entries.length ?? 0) > 1);

const viewModes = computed(() => [
  { value: "swimlanes", label: "Swimlanes" },
  { value: "waterfall", label: "Waterfall" },
  { value: "agent-tree", label: "Agent Tree" },
  ...(hasSubagents.value ? [{ value: "messages", label: "Messages" }] : []),
]);

watch(hasSubagents, (has) => {
  if (!has && activeView.value === "messages") activeView.value = "agent-tree";
});
</script>

<template>
  <div>
    <LoadingOverlay :loading="store.loading" message="Loading session…">

    <!-- Empty state -->
    <EmptyState v-if="!store.loading && !store.turns.length" title="No Timeline Data" description="This session has no conversation turns to visualize.">
      <template #icon><BarChart3 :size="36" aria-hidden="true" /></template>
    </EmptyState>

    <template v-if="store.turns.length">
      <!-- Header: title + view toggle -->
      <PageHeader
        title="Session Timeline"
        subtitle="Visual timeline of session events and interactions"
        density="compact"
      >
        <template #actions>
          <BtnGroup v-model="activeView" :options="viewModes" />
        </template>
      </PageHeader>

      <!-- Session Info Bar -->
      <div class="session-info-bar" aria-label="Session metadata">
        <span class="session-info-pill">
          <span class="pill-label">ID</span>
          <code class="font-mono" style="font-size: 0.6875rem; color: var(--accent-fg);">
            {{ store.detail?.id?.slice(0, 8) }}…{{ store.detail?.id?.slice(-7) }}
          </code>
        </span>
        <span v-if="sessionModel(store.detail)" class="badge badge-accent">
          {{ sessionModel(store.detail) }}
        </span>
        <span class="session-info-pill">
          <span class="pill-label">Turns</span>
          {{ store.turns.length }}
        </span>
        <span class="session-info-pill">
          <span class="pill-label">Events</span>
          {{ store.detail?.eventCount != null ? formatNumberFull(store.detail.eventCount) : '—' }}
        </span>
      </div>

      <!-- Active sub-view -->
      <ErrorBoundary :key="activeView">
        <NestedSwimlanesView v-if="activeView === 'swimlanes'" />
        <TurnWaterfallView v-else-if="activeView === 'waterfall'" />
        <AgentTreeView v-else-if="activeView === 'agent-tree'" />
        <AgentMessagesView v-else-if="activeView === 'messages'" />
      </ErrorBoundary>
    </template>
    </LoadingOverlay>
  </div>
</template>

<style scoped>
/* Session info bar */
.session-info-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.session-info-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.pill-label {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.625rem;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}
</style>
