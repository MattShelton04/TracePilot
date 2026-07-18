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
import { useCheckpointNavigation } from "@/composables/useCheckpointNavigation";
import { getCachedContextTimeline, loadContextTimeline } from "@/composables/useContextTimeline";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useToolResultLoader } from "@/composables/useToolResultLoader";

const store = useSessionDetailContext();
const timeline = ref<ContextTimeline | null>(null);
const loading = ref(false);
const refreshing = ref(false);
const error = ref<string | null>(null);
const selectedPoint = ref<ContextWindowPoint | null>(null);
const selectedCompaction = ref<ContextCompaction | null>(null);
const selectedToolCall = ref<ContextToolCallContribution | null>(null);
const selectedTimelineEvent = ref<ContextTimelineEvent | null>(null);
const navigateToCheckpoint = useCheckpointNavigation();
const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } =
  useToolResultLoader(() => store.sessionId);
let requestVersion = 0;

async function load(sessionId: string) {
  const version = ++requestVersion;
  const cached = getCachedContextTimeline(sessionId);
  if (cached) timeline.value = cached.timeline;
  loading.value = !cached;
  refreshing.value = Boolean(cached);
  error.value = null;
  try {
    const response = await loadContextTimeline(sessionId);
    if (version !== requestVersion) return;
    timeline.value = response.timeline;
  } catch (cause) {
    if (version !== requestVersion) return;
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (version === requestVersion) {
      loading.value = false;
      refreshing.value = false;
    }
  }
}

watch(
  () => store.sessionId,
  (sessionId) => {
    selectedPoint.value = null;
    selectedCompaction.value = null;
    selectedToolCall.value = null;
    selectedTimelineEvent.value = null;
    if (sessionId) load(sessionId);
  },
  { immediate: true },
);

watch(timeline, (value) => {
  if (value?.points.length) selectedPoint.value = value.points[value.points.length - 1];
});

const peakTokens = computed(() =>
  Math.max(...(timeline.value?.points.map((point) => point.totalTokens) ?? [0])),
);
const latestTokens = computed(
  () => timeline.value?.points[timeline.value.points.length - 1]?.totalTokens ?? 0,
);
const displayedToolCalls = computed(() => (timeline.value?.topToolCalls ?? []).slice(0, 10));
const displayedToolTypes = computed(() => (timeline.value?.toolTypes ?? []).slice(0, 8));

function selectPoint(point: ContextWindowPoint) {
  selectedPoint.value = point;
  selectedCompaction.value = null;
  selectedTimelineEvent.value = null;
}

function selectCompaction(compaction: ContextCompaction) {
  selectedCompaction.value = compaction;
  selectedTimelineEvent.value = null;
  selectedPoint.value =
    timeline.value?.points.find(
      (point) => point.turn === compaction.completeTurn && point.phase === "postCompaction",
    ) ??
    timeline.value?.points.find((point) => point.turn === compaction.completeTurn) ??
    null;
}

function selectToolCall(item: ContextToolCallContribution) {
  selectedToolCall.value = item;
  selectedPoint.value =
    timeline.value?.points.find((point) => point.turn === item.turn && point.phase === "turn") ??
    timeline.value?.points.find((point) => point.turn === item.turn) ??
    selectedPoint.value;
}

function selectTimelineEvent(event: ContextTimelineEvent) {
  selectedTimelineEvent.value = event;
  selectedCompaction.value = null;
  selectedPoint.value =
    timeline.value?.points.find((point) => point.turn === event.turn && point.phase === "turn") ??
    timeline.value?.points.find((point) => point.turn === event.turn) ??
    null;
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
          <Badge variant="neutral">{{ timeline.observedPointCount }} observed</Badge>
          <Badge variant="warning">{{ timeline.estimatedPointCount }} estimated</Badge>
          <Badge
            :variant="
              timeline.compactionStartCount === timeline.compactionCompleteCount &&
              timeline.pairedCompactionCount === timeline.compactionStartCount
                ? 'success'
                : 'warning'
            "
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
        />
      </SectionPanel>

      <div class="context-tab__details">
        <SectionPanel title="Selected point">
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
              <div><dt>System prompt</dt><dd>{{ formatNumberFull(selectedPoint.systemTokens) }}</dd></div>
              <div><dt>Tool definitions</dt><dd>{{ formatNumberFull(selectedPoint.toolDefinitionTokens) }}</dd></div>
              <div><dt>Conversation</dt><dd>{{ formatNumberFull(selectedPoint.conversationTokens) }}</dd></div>
            </dl>
            <p v-if="selectedPoint.source === 'observed'" class="context-tab__footnote">
              Copilot reported all three displayed layers for this point.
            </p>
          </div>
        </SectionPanel>

        <SectionPanel title="Compaction diagnostics">
          <div v-if="selectedCompaction" class="context-tab__detail-card">
            <div class="context-tab__detail-heading">
              <div>
                <span class="context-tab__eyebrow">
                  Turn {{ selectedCompaction.startTurn }} → {{ selectedCompaction.completeTurn }}
                </span>
                <h3>Copilot compaction</h3>
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
          <div v-else class="context-tab__placeholder">
            Select a dashed compaction marker to inspect its before/after estimate.
          </div>
          <div v-if="timeline.compactions.length" class="context-tab__compaction-list">
            <button
              v-for="(compaction, index) in timeline.compactions"
              :key="`${compaction.startTurn}-${compaction.completeTurn}-${index}`"
              type="button"
              :class="{ 'context-tab__compact-row--selected': selectedCompaction === compaction }"
              @click="selectCompaction(compaction)"
            >
              <span>#{{ index + 1 }} · turns {{ compaction.startTurn }}–{{ compaction.completeTurn }}</span>
              <strong>{{ formatNumber(compaction.tokensRemoved ?? 0) }} removed</strong>
            </button>
          </div>
        </SectionPanel>
      </div>

      <div class="context-tab__details">
        <SectionPanel title="Tool types by estimated contribution">
          <div v-if="displayedToolTypes.length" class="context-tab__tool-types">
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
          <p v-else class="context-tab__placeholder">No tool calls were captured for this session.</p>
        </SectionPanel>

        <SectionPanel title="Most expensive tool calls">
          <div v-if="displayedToolCalls.length" class="context-tab__rich-tools">
            <div
              v-for="(item, index) in displayedToolCalls"
              :key="item.toolCallId ?? `${item.turn}-${item.toolName}-${index}`"
              class="context-tab__rich-tool"
            >
              <div class="context-tab__rich-tool-meta">
                <span>#{{ index + 1 }} · Turn {{ item.turn }}</span>
                <span>
                  {{ formatNumber(item.argumentTokens) }} arguments ·
                  {{ formatNumber(item.resultTokens) }} result ·
                  <strong>{{ formatNumber(item.totalTokens) }} estimated tokens</strong>
                </span>
              </div>
              <ToolCallItem
                :tc="toolCallFor(item)"
                :expanded="selectedToolCall === item"
                :full-result="
                  item.toolCallId ? fullResults.get(item.toolCallId) : undefined
                "
                :loading-full-result="
                  item.toolCallId ? loadingResults.has(item.toolCallId) : false
                "
                :failed-full-result="
                  item.toolCallId ? failedResults.has(item.toolCallId) : false
                "
                @toggle="toggleToolCall(item)"
                @load-full-result="loadFullResult"
                @retry-full-result="retryFullResult"
              />
            </div>
          </div>
          <p v-else class="context-tab__placeholder">No tool calls were captured for this session.</p>
          <p v-if="displayedToolCalls.length" class="context-tab__footnote">
            Contribution estimates measure captured arguments and returned results that may become
            later prompt input; they are not per-call cache attribution.
          </p>
        </SectionPanel>
      </div>
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

.context-tab__stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.context-tab__details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
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

.context-tab__compaction-list {
  display: grid;
  max-height: 180px;
  margin-top: 10px;
  overflow: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.context-tab__compaction-list button {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--border-muted);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.6875rem;
  cursor: pointer;
}

.context-tab__compaction-list button:last-child {
  border-bottom: 0;
}

.context-tab__compaction-list button:hover,
.context-tab__compact-row--selected {
  background: var(--canvas-subtle) !important;
  color: var(--text-primary) !important;
}

.context-tab__tool-types {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
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

.context-tab__rich-tools {
  display: grid;
  gap: 10px;
}

.context-tab__rich-tool {
  min-width: 0;
}

.context-tab__rich-tool-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0 4px 4px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.context-tab__rich-tool-meta strong {
  color: var(--text-secondary);
}

@media (max-width: 900px) {
  .context-tab__details {
    grid-template-columns: 1fr;
  }

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

  .context-tab__rich-tool-meta {
    flex-direction: column;
    gap: 2px;
  }
}
</style>
