<script setup lang="ts">
import {
  BtnGroup,
  EmptyState,
  ErrorAlert,
  formatNumberFull,
  LoadingOverlay,
  PageHeader,
} from "@tracepilot/ui";
import { BarChart3 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import AgentMessagesView from "@/components/timeline/AgentMessagesView.vue";
import AgentTreeView from "@/components/timeline/AgentTreeView.vue";
import NestedSwimlanesView from "@/components/timeline/NestedSwimlanesView.vue";
import TurnWaterfallView from "@/components/timeline/TurnWaterfallView.vue";
import { isAgentTurn } from "@/composables/useAgentTree";
import { provideSessionAgentDirectory } from "@/composables/useSessionAgentDirectory";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSessionModelName } from "@/composables/useSessionModelName";
import { type SessionTabViews, useSessionTabViews } from "@/composables/useSessionTabViews";
import { sessionModel } from "@/utils/sessionModel";

const store = useSessionDetailContext();
const { directory } = provideSessionAgentDirectory(store);
const modelName = useSessionModelName();

// Load turns when component mounts (if not already loaded)
watch(
  () => store.detail,
  (d) => {
    if (d) store.loadTurns();
  },
  { immediate: true },
);

function retryLoadTurns() {
  store.loaded.delete("turns");
  store.loadTurns();
}

// No turns is only "no timeline data" once the turns load has finished.
const turnsPending = computed(
  () => !store.turns.length && !store.loaded.has("turns") && !store.turnsError,
);

// ── View mode toggle ─────────────────────────────────────────
const tabViews = useSessionTabViews();

type TimelineView = SessionTabViews["timeline"];

// The agent tree draws every subagent call. Messages addresses agents by
// their call ids, so it needs a directory entry beyond the main agent.
const hasAgentTurns = computed(() => store.turns.some(isAgentTurn));
const hasSubagents = computed(() => (directory.value?.entries.length ?? 0) > 1);

function canShow(view: TimelineView): boolean {
  if (view === "agent-tree") return hasAgentTurns.value;
  if (view === "messages") return hasSubagents.value;
  return true;
}

// A remembered view with nothing to show here falls back without forgetting
// the choice for the next session that can show it. Swimlanes is the
// fallback: it lays out the whole session by prompt, where Waterfall pages
// through one turn at a time.
function viewFor(view: TimelineView): TimelineView {
  if (canShow(view)) return view;
  return view === "messages" && hasAgentTurns.value ? "agent-tree" : "swimlanes";
}

// Once turns have loaded, a fallback holds until the user picks a view, so
// a live session that spawns its first subagent doesn't switch views.
const heldView = ref<{ sessionId: string | null; view: TimelineView } | null>(null);

const activeView = computed<TimelineView>({
  get: () =>
    heldView.value?.sessionId === store.sessionId
      ? heldView.value.view
      : viewFor(tabViews.value.timeline),
  set: (view) => {
    heldView.value = null;
    tabViews.value.timeline = view;
  },
});

watch(
  () => [store.turns.length > 0, activeView.value] as const,
  ([hasTurns, view]) => {
    if (hasTurns && view !== tabViews.value.timeline) {
      heldView.value = { sessionId: store.sessionId, view };
    }
  },
  { immediate: true },
);

const viewModes = computed(() => [
  { value: "swimlanes", label: "Swimlanes" },
  { value: "waterfall", label: "Waterfall" },
  ...(canShow("agent-tree") ? [{ value: "agent-tree", label: "Agent Tree" }] : []),
  ...(canShow("messages") ? [{ value: "messages", label: "Messages" }] : []),
]);
</script>

<template>
  <div>
    <LoadingOverlay
      :loading="store.loading || turnsPending"
      :message="store.loading ? 'Loading session…' : 'Loading timeline…'"
    >

    <ErrorAlert
      v-if="store.turnsError"
      :message="store.turnsError"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadTurns"
    />

    <!-- Empty state: only once the turns load has completed -->
    <EmptyState v-if="!store.turns.length && store.loaded.has('turns')" title="No Timeline Data" description="This session has no conversation turns to visualize.">
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
        <span v-if="sessionModel(store.detail)" class="badge badge-accent" :title="sessionModel(store.detail)!">
          {{ modelName(sessionModel(store.detail)!) }}
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
