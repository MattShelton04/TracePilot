<script setup lang="ts">
import { BtnGroup, EmptyState, formatNumberFull, LoadingOverlay } from "@tracepilot/ui";
import { ref, watch } from "vue";
import AgentTreeView from "@/components/timeline/AgentTreeView.vue";
import NestedSwimlanesView from "@/components/timeline/NestedSwimlanesView.vue";
import TurnWaterfallView from "@/components/timeline/TurnWaterfallView.vue";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";

const store = useSessionDetailContext();

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

const viewModes = [
  { value: "swimlanes", label: "Swimlanes" },
  { value: "waterfall", label: "Waterfall" },
  { value: "agent-tree", label: "Agent Tree" },
];
</script>

<template>
  <div>
    <LoadingOverlay :loading="store.loading" message="Loading session…">

    <!-- Empty state -->
    <EmptyState v-if="!store.loading && !store.turns.length" icon="📊" title="No Timeline Data" message="This session has no conversation turns to visualize." />

    <template v-if="store.turns.length">
      <!-- Header: title + view toggle -->
      <div class="timeline-header">
        <div>
          <h1 class="page-title">Session Timeline</h1>
          <p class="page-subtitle">Visual timeline of session events and interactions</p>
        </div>
        <BtnGroup v-model="activeView" :options="viewModes" />
      </div>

      <!-- Session Info Bar -->
      <div class="session-info-bar" aria-label="Session metadata">
        <span class="session-info-pill">
          <span class="pill-label">ID</span>
          <code class="font-mono" style="font-size: 0.6875rem; color: var(--accent-fg);">
            {{ store.detail?.id?.slice(0, 8) }}…{{ store.detail?.id?.slice(-7) }}
          </code>
        </span>
        <span v-if="store.shutdownMetrics?.currentModel" class="badge badge-accent">
          {{ store.shutdownMetrics.currentModel }}
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
      <NestedSwimlanesView v-if="activeView === 'swimlanes'" />
      <TurnWaterfallView v-else-if="activeView === 'waterfall'" />
      <AgentTreeView v-else-if="activeView === 'agent-tree'" />
    </template>
    </LoadingOverlay>
  </div>
</template>

<style scoped>
.timeline-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

/* Session info bar */
.session-info-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--canvas-raised, #161b22);
  border: 1px solid var(--border-default, #30363d);
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
