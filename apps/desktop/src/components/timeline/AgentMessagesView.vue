<script setup lang="ts">
/**
 * Timeline → Messages: how the session's agents communicated over time.
 *
 * One communication timeline feeds three interchangeable diagrams (sequence,
 * lanes, graph playback) and the message log beneath them. Filters and the
 * selected exchange are shared, so selecting in one place selects everywhere.
 */
import type { CommsFilter } from "@tracepilot/ui";
import {
  buildCommsTimeline,
  buildTimeScale,
  DEFAULT_COMMS_FILTER,
  EmptyState,
  filterCommsEvents,
  SearchInput,
  SegmentedControl,
  summarizeAgentCommunications,
  useAgentDirectory,
  useTimelinePlayback,
} from "@tracepilot/ui";
import { MessagesSquare } from "lucide-vue-next";
import { computed, reactive, ref, watch } from "vue";
import CommsGraph from "@/components/timeline/messages/CommsGraph.vue";
import CommsLaneDiagram from "@/components/timeline/messages/CommsLaneDiagram.vue";
import CommsMessageLog from "@/components/timeline/messages/CommsMessageLog.vue";
import CommsSequenceDiagram from "@/components/timeline/messages/CommsSequenceDiagram.vue";
import {
  EDGE_KINDS,
  EDGE_LABELS,
  PACK_THRESHOLD,
} from "@/components/timeline/messages/commsVisuals";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import "@/styles/features/agent-messages.css";

type Diagram = "sequence" | "lanes" | "graph";

const store = useSessionDetailContext();
const { directory, communications } = useAgentDirectory();

const timeline = computed(() =>
  directory.value ? buildCommsTimeline(store.turns, directory.value, communications.value) : null,
);

/** Idle gaps collapse on the lanes axis and during graph playback. */
const scale = computed(() => (timeline.value ? buildTimeScale(timeline.value) : null));

/** Large teams pack agents that never overlap into shared columns and lanes. */
const canPack = computed(() => (timeline.value?.agents.length ?? 0) > PACK_THRESHOLD);
const packPreferred = ref(true);
const packed = computed(() => canPack.value && packPreferred.value);

const filter = reactive<CommsFilter>({ ...DEFAULT_COMMS_FILTER });
const events = computed(() =>
  timeline.value ? filterCommsEvents(timeline.value.events, filter) : [],
);
const selectedId = ref<string | null>(null);

const diagram = ref<Diagram>("sequence");
const diagramOptions = [
  { value: "sequence", label: "Sequence" },
  { value: "lanes", label: "Lanes" },
  { value: "graph", label: "Graph" },
];

const playback = useTimelinePlayback(() => scale.value?.durationMs ?? 0);
watch(diagram, () => playback.pause());

// Drop a selection the filters have hidden.
watch(events, (list) => {
  if (selectedId.value && !list.some((e) => e.id === selectedId.value)) selectedId.value = null;
});

const stats = computed(() => summarizeAgentCommunications(communications.value));
const kindCounts = computed(() => {
  const counts = { launch: 0, message: 0, read: 0 };
  for (const ev of timeline.value?.events ?? []) counts[ev.comm.kind]++;
  return counts;
});

const kindToggles = computed(() => [
  { field: "launches" as const, label: "Launches", count: kindCounts.value.launch },
  { field: "messages" as const, label: "Messages", count: kindCounts.value.message },
  { field: "reads" as const, label: "Reads", count: kindCounts.value.read },
]);

const summary = computed(() => {
  const s = stats.value;
  return [
    { label: s.messages === 1 ? "message" : "messages", value: s.messages, always: true },
    { label: "peer", value: s.peerMessages },
    { label: s.broadcasts === 1 ? "broadcast" : "broadcasts", value: s.broadcasts },
    { label: "queued", value: s.queued },
    { label: s.reads === 1 ? "read" : "reads", value: s.reads },
    { label: s.polls === 1 ? "poll" : "polls", value: s.polls },
    { label: "not delivered", value: s.failed },
  ].filter((item) => item.always || item.value > 0);
});

function setFocus(key: string | null) {
  filter.agentKey = key;
}

function onAgentSelect(e: Event) {
  setFocus((e.target as HTMLSelectElement).value || null);
}
</script>

<template>
  <EmptyState
    v-if="!timeline || !timeline.events.length"
    title="No agent exchanges"
    description="This session has no subagent launches, messages or reads to show."
  >
    <template #icon><MessagesSquare :size="36" aria-hidden="true" /></template>
  </EmptyState>

  <div v-else class="comms-view">
    <div class="comms-toolbar">
      <SegmentedControl v-model="diagram" :options="diagramOptions" aria-label="Diagram" />
      <div class="comms-toolbar-group" role="group" aria-label="Exchange kinds">
        <button
          v-for="t in kindToggles"
          :key="t.field"
          type="button"
          class="comms-toggle"
          :aria-pressed="filter[t.field]"
          @click="filter[t.field] = !filter[t.field]"
        >
          {{ t.label }} <span class="comms-toggle-count">{{ t.count }}</span>
        </button>
      </div>
      <select
        id="comms-agent-filter"
        class="filter-select"
        aria-label="Agent"
        :value="filter.agentKey ?? ''"
        @change="onAgentSelect"
      >
        <option value="">All agents</option>
        <option v-for="a in timeline.agents" :key="a.key" :value="a.key">
          {{ "  ".repeat(a.depth) }}{{ a.name }}
        </option>
      </select>
      <button
        v-if="canPack && diagram !== 'graph'"
        type="button"
        class="comms-toggle"
        :aria-pressed="packPreferred"
        title="Agents that never ran at the same time share a column"
        @click="packPreferred = !packPreferred"
      >
        Pack agents
      </button>
      <span class="comms-toolbar-spacer" />
      <SearchInput v-model="filter.query" class="comms-search" placeholder="Search messages" />
    </div>

    <div class="comms-summary">
      <span v-for="item in summary" :key="item.label" class="comms-stat">
        <strong>{{ item.value }}</strong> {{ item.label }}
      </span>
      <div class="comms-legend" aria-label="Legend">
        <span v-for="kind in EDGE_KINDS" :key="kind" :class="['comms-legend-item', `edge--${kind}`]">
          <span :class="['comms-legend-swatch', { 'comms-legend-swatch--dashed': kind === 'read' }]" />
          {{ EDGE_LABELS[kind] }}
        </span>
      </div>
    </div>

    <CommsSequenceDiagram
      v-if="diagram === 'sequence'"
      :timeline="timeline"
      :events="events"
      :packed="packed"
      :selected-id="selectedId"
      :focus-key="filter.agentKey ?? null"
      @select="selectedId = $event"
      @focus="setFocus"
    />
    <CommsLaneDiagram
      v-else-if="diagram === 'lanes' && scale"
      :timeline="timeline"
      :events="events"
      :scale="scale"
      :packed="packed"
      :selected-id="selectedId"
      :focus-key="filter.agentKey ?? null"
      @select="selectedId = $event"
      @focus="setFocus"
    />
    <CommsGraph
      v-else-if="scale"
      :timeline="timeline"
      :events="events"
      :scale="scale"
      :selected-id="selectedId"
      :playback="playback"
      @select="selectedId = $event"
    />

    <CommsMessageLog
      :timeline="timeline"
      :events="events"
      :selected-id="selectedId"
      :playhead-ms="diagram === 'graph' && scale ? scale.toReal(playback.positionMs.value) : null"
      @select="selectedId = $event"
    />
  </div>
</template>
