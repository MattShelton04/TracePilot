<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  ContextCompaction,
  ContextTimeline,
  ContextTimelineEvent,
  ContextToolCallContribution,
  ContextWindowPoint,
  TurnToolCall,
} from "@tracepilot/types";
import {
  Badge,
  EmptyState,
  ErrorAlert,
  formatNumber,
  LoadingSpinner,
  SectionPanel,
  SegmentedControl,
  StatCard,
} from "@tracepilot/ui";
import { Activity, Info } from "lucide-vue-next";
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import ContextPointInspector from "@/components/context/ContextPointInspector.vue";
import ContextToolContribution from "@/components/context/ContextToolContribution.vue";
import ContextWindowChart from "@/components/context/ContextWindowChart.vue";
import ContextCapturePanel from "@/components/contextCapture/ContextCapturePanel.vue";
import { useCheckpointNavigation } from "@/composables/useCheckpointNavigation";
import { getCachedContextTimeline, loadContextTimeline } from "@/composables/useContextTimeline";
import { useConversationNavigation } from "@/composables/useConversationNavigation";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { usePreferencesStore } from "@/stores/preferences";

const store = useSessionDetailContext();
const preferences = usePreferencesStore();
const isMainWindow = (() => {
  try {
    return getCurrentWindow().label === "main";
  } catch {
    // Browser-only development has no Tauri window metadata.
    return true;
  }
})();
const showContextCapture = computed(
  () => isMainWindow && (preferences.isFeatureEnabled?.("exactContextCapture") ?? false),
);
const contextView = ref<"timeline" | "snapshots">("timeline");
const contextViews = [
  { value: "timeline", label: "Context timeline" },
  { value: "snapshots", label: "Request snapshots" },
];
const timeline = ref<ContextTimeline | null>(null);
const loading = ref(false);
const refreshing = ref(false);
const error = ref<string | null>(null);
const selectedPoint = ref<ContextWindowPoint | null>(null);
const selectedCompaction = ref<ContextCompaction | null>(null);
const selectedToolCall = ref<ContextToolCallContribution | null>(null);
const selectedTurnToolCall = ref<TurnToolCall | null>(null);
const selectedTimelineEvent = ref<ContextTimelineEvent | null>(null);
const loadingTurnTools = ref(false);
const navigateToCheckpoint = useCheckpointNavigation();
const navigateToConversation = useConversationNavigation();
const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } =
  useToolResultLoader(() => store.sessionId);
let requestVersion = 0;
let requestedDetailFingerprint: string | null = null;
let loadedDetailFingerprint: string | null = null;

function detailFingerprint(sessionId: string): string {
  const detail = store.detail;
  return [
    sessionId,
    detail?.eventCount ?? "",
    detail?.turnCount ?? "",
    detail?.updatedAt ?? "",
  ].join(":");
}

function applyTimeline(next: ContextTimeline) {
  const previousTimeline = timeline.value;
  const point = selectedPoint.value;
  const compaction = selectedCompaction.value;
  const toolCall = selectedToolCall.value;
  const event = selectedTimelineEvent.value;
  const eventMatches = event
    ? (item: ContextTimelineEvent) =>
        item.turn === event.turn &&
        item.kind === event.kind &&
        item.timestamp === event.timestamp &&
        item.eventIndex === event.eventIndex
    : null;
  const eventOccurrence =
    event && eventMatches
      ? (previousTimeline?.events
          .slice(0, previousTimeline.events.indexOf(event) + 1)
          .filter(eventMatches).length ?? 1)
      : 0;

  timeline.value = next;
  selectedPoint.value = point
    ? (next.points.find((item) => item.turn === point.turn && item.phase === point.phase) ?? null)
    : null;
  selectedCompaction.value = compaction
    ? (next.compactions.find(
        (item) =>
          item.startTurn === compaction.startTurn &&
          item.completeTurn === compaction.completeTurn &&
          item.checkpointNumber === compaction.checkpointNumber,
      ) ?? null)
    : null;
  selectedToolCall.value = toolCall
    ? (next.topToolCalls.find((item) =>
        toolCall.toolCallId
          ? item.toolCallId === toolCall.toolCallId
          : item.turn === toolCall.turn && item.toolName === toolCall.toolName,
      ) ?? null)
    : null;
  selectedTimelineEvent.value =
    event && eventMatches ? (next.events.filter(eventMatches)[eventOccurrence - 1] ?? null) : null;
}

async function load(sessionId: string, options: { background?: boolean } = {}) {
  const version = ++requestVersion;
  const fingerprint = detailFingerprint(sessionId);
  requestedDetailFingerprint = fingerprint;
  const cached = getCachedContextTimeline(sessionId);
  if (cached && !timeline.value) applyTimeline(cached.timeline);
  loading.value = !options.background && !cached;
  refreshing.value = !options.background && Boolean(cached);
  if (!options.background) error.value = null;
  let succeeded = false;
  try {
    const response = await loadContextTimeline(sessionId);
    if (version !== requestVersion) return;
    applyTimeline(response.timeline);
    loadedDetailFingerprint = detailFingerprint(sessionId);
    succeeded = true;
  } catch (cause) {
    if (version !== requestVersion) return;
    if (!options.background) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    if (version === requestVersion) {
      loading.value = false;
      refreshing.value = false;
      if (!succeeded) requestedDetailFingerprint = null;
    }
  }
}

watch(
  () => store.sessionId,
  (sessionId) => {
    timeline.value = null;
    selectedPoint.value = null;
    selectedCompaction.value = null;
    selectedToolCall.value = null;
    selectedTurnToolCall.value = null;
    selectedTimelineEvent.value = null;
    requestedDetailFingerprint = null;
    loadedDetailFingerprint = null;
    if (sessionId) load(sessionId);
  },
  { immediate: true },
);

watch(
  () => (store.sessionId ? detailFingerprint(store.sessionId) : null),
  (fingerprint) => {
    const sessionId = store.sessionId;
    if (
      !sessionId ||
      !timeline.value ||
      !fingerprint ||
      fingerprint === requestedDetailFingerprint ||
      fingerprint === loadedDetailFingerprint
    ) {
      return;
    }
    void load(sessionId, { background: true });
  },
);

const peakTokens = computed(() =>
  Math.max(...(timeline.value?.points.map((point) => point.totalTokens) ?? [0])),
);
const latestTokens = computed(
  () => timeline.value?.points[timeline.value.points.length - 1]?.totalTokens ?? 0,
);
const compactionsFullyPaired = computed(
  () =>
    timeline.value != null &&
    timeline.value.compactionStartCount === timeline.value.compactionCompleteCount &&
    timeline.value.pairedCompactionCount === timeline.value.compactionStartCount,
);
type InfoPopoverKey = "methodology" | "observed" | "estimated" | "paired";
const activeInfo = ref<InfoPopoverKey | null>(null);
const infoPinned = ref(false);
const confidenceItems = computed(() => [
  {
    id: "observed" as const,
    label: `${timeline.value?.observedPointCount ?? 0} observed`,
    variant: "neutral" as const,
    class: "context-tab__confidence-badge--observed",
    explanation:
      "Exact context-layer snapshots reported by Copilot at compaction starts or session shutdowns.",
  },
  {
    id: "estimated" as const,
    label: `${timeline.value?.estimatedPointCount ?? 0} estimated`,
    variant: "warning" as const,
    class: "context-tab__confidence-badge--estimated",
    explanation:
      "Reconstructed points between observed snapshots, calibrated from captured context-bearing event text.",
  },
  {
    id: "paired" as const,
    label: `${timeline.value?.pairedCompactionCount ?? 0}/${timeline.value?.compactionStartCount ?? 0} paired`,
    variant: compactionsFullyPaired.value ? ("success" as const) : ("warning" as const),
    class: compactionsFullyPaired.value
      ? "context-tab__confidence-badge--paired"
      : "context-tab__confidence-badge--unpaired",
    explanation:
      "Compaction starts matched to their completion events in event order. The ratio is paired completions to starts.",
  },
]);
const selectedTurn = computed(() => {
  const turnIndex = selectedPoint.value?.turn;
  return turnIndex == null ? undefined : store.turns.find((turn) => turn.turnIndex === turnIndex);
});
const selectedCachedInputAiCredits = computed(() => {
  const point = selectedPoint.value;
  const model = selectedTurn.value?.model;
  if (!point || !model) return null;
  return preferences.computeUsageBasedCostBreakdown(model, point.totalTokens, point.totalTokens, 0)
    .aiCredits;
});
const selectedTurnToolCalls = computed(
  () => selectedTurn.value?.toolCalls.filter((toolCall) => !toolCall.parentToolCallId) ?? [],
);
const selectedContributionToolCall = computed(() => {
  const contribution = selectedToolCall.value;
  if (!contribution) return null;
  for (const turn of store.turns) {
    const match = turn.toolCalls.find((item) =>
      contribution.toolCallId
        ? item.toolCallId === contribution.toolCallId
        : turn.turnIndex === contribution.turn && item.toolName === contribution.toolName,
    );
    if (match) return match;
  }
  return toolCallFor(contribution);
});

watch(
  () => store.turnsVersion,
  () => {
    const selected = selectedTurnToolCall.value;
    if (!selected) return;
    selectedTurnToolCall.value =
      selectedTurnToolCalls.value.find((item) =>
        selected.toolCallId
          ? item.toolCallId === selected.toolCallId
          : item.toolName === selected.toolName && item.startedAt === selected.startedAt,
      ) ?? null;
  },
);

async function ensureTurnTools() {
  if (!selectedPoint.value || store.loaded.has("turns") || loadingTurnTools.value) return;
  loadingTurnTools.value = true;
  try {
    await store.loadTurns();
  } finally {
    loadingTurnTools.value = false;
  }
}

function clearSelection() {
  selectedPoint.value = null;
  selectedCompaction.value = null;
  selectedTimelineEvent.value = null;
  selectedTurnToolCall.value = null;
}

function selectPoint(point: ContextWindowPoint) {
  selectedPoint.value = point;
  selectedCompaction.value = null;
  selectedTimelineEvent.value = null;
  selectedTurnToolCall.value = null;
  void ensureTurnTools();
}

function selectCompaction(compaction: ContextCompaction) {
  selectedCompaction.value = compaction;
  selectedTimelineEvent.value = null;
  selectedPoint.value =
    timeline.value?.points.find(
      (point) => point.turn === compaction.startTurn && point.phase === "preCompaction",
    ) ??
    timeline.value?.points.find((point) => point.turn === compaction.startTurn) ??
    null;
  selectedTurnToolCall.value = null;
  void ensureTurnTools();
}

function selectToolCall(item: ContextToolCallContribution) {
  selectedToolCall.value = item;
  selectedTimelineEvent.value = null;
  selectedCompaction.value = null;
  selectedTurnToolCall.value = null;
  selectedPoint.value =
    timeline.value?.points.find((point) => point.turn === item.turn && point.phase === "turn") ??
    timeline.value?.points.find((point) => point.turn === item.turn) ??
    null;
  if (item.toolCallId) prefetchFullResult(item.toolCallId);
  void ensureTurnTools();
}

function selectTimelineEvent(event: ContextTimelineEvent) {
  selectedTimelineEvent.value = event;
  selectedCompaction.value = null;
  selectedPoint.value =
    timeline.value?.points.find((point) => point.turn === event.turn && point.phase === "turn") ??
    timeline.value?.points.find((point) => point.turn === event.turn) ??
    null;
  selectedTurnToolCall.value = null;
  void ensureTurnTools();
}

function selectTurnToolCall(item: TurnToolCall) {
  selectedTurnToolCall.value = selectedTurnToolCall.value === item ? null : item;
  if (selectedTurnToolCall.value?.toolCallId) {
    prefetchFullResult(selectedTurnToolCall.value.toolCallId);
  }
}

function prefetchFullResult(toolCallId: string) {
  if (failedResults.has(toolCallId)) {
    retryFullResult(toolCallId);
  } else {
    void loadFullResult(toolCallId);
  }
}

function richEnabledFor(toolName: string): boolean {
  return preferences.isRichRenderingEnabled(toolName);
}

function showInfo(key: InfoPopoverKey) {
  if (!infoPinned.value) activeInfo.value = key;
}

function hideInfo(key: InfoPopoverKey) {
  if (!infoPinned.value && activeInfo.value === key) activeInfo.value = null;
}

function toggleInfo(key: InfoPopoverKey) {
  if (infoPinned.value && activeInfo.value === key) {
    dismissPinnedInfo();
  } else {
    activeInfo.value = key;
    infoPinned.value = true;
  }
}

function dismissPinnedInfo() {
  activeInfo.value = null;
  infoPinned.value = false;
}

onMounted(() => document.addEventListener("click", dismissPinnedInfo));
onScopeDispose(() => document.removeEventListener("click", dismissPinnedInfo));

function openConversation(turn: number, eventIndex?: number | null) {
  navigateToConversation({
    turnIndex: turn,
    eventIndex: eventIndex ?? null,
  });
}

function toolCallFor(item: ContextToolCallContribution): TurnToolCall {
  let argumentsValue: unknown = item.argumentsPreview;
  if (item.argumentsPreview && !item.argumentsPreview.endsWith("…[truncated]")) {
    try {
      argumentsValue = JSON.parse(item.argumentsPreview);
    } catch {
      // Keep non-JSON arguments as captured text.
    }
  }
  return {
    toolCallId: item.toolCallId ?? undefined,
    toolName: item.toolName,
    arguments: argumentsValue,
    resultContent: item.resultPreview ?? undefined,
    success: item.success ?? undefined,
    isComplete: item.success != null,
  };
}

function toggleToolCall(item: ContextToolCallContribution) {
  if (selectedToolCall.value === item) {
    selectedToolCall.value = null;
  } else {
    selectToolCall(item);
  }
}

function retryLoad() {
  if (store.sessionId) load(store.sessionId);
}
</script>

<template>
  <div class="context-tab">
    <div v-if="showContextCapture" class="context-tab__view-nav">
      <SegmentedControl v-model="contextView" :options="contextViews" />
    </div>

    <div v-if="contextView === 'timeline'" class="context-tab__view">
      <ErrorAlert
        v-if="error"
        :message="error"
        variant="inline"
        :retryable="true"
        class="mb-4"
        @retry="retryLoad"
      />

    <div v-if="loading && !timeline" class="context-tab__loading">
      <LoadingSpinner size="lg" />
      <span>Reconstructing context timeline…</span>
    </div>

    <EmptyState
      v-else-if="timeline && timeline.points.length === 0"
      title="No context telemetry yet"
      description="This session has no assistant turns or context snapshots to analyze."
    >
      <template #icon><Activity /></template>
    </EmptyState>

    <template v-else-if="timeline">
      <div class="context-tab__meta">
        <div
          class="context-tab__info-anchor context-tab__methodology"
          @mouseenter="showInfo('methodology')"
          @mouseleave="hideInfo('methodology')"
        >
          <button
            type="button"
            :aria-expanded="activeInfo === 'methodology'"
            @click.stop="toggleInfo('methodology')"
          >
            <Info :size="14" aria-hidden="true" /> How estimates work
          </button>
          <div
            v-if="activeInfo === 'methodology'"
            class="context-tab__info-popover context-tab__info-popover--methodology"
            role="tooltip"
            @click.stop
          >
            <strong>Source-aware reconstruction</strong>
            <p>{{ timeline.methodology }}</p>
            <p>
              Cache telemetry is aggregate-only; tool payload estimates do not identify individual
              cache reads or writes.
            </p>
          </div>
        </div>
        <div class="context-tab__confidence">
          <LoadingSpinner v-if="refreshing" size="sm" />
          <span v-if="refreshing">Updating</span>
          <span
            v-for="item in confidenceItems"
            :key="item.id"
            class="context-tab__info-anchor context-tab__confidence-anchor"
            @mouseenter="showInfo(item.id)"
            @mouseleave="hideInfo(item.id)"
          >
            <button
              type="button"
              :aria-label="`Explain ${item.id} context telemetry`"
              :aria-expanded="activeInfo === item.id"
              @click.stop="toggleInfo(item.id)"
            >
              <Badge
                class="context-tab__confidence-badge"
                :class="item.class"
                :variant="item.variant"
              >
                {{ item.label }}
              </Badge>
            </button>
            <span
              v-if="activeInfo === item.id"
              class="context-tab__info-popover context-tab__info-popover--confidence"
              role="tooltip"
              @click.stop
            >
              {{ item.explanation }}
            </span>
          </span>
        </div>
      </div>

      <div class="context-tab__stats">
        <StatCard :value="formatNumber(peakTokens)" label="Peak Context" :gradient="true" />
        <StatCard :value="formatNumber(latestTokens)" label="Latest Context" color="done" />
        <StatCard :value="timeline.compactions.length" label="Compactions" color="warning" />
      </div>

      <SectionPanel title="Context pressure by turn">
        <ContextWindowChart
          :timeline="timeline"
          :selected-point="selectedPoint"
          :selected-event="selectedTimelineEvent"
          @select-point="selectPoint"
          @select-compaction="selectCompaction"
          @select-event="selectTimelineEvent"
          @clear-selection="clearSelection"
        />
      </SectionPanel>

      <SectionPanel title="Selected point">
        <ContextPointInspector
          :selected-timeline-event="selectedTimelineEvent"
          :selected-point="selectedPoint"
          :selected-compaction="selectedCompaction"
          :point-model="selectedTurn?.model ?? null"
          :cached-input-ai-credits="selectedCachedInputAiCredits"
          :selected-turn-tool-calls="selectedTurnToolCalls"
          :selected-turn-tool-call="selectedTurnToolCall"
          :loading-turn-tools="loadingTurnTools"
          :turns-error="store.turnsError"
          :full-results="fullResults"
          :loading-results="loadingResults"
          :failed-results="failedResults"
          :rich-enabled-for="richEnabledFor"
          @open-conversation="openConversation"
          @navigate-checkpoint="navigateToCheckpoint"
          @select-turn-tool="selectTurnToolCall"
          @load-full-result="loadFullResult"
          @retry-full-result="retryFullResult"
        />
      </SectionPanel>

      <SectionPanel title="Session tool contribution">
        <ContextToolContribution
          :timeline="timeline"
          :selected-tool-call="selectedToolCall"
          :selected-contribution-tool-call="selectedContributionToolCall"
          :full-results="fullResults"
          :loading-results="loadingResults"
          :failed-results="failedResults"
          :rich-enabled-for="richEnabledFor"
          @select-tool-call="toggleToolCall"
          @clear-tool-call="selectedToolCall = null"
          @load-full-result="loadFullResult"
          @retry-full-result="retryFullResult"
        />
      </SectionPanel>
    </template>

    </div>

    <ContextCapturePanel
      v-if="showContextCapture && contextView === 'snapshots' && store.sessionId"
      :session-id="store.sessionId"
    />
  </div>
</template>

<style scoped>
.context-tab__view-nav {
  display: flex;
  justify-content: flex-start;
  margin-bottom: 20px;
}

.context-tab__view {
  min-width: 0;
}

.context-tab__loading {
  display: flex;
  min-height: 420px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 12px;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.context-tab__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 30px;
  margin-bottom: 12px;
}

.context-tab__info-anchor {
  position: relative;
}

.context-tab__info-anchor > button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  font: inherit;
  font-size: 0.6875rem;
  cursor: pointer;
}

.context-tab__info-anchor > button:focus-visible {
  border-radius: var(--radius-sm);
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.context-tab__info-popover {
  position: absolute;
  z-index: var(--z-tooltip);
  top: calc(100% + 7px);
  padding: 9px 11px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-overlay, var(--canvas-default));
  box-shadow: var(--shadow-lg);
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.45;
}

.context-tab__info-popover--methodology {
  left: 0;
  width: min(520px, calc(100vw - 64px));
  padding: 12px 14px;
}

.context-tab__info-popover--confidence {
  right: 0;
  width: 260px;
}

.context-tab__info-popover strong {
  color: var(--text-primary);
  font-size: 0.8125rem;
}

.context-tab__info-popover p {
  margin: 6px 0 0;
}

.context-tab__confidence {
  display: flex;
  align-items: center;
  gap: 7px;
}

.context-tab__confidence > span {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.context-tab__confidence-anchor > button {
  display: block;
}

.context-tab__confidence :deep(.context-tab__confidence-badge) {
  border: 1px solid var(--border-default);
  color: var(--text-primary);
  font-weight: 650;
}

.context-tab__confidence :deep(.context-tab__confidence-badge--observed) {
  background: var(--neutral-subtle);
}

.context-tab__confidence :deep(.context-tab__confidence-badge--estimated) {
  border-color: var(--warning-muted);
  background: var(--warning-subtle);
}

.context-tab__confidence :deep(.context-tab__confidence-badge--paired) {
  border-color: var(--success-muted);
  background: var(--success-subtle);
}

.context-tab__confidence :deep(.context-tab__confidence-badge--unpaired) {
  border-color: var(--warning-muted);
  background: var(--warning-subtle);
}

.context-tab__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

@media (max-width: 900px) {
  .context-tab__stats {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .context-tab__meta {
    align-items: flex-start;
    flex-direction: column;
  }

  .context-tab__confidence {
    flex-wrap: wrap;
  }
}
</style>
