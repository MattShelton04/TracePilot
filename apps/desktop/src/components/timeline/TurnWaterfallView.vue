<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import {
  EmptyState,
  formatDuration,
  TerminologyLegend,
  ToolDetailPanel,
  useTimelineNavigation,
  useToggleSet,
} from "@tracepilot/ui";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import TurnWaterfallHeader from "@/components/waterfall/TurnWaterfallHeader.vue";
import TurnWaterfallRow from "@/components/waterfall/TurnWaterfallRow.vue";
import TurnWaterfallTooltip from "@/components/waterfall/TurnWaterfallTooltip.vue";
import { useTimelineToolState } from "@/composables/useTimelineToolState";
import {
  computeEpochStart,
  computeRows,
  computeRulerTicks,
  computeTimelineSpanMs,
  type WaterfallRow,
} from "@/composables/useWaterfallLayout";
import "@/styles/features/waterfall.css";

/* ------------------------------------------------------------------ */
/*  Store & data                                                      */
/* ------------------------------------------------------------------ */

const { store, prefs, fullResults, loadingResults, loadFullResult, allToolCalls } =
  useTimelineToolState();

const turns = computed(() => store.turns);

/* ------------------------------------------------------------------ */
/*  Selection refs (forward-declared for navigation escape handler)   */
/* ------------------------------------------------------------------ */

const selectedRowId = ref<string | null>(null);
const pinnedRowId = ref<string | null>(null);

function dismissDetail() {
  pinnedRowId.value = null;
  selectedRowId.value = null;
}

/* ------------------------------------------------------------------ */
/*  Turn navigation                                                   */
/* ------------------------------------------------------------------ */

const rootRef = ref<HTMLElement | null>(null);
const { turnIndex, jumpOpen, turnLabel, canPrev, canNext, prevTurn, nextTurn, jumpTo } =
  useTimelineNavigation({
    turns,
    rootRef,
    onEscape: () => {
      if (pinnedRowId.value) {
        dismissDetail();
      } else {
        selectedRowId.value = null;
      }
    },
  });

const currentTurn = computed<ConversationTurn | undefined>(() => turns.value[turnIndex.value]);

/* ------------------------------------------------------------------ */
/*  Waterfall layout (via useWaterfallLayout)                         */
/* ------------------------------------------------------------------ */

const turnEpochStart = computed(() => computeEpochStart(currentTurn.value));
const timelineSpanMs = computed(() =>
  computeTimelineSpanMs(currentTurn.value, allToolCalls.value, turnEpochStart.value),
);
const rows = computed<WaterfallRow[]>(() =>
  computeRows(currentTurn.value, allToolCalls.value, timelineSpanMs.value, turnEpochStart.value),
);
const rulerTicks = computed(() => computeRulerTicks(timelineSpanMs.value));

/* ------------------------------------------------------------------ */
/*  Summary stats                                                     */
/* ------------------------------------------------------------------ */

const turnStats = computed(() => {
  const t = currentTurn.value;
  if (!t) return { model: "", duration: "", toolCount: 0, agentCount: 0 };
  return {
    model: t.model ?? "",
    duration: formatDuration(t.durationMs),
    toolCount: t.toolCalls.length,
    agentCount: t.toolCalls.filter((tc: TurnToolCall) => tc.isSubagent).length,
  };
});

/* ------------------------------------------------------------------ */
/*  Collapse/expand subagents                                         */
/* ------------------------------------------------------------------ */

const { toggle: toggleExpanded, has: isExpanded } = useToggleSet<string>();

// Subagents start expanded
watch(
  currentTurn,
  (t) => {
    if (!t) return;
    for (const tc of t.toolCalls) {
      if (tc.isSubagent && tc.toolCallId && !isExpanded(tc.toolCallId)) {
        toggleExpanded(tc.toolCallId);
      }
    }
  },
  { immediate: true },
);

function isRowVisible(row: WaterfallRow): boolean {
  if (row.depth === 0) return true;
  return row.parentId != null && isExpanded(row.parentId);
}

/* ------------------------------------------------------------------ */
/*  Selection & hover                                                 */
/* ------------------------------------------------------------------ */

const hoveredRowId = ref<string | null>(null);

function selectRow(id: string) {
  selectedRowId.value = selectedRowId.value === id ? null : id;
  pinnedRowId.value = pinnedRowId.value === id ? null : id;
}

const pinnedRow = computed<WaterfallRow | null>(() => {
  if (!pinnedRowId.value) return null;
  return rows.value.find((r) => r.id === pinnedRowId.value) ?? null;
});

/** Count child tool calls for a subagent row. */
function childToolCount(row: WaterfallRow): number {
  if (!row.call.isSubagent || !row.call.toolCallId) return 0;
  return rows.value.filter((r) => r.parentId === row.call.toolCallId).length;
}

/* ------------------------------------------------------------------ */
/*  Tooltip                                                           */
/* ------------------------------------------------------------------ */

const tooltipRow = computed<WaterfallRow | null>(() => {
  if (!hoveredRowId.value) return null;
  return rows.value.find((r) => r.id === hoveredRowId.value) ?? null;
});

/* ------------------------------------------------------------------ */
/*  Jump dropdown – close on outside click                            */
/* ------------------------------------------------------------------ */

const jumpWrapperEl = ref<HTMLElement | null>(null);

function onDocClick(e: MouseEvent) {
  if (jumpOpen.value && jumpWrapperEl.value && !jumpWrapperEl.value.contains(e.target as Node)) {
    jumpOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", onDocClick, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick, true);
});

/* ------------------------------------------------------------------ */
/*  Helpers for template                                              */
/* ------------------------------------------------------------------ */

const waterfallTerms = [
  {
    term: "Waterfall",
    definition: "Horizontal bars showing when each tool call started and how long it ran",
  },
  {
    term: "Subagent",
    definition:
      "An autonomous agent spawned to handle a subtask (shown as wider bars containing child tools)",
  },
  {
    term: "Nesting",
    definition: "Child tool calls made within a subagent, indented under their parent",
  },
  {
    term: "Parallel",
    definition: "Multiple subagents running at the same time (overlapping bars)",
  },
];
</script>

<template>
  <div ref="rootRef" class="waterfall-root" tabindex="0">
    <!-- Empty state -->
    <EmptyState
      v-if="turns.length === 0"
      icon="📊"
      title="No turns loaded"
      message="Load a session to view the waterfall timeline."
    />

    <template v-else>
      <!-- ════════════ Turn navigation header ════════════ -->
      <TurnWaterfallHeader
        :turns="turns"
        :turn-index="turnIndex"
        :turn-label="turnLabel"
        :can-prev="canPrev"
        :can-next="canNext"
        :current-turn="currentTurn"
        :turn-stats="turnStats"
        :jump-open="jumpOpen"
        @prev="prevTurn"
        @next="nextTurn"
        @jump-to="jumpTo"
        @toggle-jump="jumpOpen = !jumpOpen"
        @register-jump-ref="(el) => (jumpWrapperEl = el)"
      />

      <!-- ════════════ Terminology legend ════════════ -->
      <TerminologyLegend :items="waterfallTerms" />

      <!-- ════════════ Waterfall body ════════════ -->
      <div class="waterfall-body" v-if="currentTurn">
        <!-- Time ruler -->
        <div class="ruler-row">
          <div class="label-col ruler-label">Name</div>
          <div class="bar-col">
            <div class="ruler-track">
              <span
                v-for="(tick, i) in rulerTicks"
                :key="i"
                class="ruler-tick"
                :style="{ left: tick.leftPct + '%' }"
              >
                {{ tick.label }}
              </span>
            </div>
          </div>
        </div>

        <!-- Separator -->
        <div class="separator" />

        <!-- Tool call rows -->
        <div class="rows-container">
          <template v-for="row in rows" :key="row.id">
            <TurnWaterfallRow
              v-if="isRowVisible(row)"
              :row="row"
              :selected="selectedRowId === row.id"
              :hovered="hoveredRowId === row.id"
              :expanded="!!(row.call.toolCallId && isExpanded(row.call.toolCallId))"
              @select="selectRow(row.id)"
              @toggle-expanded="row.call.toolCallId && toggleExpanded(row.call.toolCallId)"
              @hover-enter="hoveredRowId = row.id"
              @hover-leave="hoveredRowId = null"
            />
          </template>
        </div>

        <!-- Separator -->
        <div class="separator" />

        <!-- Assistant response row -->
        <div
          class="wf-row message-row"
          v-if="currentTurn.assistantMessages.some((m) => m.content.trim())"
        >
          <div class="label-col">
            <span class="tool-icon">💬</span>
            <span class="tool-name assistant-label">Assistant response</span>
          </div>
          <div class="bar-col" />
        </div>
      </div>

      <!-- ════════════ Tooltip (hover preview) ════════════ -->
      <Transition name="fade">
        <TurnWaterfallTooltip v-if="tooltipRow && !pinnedRowId" :row="tooltipRow" />
      </Transition>

      <!-- ════════════ Pinned detail panel ════════════ -->
      <Transition name="fade">
        <ToolDetailPanel
          v-if="pinnedRow"
          :tc="pinnedRow.call"
          :full-result="fullResults.get(pinnedRow.call.toolCallId ?? '')"
          :loading-full-result="!!(pinnedRow.call.toolCallId && loadingResults.has(pinnedRow.call.toolCallId))"
          :rich-enabled="prefs.isRichRenderingEnabled(pinnedRow.call.toolName)"
          :child-tool-count="pinnedRow.call.isSubagent ? childToolCount(pinnedRow) : undefined"
          :badges="pinnedRow.isParallel ? [{ label: 'parallel', variant: 'accent' }] : []"
          @close="dismissDetail"
          @load-full-result="loadFullResult"
        />
      </Transition>
    </template>
  </div>
</template>
