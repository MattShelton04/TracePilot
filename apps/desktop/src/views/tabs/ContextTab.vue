<script setup lang="ts">
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
  formatNumberFull,
  formatTime,
  LoadingSpinner,
  SectionPanel,
  StatCard,
  ToolCallItem,
} from "@tracepilot/ui";
import { Activity, Info } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import ContextWindowChart from "@/components/context/ContextWindowChart.vue";
import ToolTypeDonut from "@/components/context/ToolTypeDonut.vue";
import { useCheckpointNavigation } from "@/composables/useCheckpointNavigation";
import { getCachedContextTimeline, loadContextTimeline } from "@/composables/useContextTimeline";
import { useConversationNavigation } from "@/composables/useConversationNavigation";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { usePreferencesStore } from "@/stores/preferences";

const store = useSessionDetailContext();
const preferences = usePreferencesStore();
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
const displayedToolCalls = computed(() => (timeline.value?.topToolCalls ?? []).slice(0, 10));
const displayedToolTypes = computed(() => (timeline.value?.toolTypes ?? []).slice(0, 8));
const compactionsFullyPaired = computed(
  () =>
    timeline.value != null &&
    timeline.value.compactionStartCount === timeline.value.compactionCompleteCount &&
    timeline.value.pairedCompactionCount === timeline.value.compactionStartCount,
);
type ToolAnalysisView = "types" | "chart" | "calls";
const toolAnalysisViews: Array<{ id: ToolAnalysisView; label: string }> = [
  { id: "types", label: "Types" },
  { id: "chart", label: "Chart" },
  { id: "calls", label: "Expensive calls" },
];
const toolAnalysisView = ref<ToolAnalysisView>("types");
const maxToolCallTokens = computed(() => displayedToolCalls.value[0]?.totalTokens ?? 1);
const selectedTurn = computed(() => {
  const turnIndex = selectedPoint.value?.turn;
  return turnIndex == null ? undefined : store.turns.find((turn) => turn.turnIndex === turnIndex);
});
const selectedTurnToolCalls = computed(() => selectedTurn.value?.toolCalls ?? []);
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

function toolCallSummary(item: ContextToolCallContribution): string {
  const value = item.argumentsPreview?.replace(/\s+/g, " ").trim();
  if (!value) return "No captured arguments";
  return value.length > 110 ? `${value.slice(0, 107)}…` : value;
}

function phaseLabel(point: ContextWindowPoint): string {
  const labels: Record<ContextWindowPoint["phase"], string> = {
    turn: "Turn",
    preCompaction: "Before compaction",
    postCompaction: "After compaction",
    shutdown: "Shutdown",
  };
  return labels[point.phase];
}

function retryLoad() {
  if (store.sessionId) load(store.sessionId);
}
</script>

<template>
  <div class="context-tab">
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
        <details class="context-tab__methodology">
          <summary><Info :size="14" aria-hidden="true" /> How estimates work</summary>
          <div>
            <strong>Source-aware reconstruction</strong>
            <p>{{ timeline.methodology }}</p>
            <p>
              Cache telemetry is aggregate-only; tool payload estimates do not identify individual
              cache reads or writes.
            </p>
          </div>
        </details>
        <div class="context-tab__confidence">
          <LoadingSpinner v-if="refreshing" size="sm" />
          <span v-if="refreshing">Updating</span>
          <Badge class="context-tab__confidence-badge context-tab__confidence-badge--observed" variant="neutral">
            {{ timeline.observedPointCount }} observed
          </Badge>
          <Badge class="context-tab__confidence-badge context-tab__confidence-badge--estimated" variant="warning">
            {{ timeline.estimatedPointCount }} estimated
          </Badge>
          <Badge
            class="context-tab__confidence-badge"
            :class="
              compactionsFullyPaired
                ? 'context-tab__confidence-badge--paired'
                : 'context-tab__confidence-badge--unpaired'
            "
            :variant="compactionsFullyPaired ? 'success' : 'warning'"
          >
            {{ timeline.pairedCompactionCount }}/{{ timeline.compactionStartCount }} paired
          </Badge>
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
        <div class="context-tab__selected-inspector">
          <div v-if="selectedTimelineEvent" class="context-tab__detail-card">
            <div class="context-tab__detail-heading">
              <div>
                <span class="context-tab__eyebrow">Turn {{ selectedTimelineEvent.turn }}</span>
                <h3>{{ selectedTimelineEvent.label }}</h3>
              </div>
              <Badge variant="neutral">Event overlay</Badge>
            </div>
            <p v-if="selectedTimelineEvent.preview" class="context-tab__event-preview">
              {{ selectedTimelineEvent.preview }}
            </p>
            <p v-if="selectedTimelineEvent.timestamp" class="context-tab__footnote">
              {{ formatTime(selectedTimelineEvent.timestamp) }}
            </p>
            <button
              type="button"
              class="context-tab__conversation-link"
              @click="
                openConversation(selectedTimelineEvent.turn, selectedTimelineEvent.eventIndex)
              "
            >
              View event in Conversation
            </button>
          </div>
          <div v-else-if="selectedPoint" class="context-tab__detail-card">
            <div class="context-tab__detail-heading">
              <div>
                <span class="context-tab__eyebrow">Turn {{ selectedPoint.turn }}</span>
                <h3>{{ phaseLabel(selectedPoint) }}</h3>
              </div>
              <Badge :variant="selectedPoint.source === 'observed' ? 'success' : 'warning'">
                {{ selectedPoint.source === 'observed' ? 'Observed total' : 'Estimated' }}
              </Badge>
            </div>
            <dl class="context-tab__token-grid">
              <div><dt>Total</dt><dd>{{ formatNumberFull(selectedPoint.totalTokens) }}</dd></div>
              <div><dt>Added this turn</dt><dd>+{{ formatNumberFull(selectedPoint.contextAddedTokens) }}</dd></div>
              <div><dt>System prompt</dt><dd>{{ formatNumberFull(selectedPoint.systemTokens) }}</dd></div>
              <div><dt>Tool definitions</dt><dd>{{ formatNumberFull(selectedPoint.toolDefinitionTokens) }}</dd></div>
              <div><dt>Conversation</dt><dd>{{ formatNumberFull(selectedPoint.conversationTokens) }}</dd></div>
            </dl>
            <p class="context-tab__footnote">
              Added context is an estimate calibrated to the surrounding observed totals.
            </p>
            <p v-if="selectedPoint.source === 'observed'" class="context-tab__footnote">
              Copilot reported all three displayed layers for this point.
            </p>
            <button
              type="button"
              class="context-tab__conversation-link"
              @click="openConversation(selectedPoint.turn)"
            >
              View turn in Conversation
            </button>
          </div>
          <div v-else class="context-tab__placeholder">
            Select a turn, event, or compaction marker to inspect it.
          </div>

          <div v-if="selectedCompaction" class="context-tab__compaction-details">
            <div class="context-tab__detail-heading">
              <div>
                <span class="context-tab__eyebrow">
                  Turns {{ selectedCompaction.startTurn }}–{{ selectedCompaction.completeTurn }}
                </span>
                <h3>Compaction diagnostics</h3>
              </div>
              <Badge :variant="selectedCompaction.success ? 'success' : 'danger'">
                {{ selectedCompaction.success ? 'Completed' : 'Failed' }}
              </Badge>
            </div>
            <dl class="context-tab__token-grid">
              <div><dt>Before</dt><dd>{{ formatNumberFull(selectedCompaction.beforeTokens ?? 0) }}</dd></div>
              <div><dt>After</dt><dd>{{ formatNumberFull(selectedCompaction.afterTokens ?? 0) }}</dd></div>
              <div><dt>Removed</dt><dd>{{ formatNumberFull(selectedCompaction.tokensRemoved ?? 0) }}</dd></div>
              <div><dt>Checkpoint</dt><dd>{{ selectedCompaction.checkpointNumber ?? '—' }}</dd></div>
            </dl>
            <p class="context-tab__footnote">
              After-compaction total is {{ selectedCompaction.afterSource }}; savings inherit that confidence.
            </p>
            <dl
              v-if="
                selectedCompaction.compactionModel ||
                selectedCompaction.durationMs ||
                selectedCompaction.requestInputTokens
              "
              class="context-tab__compaction-request"
            >
              <div v-if="selectedCompaction.compactionModel">
                <dt>Compaction model</dt>
                <dd>{{ selectedCompaction.compactionModel }}</dd>
              </div>
              <div v-if="selectedCompaction.durationMs">
                <dt>Duration</dt>
                <dd>{{ selectedCompaction.durationMs.toLocaleString() }} ms</dd>
              </div>
              <div v-if="selectedCompaction.requestInputTokens">
                <dt>Request input</dt>
                <dd>{{ formatNumberFull(selectedCompaction.requestInputTokens) }}</dd>
              </div>
              <div v-if="selectedCompaction.requestOutputTokens">
                <dt>Request output</dt>
                <dd>{{ formatNumberFull(selectedCompaction.requestOutputTokens) }}</dd>
              </div>
              <div v-if="selectedCompaction.cacheReadTokens">
                <dt>Cache read</dt>
                <dd>{{ formatNumberFull(selectedCompaction.cacheReadTokens) }}</dd>
              </div>
            </dl>
            <button
              v-if="selectedCompaction.checkpointNumber != null"
              type="button"
              class="context-tab__checkpoint-link"
              @click="navigateToCheckpoint(selectedCompaction.checkpointNumber)"
            >
              Open checkpoint #{{ selectedCompaction.checkpointNumber }} in Overview
            </button>
          </div>

          <div v-if="selectedPoint" class="context-tab__turn-tools">
            <div class="context-tab__turn-tools-heading">
              <div>
                <span class="context-tab__eyebrow">Turn {{ selectedPoint.turn }}</span>
                <strong>Tool calls in this turn</strong>
              </div>
              <LoadingSpinner v-if="loadingTurnTools" size="sm" />
            </div>
            <p v-if="store.turnsError" class="context-tab__turn-tools-error">
              {{ store.turnsError }}
            </p>
            <div v-else-if="selectedTurnToolCalls.length" class="context-tab__turn-tool-list">
              <ToolCallItem
                v-for="(item, index) in selectedTurnToolCalls"
                :key="item.toolCallId ?? `${item.toolName}-${index}`"
                class="context-tab__bounded-tool"
                :tc="item"
                :expanded="selectedTurnToolCall === item"
                :full-result="item.toolCallId ? fullResults.get(item.toolCallId) : undefined"
                :loading-full-result="
                  item.toolCallId ? loadingResults.has(item.toolCallId) : false
                "
                :failed-full-result="
                  item.toolCallId ? failedResults.has(item.toolCallId) : false
                "
                :rich-enabled="richEnabledFor(item.toolName)"
                @toggle="selectTurnToolCall(item)"
                @load-full-result="loadFullResult"
                @retry-full-result="retryFullResult"
              />
            </div>
            <p v-else-if="!loadingTurnTools" class="context-tab__turn-tools-empty">
              No tool calls in this turn.
            </p>
          </div>
        </div>
      </SectionPanel>

      <SectionPanel title="Session tool contribution">
        <div class="context-tab__analysis-heading">
          <p>Compare estimated context contribution by tool type or individual call.</p>
          <div class="context-tab__view-switch" aria-label="Tool contribution view">
            <button
              v-for="view in toolAnalysisViews"
              :key="view.id"
              type="button"
              :class="{ active: toolAnalysisView === view.id }"
              :aria-pressed="toolAnalysisView === view.id"
              @click="toolAnalysisView = view.id"
            >
              {{ view.label }}
            </button>
          </div>
        </div>

        <div
          v-if="toolAnalysisView === 'types' && displayedToolTypes.length"
          class="context-tab__tool-type-panel"
        >
          <div class="context-tab__tool-types">
            <div
              v-for="item in displayedToolTypes"
              :key="item.toolName"
              class="context-tab__tool-type"
            >
              <div class="context-tab__tool-type-heading">
                <span>
                  <strong>{{ item.toolName }}</strong>
                  <small>{{ item.callCount }} calls · {{ item.errorCount }} errors</small>
                </span>
                <span>{{ formatNumber(item.totalTokens) }} · {{ item.percentage.toFixed(1) }}%</span>
              </div>
              <div class="context-tab__bar">
                <span :style="{ width: `${Math.max(item.percentage, 1)}%` }" />
              </div>
              <small class="context-tab__tool-split">
                {{ formatNumber(item.argumentTokens) }} arguments ·
                {{ formatNumber(item.resultTokens) }} returned result
              </small>
            </div>
          </div>
        </div>
        <ToolTypeDonut
          v-else-if="toolAnalysisView === 'chart' && timeline.toolTypes.length"
          :items="timeline.toolTypes"
        />
        <template v-else-if="toolAnalysisView === 'calls'">
          <div v-if="displayedToolCalls.length" class="context-tab__ranked-tools">
            <button
              v-for="(item, index) in displayedToolCalls"
              :key="item.toolCallId ?? `${item.turn}-${item.toolName}-${index}`"
              type="button"
              class="context-tab__ranked-tool"
              :class="{ 'context-tab__ranked-tool--selected': selectedToolCall === item }"
              :aria-expanded="selectedToolCall === item"
              @click="toggleToolCall(item)"
            >
              <span class="context-tab__rank">{{ index + 1 }}</span>
              <span class="context-tab__ranked-tool-main">
                <span class="context-tab__ranked-tool-heading">
                  <strong>{{ item.toolName }}</strong>
                  <small>Turn {{ item.turn }}</small>
                </span>
                <span class="context-tab__ranked-tool-summary">{{ toolCallSummary(item) }}</span>
                <span class="context-tab__ranked-tool-bar">
                  <span
                    :style="{
                      width: `${Math.max((item.totalTokens / maxToolCallTokens) * 100, 2)}%`,
                    }"
                  />
                </span>
              </span>
              <span class="context-tab__ranked-tool-tokens">
                <strong>{{ formatNumber(item.totalTokens) }}</strong>
                <small>
                  {{ formatNumber(item.argumentTokens) }} args ·
                  {{ formatNumber(item.resultTokens) }} result
                </small>
              </span>
            </button>
          </div>
          <div v-if="selectedToolCall" class="context-tab__selected-tool">
            <div class="context-tab__selected-tool-heading">
              <div>
                <span class="context-tab__eyebrow">Turn {{ selectedToolCall.turn }}</span>
                <strong>{{ selectedToolCall.toolName }} details</strong>
              </div>
              <button
                type="button"
                aria-label="Close tool call details"
                @click="selectedToolCall = null"
              >
                ×
              </button>
            </div>
            <ToolCallItem
              v-if="selectedContributionToolCall"
              class="context-tab__bounded-tool"
              :tc="selectedContributionToolCall"
              :expanded="true"
              :full-result="
                selectedToolCall.toolCallId
                  ? fullResults.get(selectedToolCall.toolCallId)
                  : undefined
              "
              :loading-full-result="
                selectedToolCall.toolCallId
                  ? loadingResults.has(selectedToolCall.toolCallId)
                  : false
              "
              :failed-full-result="
                selectedToolCall.toolCallId
                  ? failedResults.has(selectedToolCall.toolCallId)
                  : false
              "
              :rich-enabled="richEnabledFor(selectedContributionToolCall.toolName)"
              @toggle="selectedToolCall = null"
              @load-full-result="loadFullResult"
              @retry-full-result="retryFullResult"
            />
          </div>
          <p v-if="!displayedToolCalls.length" class="context-tab__placeholder">
            No tool calls were captured for this session.
          </p>
          <p v-if="displayedToolCalls.length" class="context-tab__footnote">
            Contribution estimates measure captured arguments and returned results that may become
            later prompt input; they are not per-call cache attribution.
          </p>
        </template>
        <p
          v-else
          class="context-tab__placeholder"
        >
          No tool calls were captured for this session.
        </p>
      </SectionPanel>
    </template>
  </div>
</template>

<style scoped>
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

.context-tab__methodology {
  position: relative;
}

.context-tab__methodology summary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  cursor: pointer;
  list-style: none;
}

.context-tab__methodology summary::-webkit-details-marker {
  display: none;
}

.context-tab__methodology > div {
  position: absolute;
  z-index: var(--z-tooltip);
  top: calc(100% + 7px);
  left: 0;
  width: min(520px, calc(100vw - 64px));
  padding: 12px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-overlay, var(--canvas-default));
  box-shadow: var(--shadow-lg);
}

.context-tab__methodology strong {
  color: var(--text-primary);
  font-size: 0.8125rem;
}

.context-tab__methodology p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.45;
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

.context-tab__selected-inspector {
  display: grid;
  min-width: 0;
  gap: 12px;
}

.context-tab__detail-card,
.context-tab__placeholder {
  min-height: 150px;
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.context-tab__detail-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}

.context-tab__detail-heading h3 {
  margin: 2px 0 0;
  color: var(--text-primary);
  font-size: 1rem;
}

.context-tab__compaction-details {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-inset);
}

.context-tab__eyebrow {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.context-tab__token-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.context-tab__token-grid div {
  min-width: 0;
}

.context-tab__token-grid dt {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.context-tab__token-grid dd {
  margin: 2px 0 0;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-weight: 600;
}

.context-tab__footnote {
  margin: 14px 0 0;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  line-height: 1.45;
}

.context-tab__event-preview {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.55;
  white-space: pre-wrap;
}

.context-tab__conversation-link {
  padding: 5px 8px;
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-sm);
  background: var(--accent-subtle);
  color: var(--accent-fg);
  font: inherit;
  font-size: 0.6875rem;
  cursor: pointer;
}

.context-tab__conversation-link {
  margin-top: 12px;
}

.context-tab__conversation-link:hover {
  border-color: var(--accent-fg);
  color: var(--text-primary);
}

.context-tab__turn-tools {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.context-tab__turn-tools-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.context-tab__turn-tools-heading > div {
  display: grid;
  gap: 2px;
}

.context-tab__turn-tools-heading strong {
  color: var(--text-primary);
  font-size: 0.8125rem;
}

.context-tab__turn-tool-list {
  display: grid;
  min-width: 0;
  max-width: 100%;
  gap: 8px;
  margin-top: 10px;
}

.context-tab__bounded-tool {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.context-tab__bounded-tool :deep([data-tp-component="RendererShell"]) {
  min-width: 0;
  max-width: 100%;
}

.context-tab__turn-tools-empty,
.context-tab__turn-tools-error {
  margin: 10px 0 0;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.context-tab__turn-tools-error {
  color: var(--danger-fg);
}

.context-tab__compaction-request {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--border-muted);
}

.context-tab__compaction-request dt {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.context-tab__compaction-request dd {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-tab__checkpoint-link {
  margin-top: 12px;
  padding: 5px 8px;
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-sm);
  background: var(--accent-subtle);
  color: var(--accent-fg);
  font: inherit;
  font-size: 0.6875rem;
  cursor: pointer;
}

.context-tab__placeholder {
  display: grid;
  place-items: center;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-align: center;
}

.context-tab__analysis-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.context-tab__analysis-heading p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.context-tab__tool-type-panel,
.context-tab__tool-types {
  display: grid;
  gap: 12px;
}

.context-tab__tool-type-panel {
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.context-tab__view-switch {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
}

.context-tab__view-switch button {
  padding: 3px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  font: inherit;
  font-size: 0.6875rem;
  cursor: pointer;
}

.context-tab__view-switch button:hover {
  color: var(--text-primary);
}

.context-tab__view-switch button.active {
  border-color: var(--border-default);
  background: var(--canvas-default);
  color: var(--text-primary);
}

.context-tab__tool-type {
  display: grid;
  gap: 5px;
}

.context-tab__tool-type-heading {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.context-tab__tool-type-heading > span:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.context-tab__tool-type-heading strong {
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-tab__tool-type-heading small,
.context-tab__tool-split {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.context-tab__bar {
  height: 5px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
}

.context-tab__bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--chart-warning);
}

.context-tab__ranked-tools {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.context-tab__ranked-tool {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid var(--border-muted);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.context-tab__ranked-tool:last-child {
  border-bottom: 0;
}

.context-tab__ranked-tool:hover,
.context-tab__ranked-tool--selected {
  background: var(--neutral-subtle);
}

.context-tab__ranked-tool--selected {
  box-shadow: inset 2px 0 0 var(--accent-fg);
}

.context-tab__rank {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--neutral-muted);
  color: var(--text-secondary);
  font-size: 0.6875rem;
  font-weight: 700;
}

.context-tab__ranked-tool-main {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.context-tab__ranked-tool-heading {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}

.context-tab__ranked-tool-heading strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-tab__ranked-tool-heading small,
.context-tab__ranked-tool-summary,
.context-tab__ranked-tool-tokens small {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.context-tab__ranked-tool-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-tab__ranked-tool-bar {
  height: 3px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
}

.context-tab__ranked-tool-bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--chart-warning);
}

.context-tab__ranked-tool-tokens {
  display: grid;
  justify-items: end;
  gap: 2px;
  white-space: nowrap;
}

.context-tab__ranked-tool-tokens strong {
  color: var(--text-primary);
  font-size: 0.8125rem;
}

.context-tab__selected-tool {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.context-tab__selected-tool-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.context-tab__selected-tool-heading > div:first-child {
  display: grid;
  gap: 2px;
}

.context-tab__selected-tool-heading strong {
  color: var(--text-primary);
  font-size: 0.8125rem;
}

.context-tab__selected-tool-heading button {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  font: inherit;
  font-size: 1rem;
  cursor: pointer;
}

.context-tab__selected-tool-heading button:hover {
  background: var(--neutral-muted);
  color: var(--text-primary);
}

@media (max-width: 900px) {
  .context-tab__token-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

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

  .context-tab__analysis-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .context-tab__ranked-tool {
    grid-template-columns: 22px minmax(0, 1fr);
  }

  .context-tab__ranked-tool-tokens {
    grid-column: 2;
    justify-items: start;
  }
}
</style>
