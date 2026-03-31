<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import {
  Badge,
  categoryColor,
  detectParallelIds,
  EmptyState,
  ExpandChevron,
  extractPrompt,
  formatArgsSummary,
  formatDuration,
  formatTime,
  getToolCallColor,
  TerminologyLegend,
  type TimeSpanItem,
  ToolDetailPanel,
  toolCategory,
  toolIcon,
  toTimeSpan,
  truncateText,
  useTimelineNavigation,
  useToggleSet,
} from "@tracepilot/ui";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useTimelineToolState } from "@/composables/useTimelineToolState";

/* ------------------------------------------------------------------ */
/*  Store & data                                                      */
/* ------------------------------------------------------------------ */

const {
  store,
  prefs,
  fullResults,
  loadingResults,
  failedResults,
  loadFullResult,
  retryFullResult,
  allToolCalls,
  expandedToolCalls,
  expandedReasoning,
  expandedOutputs,
  clearAllState,
} = useTimelineToolState();

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
/*  Waterfall layout computation                                      */
/* ------------------------------------------------------------------ */

interface WaterfallRow {
  call: TurnToolCall;
  depth: number;
  id: string;
  parentId: string | null;
  leftPct: number; // 0–100
  widthPct: number; // 0–100
  isParallel: boolean;
}

/** Total duration of current turn in ms. */
const turnDurationMs = computed<number>(() => {
  const t = currentTurn.value;
  if (!t) return 0;
  return t.durationMs ?? 0;
});

/** Earliest startedAt timestamp (epoch ms) in the turn's tool calls. */
const turnEpochStart = computed<number>(() => {
  const t = currentTurn.value;
  if (!t) return 0;
  let earliest = Infinity;
  for (const tc of t.toolCalls) {
    if (tc.startedAt) {
      const ms = new Date(tc.startedAt).getTime();
      if (ms < earliest) earliest = ms;
    }
  }
  return earliest === Infinity ? 0 : earliest;
});

/** Timeline span in ms (max completedAt − earliest startedAt, or turn duration). */
const timelineSpanMs = computed<number>(() => {
  const t = currentTurn.value;
  if (!t || t.toolCalls.length === 0) return turnDurationMs.value || 1;

  const start = turnEpochStart.value;
  if (!start) return turnDurationMs.value || 1;

  let latest = start;

  // Collect IDs of subagent parents in this turn
  const subagentIds = new Set<string>();
  for (const tc of t.toolCalls) {
    if (tc.isSubagent && tc.toolCallId) subagentIds.add(tc.toolCallId);
  }

  // Include current turn's tool calls AND cross-turn children of this turn's subagents
  const relevantCalls = [
    ...t.toolCalls,
    ...allToolCalls.value.filter(
      (tc) =>
        tc.parentToolCallId && subagentIds.has(tc.parentToolCallId) && !t.toolCalls.includes(tc),
    ),
  ];

  for (const tc of relevantCalls) {
    if (tc.completedAt) {
      const ms = new Date(tc.completedAt).getTime();
      if (ms > latest) latest = ms;
    } else if (tc.startedAt && tc.durationMs) {
      const ms = new Date(tc.startedAt).getTime() + tc.durationMs;
      if (ms > latest) latest = ms;
    }
  }
  const span = latest - start;
  return Math.max(span, turnDurationMs.value || 1, 1);
});

/** Build flat row list with hierarchy and positions. */
const rows = computed<WaterfallRow[]>(() => {
  const t = currentTurn.value;
  if (!t) return [];

  const calls = t.toolCalls;
  const span = timelineSpanMs.value;
  const epochStart = turnEpochStart.value;

  // Index by toolCallId for parent lookup (current turn only)
  const byId = new Map<string, TurnToolCall>();
  for (const tc of calls) {
    if (tc.toolCallId) byId.set(tc.toolCallId, tc);
  }

  // Separate top-level vs children — search ALL turns for child tool calls
  const topLevel: TurnToolCall[] = [];
  const childrenMap = new Map<string, TurnToolCall[]>();

  // First, collect children from all turns that belong to a parent in this turn
  for (const tc of allToolCalls.value) {
    if (tc.parentToolCallId && byId.has(tc.parentToolCallId)) {
      const siblings = childrenMap.get(tc.parentToolCallId) ?? [];
      siblings.push(tc);
      childrenMap.set(tc.parentToolCallId, siblings);
    }
  }

  // Collect all subagent IDs across all turns (to suppress cross-turn children from top-level)
  const allSubagentIds = new Set<string>();
  for (const tc of allToolCalls.value) {
    if (tc.isSubagent && tc.toolCallId) allSubagentIds.add(tc.toolCallId);
  }

  // Top-level = current turn's calls that are not children of any subagent
  for (const tc of calls) {
    if (
      !(
        tc.parentToolCallId &&
        (byId.has(tc.parentToolCallId) || allSubagentIds.has(tc.parentToolCallId))
      )
    ) {
      topLevel.push(tc);
    }
  }

  // Detect parallel subagents (overlapping time ranges among top-level subagents)
  const subagentCalls = topLevel.filter((tc) => tc.isSubagent && tc.startedAt);
  const spans = subagentCalls.map(toTimeSpan).filter((s): s is TimeSpanItem => s !== null);
  const parallelIds = detectParallelIds(spans);

  // Fallback sequential position tracker for calls without timestamps
  let fallbackIdx = 0;

  function position(tc: TurnToolCall): { leftPct: number; widthPct: number } {
    if (!epochStart || !tc.startedAt) {
      // Fallback: distribute sequentially
      const count = calls.length || 1;
      const left = (fallbackIdx / count) * 100;
      const width = Math.max((1 / count) * 100, 1);
      fallbackIdx++;
      return { leftPct: left, widthPct: width };
    }
    const startMs = new Date(tc.startedAt).getTime() - epochStart;
    const durMs =
      tc.durationMs ??
      (tc.completedAt ? new Date(tc.completedAt).getTime() - new Date(tc.startedAt).getTime() : 0);
    const left = (startMs / span) * 100;
    const width = Math.max((durMs / span) * 100, 0.5);
    return { leftPct: Math.min(left, 100), widthPct: Math.min(width, 100 - left) };
  }

  const result: WaterfallRow[] = [];
  for (const tc of topLevel) {
    const { leftPct, widthPct } = position(tc);
    const id = tc.toolCallId ?? `idx-${result.length}`;
    result.push({
      call: tc,
      depth: 0,
      id,
      parentId: null,
      leftPct,
      widthPct,
      isParallel: parallelIds.has(id),
    });

    // Append children if subagent
    if (tc.toolCallId && childrenMap.has(tc.toolCallId)) {
      const children = childrenMap.get(tc.toolCallId) ?? [];
      for (const child of children) {
        const pos = position(child);
        result.push({
          call: child,
          depth: 1,
          id: child.toolCallId ?? `idx-${result.length}`,
          parentId: tc.toolCallId,
          leftPct: pos.leftPct,
          widthPct: pos.widthPct,
          isParallel: false,
        });
      }
    }
  }
  return result;
});

/* ------------------------------------------------------------------ */
/*  Time ruler ticks                                                  */
/* ------------------------------------------------------------------ */

const rulerTicks = computed<{ label: string; leftPct: number }[]>(() => {
  const span = timelineSpanMs.value;
  if (span <= 0) return [];

  // Choose a nice tick interval
  const intervals = [
    500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
  ];
  const targetTicks = 6;
  let interval = intervals[intervals.length - 1];
  for (const iv of intervals) {
    if (span / iv <= targetTicks) {
      interval = iv;
      break;
    }
  }

  const ticks: { label: string; leftPct: number }[] = [];
  for (let ms = 0; ms <= span; ms += interval) {
    ticks.push({
      label: formatDuration(ms) || "0s",
      leftPct: (ms / span) * 100,
    });
  }
  return ticks;
});

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
    // Pre-expand all subagents
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
  // Child row is visible only if its parent subagent is expanded
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

const jumpRef = ref<HTMLElement | null>(null);

function onDocClick(e: MouseEvent) {
  if (jumpOpen.value && jumpRef.value && !jumpRef.value.contains(e.target as Node)) {
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

function rowDisplayName(row: WaterfallRow): string {
  const tc = row.call;
  if (tc.isSubagent && tc.agentDisplayName) return tc.agentDisplayName;
  return tc.toolName;
}

function rowArgsSummary(row: WaterfallRow): string {
  return formatArgsSummary(row.call.arguments, row.call.toolName);
}
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
      <header class="waterfall-header">
        <div class="nav-row">
          <div class="nav-buttons">
            <button
              class="nav-btn"
              :disabled="!canPrev"
              @click="jumpTo(0)"
              aria-label="Jump to earliest turn"
            >
              ⏮ Earliest
            </button>
            <button
              class="nav-btn"
              :disabled="!canPrev"
              @click="prevTurn"
              aria-label="Previous turn"
            >
              ◀ Prev
            </button>
            <span class="nav-label">{{ turnLabel }}</span>
            <button
              class="nav-btn"
              :disabled="!canNext"
              @click="nextTurn"
              aria-label="Next turn"
            >
              Next ▶
            </button>
            <button
              class="nav-btn"
              :disabled="!canNext"
              @click="jumpTo(turns.length - 1)"
              aria-label="Jump to latest turn"
            >
              Latest ⏭
            </button>
          </div>

          <!-- Jump dropdown -->
          <div ref="jumpRef" class="jump-wrapper">
            <button class="nav-btn" @click.stop="jumpOpen = !jumpOpen" :aria-expanded="jumpOpen" aria-haspopup="listbox">
              Jump to… ▾
            </button>
            <div v-if="jumpOpen" class="jump-dropdown">
              <div class="jump-list" role="listbox">
                <button
                  v-for="(t, idx) in turns"
                  :key="idx"
                  class="jump-item"
                  :class="{ active: idx === turnIndex }"
                  role="option"
                  :aria-selected="idx === turnIndex"
                  @click="jumpTo(idx)"
                >
                  <span class="jump-idx">{{ idx + 1 }}</span>
                  <span class="jump-msg">
                    {{ truncateText(t.userMessage ?? "(no message)", 60) }}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Turn summary -->
        <div v-if="currentTurn" class="turn-summary">
          <div class="turn-message">
            "{{ truncateText(currentTurn.userMessage ?? "(no message)", 120) }}"
          </div>
          <div class="turn-meta">
            <span v-if="turnStats.model" class="meta-chip">
              Model: {{ turnStats.model }}
            </span>
            <span v-if="turnStats.duration" class="meta-chip">
              Duration: {{ turnStats.duration }}
            </span>
            <span class="meta-chip">
              Tools: {{ turnStats.toolCount }}
            </span>
            <span v-if="turnStats.agentCount > 0" class="meta-chip">
              Agents: {{ turnStats.agentCount }}
            </span>
          </div>
        </div>
      </header>

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
            <div
              v-if="isRowVisible(row)"
              class="wf-row"
              :class="{
                selected: selectedRowId === row.id,
                hovered: hoveredRowId === row.id,
                child: row.depth > 0,
                subagent: row.call.isSubagent,
              }"
              @click="selectRow(row.id)"
              @keydown.enter.space.prevent="selectRow(row.id)"
              @mouseenter="hoveredRowId = row.id"
              @mouseleave="hoveredRowId = null"
              tabindex="0"
              role="button"
              :aria-label="rowDisplayName(row)"
            >
              <!-- Left label column -->
              <div
                class="label-col"
                :style="{ paddingLeft: row.depth * 16 + 'px' }"
              >
                <!-- Expand chevron for subagents -->
                <button
                  v-if="row.call.isSubagent && row.call.toolCallId"
                  class="expand-btn"
                  @click.stop="toggleExpanded(row.call.toolCallId!)"
                  :aria-expanded="isExpanded(row.call.toolCallId!)"
                  aria-label="Toggle children"
                >
                  <ExpandChevron
                    :expanded="isExpanded(row.call.toolCallId!)"
                    size="sm"
                  />
                </button>

                <!-- Tree connector for children -->
                <span v-if="row.depth > 0" class="tree-line">└</span>

                <!-- Icon -->
                <span class="tool-icon">{{ toolIcon(row.call.toolName) }}</span>

                <!-- Name + summary -->
                <span class="tool-name" :class="categoryColor(toolCategory(row.call.toolName))">
                  {{ rowDisplayName(row) }}
                </span>

                <span v-if="row.call.isSubagent" class="agent-tag">(agent)</span>

                <Badge
                  v-if="row.isParallel"
                  variant="accent"
                >parallel</Badge>

                <span v-if="row.call.success === false" class="fail-mark">✕</span>

                <span class="args-summary">
                  {{ truncateText(rowArgsSummary(row), 40) }}
                </span>
              </div>

              <!-- Right bar column -->
              <div class="bar-col">
                <div
                  class="bar"
                  :style="{
                    left: row.leftPct + '%',
                    width: Math.min(Math.max(row.widthPct, 0.4), 100 - row.leftPct) + '%',
                    background: getToolCallColor(row.call),
                    opacity: row.call.isSubagent ? 0.35 : 0.85,
                  }"
                />
              </div>
            </div>
          </template>
        </div>

        <!-- Separator -->
        <div class="separator" />

        <!-- Assistant response row -->
        <div class="wf-row message-row" v-if="currentTurn.assistantMessages.some(m => m.content.trim())">
          <div class="label-col">
            <span class="tool-icon">💬</span>
            <span class="tool-name assistant-label">Assistant response</span>
          </div>
          <div class="bar-col" />
        </div>
      </div>

      <!-- ════════════ Tooltip (hover preview) ════════════ -->
      <Transition name="fade">
        <div v-if="tooltipRow && !pinnedRowId" class="wf-tooltip">
          <div class="tip-header">
            <span class="tip-icon">{{ toolIcon(tooltipRow.call.toolName) }}</span>
            <strong>{{ rowDisplayName(tooltipRow) }}</strong>
            <Badge
              v-if="tooltipRow.call.success === false"
              variant="danger"
            >failed</Badge>
            <Badge
              v-else-if="tooltipRow.call.success === true"
              variant="success"
            >ok</Badge>
          </div>

          <div v-if="rowArgsSummary(tooltipRow)" class="tip-args">
            {{ truncateText(rowArgsSummary(tooltipRow), 200) }}
          </div>

          <div v-if="tooltipRow.call.intentionSummary" class="tip-args" style="font-style: italic;">
            💭 {{ tooltipRow.call.intentionSummary }}
          </div>

          <div class="tip-meta">
            <span v-if="tooltipRow.call.durationMs != null">
              Duration: {{ formatDuration(tooltipRow.call.durationMs) }}
            </span>
            <span v-if="tooltipRow.call.startedAt">
              Start: {{ formatTime(tooltipRow.call.startedAt) }}
            </span>
            <span v-if="tooltipRow.call.completedAt">
              End: {{ formatTime(tooltipRow.call.completedAt) }}
            </span>
            <span v-if="tooltipRow.call.mcpServerName">
              MCP: {{ tooltipRow.call.mcpServerName }}
            </span>
          </div>

          <div v-if="tooltipRow.call.error" class="tip-error">
            {{ truncateText(tooltipRow.call.error, 300) }}
          </div>
        </div>
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

<style scoped>
/* ── Root ── */
.waterfall-root {
  display: flex;
  flex-direction: column;
  gap: 0;
  outline: none;
}

/* ── Header ── */
.waterfall-header {
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.nav-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.nav-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-btn {
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  padding: 4px 10px;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
  white-space: nowrap;
}
.nav-btn:hover:not(:disabled) {
  background: var(--accent-subtle);
  color: var(--text-primary);
}
.nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.nav-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  min-width: max-content;
}

/* Jump dropdown */
.jump-wrapper {
  position: relative;
}
.jump-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 50;
  width: 360px;
  max-height: 320px;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.jump-list {
  overflow-y: auto;
  max-height: 320px;
  padding: 4px;
}
.jump-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  text-align: left;
  transition: background var(--transition-fast);
}
.jump-item:hover {
  background: var(--accent-subtle);
}
.jump-item.active {
  background: var(--accent-muted);
  color: var(--text-primary);
}
.jump-idx {
  font-weight: 600;
  color: var(--text-tertiary);
  min-width: 28px;
}
.jump-msg {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Turn summary */
.turn-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.turn-message {
  font-size: 0.875rem;
  color: var(--text-primary);
  font-style: italic;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.turn-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
.meta-chip {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* ── Waterfall body ── */
.waterfall-body {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  margin-top: 8px;
  overflow-x: auto;
  min-width: 0;
}

/* Shared column widths */
.label-col {
  width: 200px;
  min-width: 200px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  overflow: hidden;
  white-space: nowrap;
}
.bar-col {
  flex: 1;
  min-width: 300px;
  position: relative;
  height: 100%;
}

/* Ruler */
.ruler-row {
  display: flex;
  align-items: center;
  height: 28px;
  border-bottom: 1px solid var(--border-muted);
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.ruler-label {
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--text-secondary);
}
.ruler-track {
  position: relative;
  width: 100%;
  height: 100%;
}
.ruler-tick {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-variant-numeric: tabular-nums;
  user-select: none;
}

.separator {
  height: 1px;
  background: var(--border-muted);
}

/* ── Rows ── */
.rows-container {
  display: flex;
  flex-direction: column;
}

.wf-row {
  display: flex;
  align-items: center;
  height: 28px;
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}
.wf-row:hover,
.wf-row.hovered {
  background: var(--canvas-inset);
}
.wf-row.selected {
  background: var(--accent-subtle);
  border-left-color: var(--accent-fg);
  box-shadow: inset 0 0 0 1px var(--border-accent);
}
.wf-row.child .label-col {
  color: var(--text-tertiary);
}

/* Expand button */
.expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 0 2px;
  cursor: pointer;
  flex-shrink: 0;
}

/* Tree connector */
.tree-line {
  color: var(--text-placeholder);
  font-size: 0.75rem;
  margin-right: 2px;
  flex-shrink: 0;
}

/* Icons & labels */
.tool-icon {
  flex-shrink: 0;
  font-size: 0.8125rem;
  line-height: 1;
}
.tool-name {
  font-size: 0.8125rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-tag {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-style: italic;
  flex-shrink: 0;
}
.fail-mark {
  color: var(--danger-fg);
  font-weight: 700;
  font-size: 0.75rem;
  flex-shrink: 0;
}
.args-summary {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  margin-left: auto;
}

/* Bar */
.bar {
  position: absolute;
  top: 4px;
  bottom: 4px;
  border-radius: 3px;
  transition: opacity var(--transition-fast);
}
.wf-row:hover .bar {
  opacity: 1 !important;
}

/* Assistant message row */
.message-row {
  height: 32px;
  cursor: default;
}
.assistant-label {
  color: var(--success-fg);
  font-weight: 500;
}

/* ── Tooltip ── */
.wf-tooltip {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 100;
  width: 340px;
  max-width: 90vw;
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 10px 14px;
  pointer-events: none;
  font-size: 0.8125rem;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tip-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
}
.tip-icon {
  flex-shrink: 0;
}
.tip-args {
  color: var(--text-secondary);
  font-family: monospace;
  font-size: 0.75rem;
  word-break: break-all;
  line-height: 1.4;
}
.tip-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--text-tertiary);
}
.tip-error {
  color: var(--danger-fg);
  font-size: 0.75rem;
  border-top: 1px solid var(--danger-muted);
  padding-top: 4px;
  line-height: 1.3;
}

/* ── Terminology legend (layout only; internals styled by TerminologyLegend component) ── */
.terminology-legend {
  margin-top: 8px;
}

/* ── Pinned detail panel (positioned via ToolDetailPanel component) ── */
.detail-panel {
  margin-top: 8px;
}

/* ── Transitions ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--transition-normal);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
