<script setup lang="ts">
import type {
  ContextCompaction,
  ContextTimeline,
  ContextToolCallContribution,
  ContextWindowPoint,
} from "@tracepilot/types";
import {
  Badge,
  EmptyState,
  ErrorAlert,
  formatNumber,
  formatNumberFull,
  SectionPanel,
  SkeletonLoader,
  StatCard,
} from "@tracepilot/ui";
import { Activity, DatabaseZap } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import ContextWindowChart from "@/components/context/ContextWindowChart.vue";
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
const totalRemoved = computed(() =>
  (timeline.value?.compactions ?? []).reduce(
    (sum, compaction) => sum + (compaction.tokensRemoved ?? 0),
    0,
  ),
);
const displayedToolCalls = computed(() => (timeline.value?.topToolCalls ?? []).slice(0, 10));
const displayedToolTypes = computed(() => (timeline.value?.toolTypes ?? []).slice(0, 8));

function selectPoint(point: ContextWindowPoint) {
  selectedPoint.value = point;
  selectedCompaction.value = null;
}

function selectCompaction(compaction: ContextCompaction) {
  selectedCompaction.value = compaction;
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
      <SkeletonLoader variant="text" :count="2" />
      <SkeletonLoader variant="card" :count="2" />
    </div>

    <EmptyState
      v-else-if="timeline && timeline.points.length === 0"
      title="No context telemetry yet"
      description="This session has no assistant turns or context snapshots to analyze."
    >
      <template #icon><Activity /></template>
    </EmptyState>

    <template v-else-if="timeline">
      <div class="context-tab__notice">
        <DatabaseZap :size="17" aria-hidden="true" />
        <div>
          <strong>Source-aware reconstruction</strong>
          <span>{{ timeline.methodology }}</span>
        </div>
        <Badge v-if="refreshing" variant="neutral">Refreshing</Badge>
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
          {{ timeline.pairedCompactionCount }}/{{ timeline.compactionStartCount }} compactions paired
        </Badge>
      </div>

      <div class="grid-4 mb-6">
        <StatCard :value="formatNumber(peakTokens)" label="Peak Context" :gradient="true" />
        <StatCard :value="formatNumber(latestTokens)" label="Latest Context" color="done" />
        <StatCard :value="timeline.compactions.length" label="Compactions" color="warning" />
        <StatCard :value="formatNumber(totalRemoved)" label="Est. Tokens Removed" color="success" />
      </div>

      <SectionPanel title="Context pressure by turn">
        <ContextWindowChart
          :timeline="timeline"
          :selected-point="selectedPoint"
          @select-point="selectPoint"
          @select-compaction="selectCompaction"
        />
      </SectionPanel>

      <div class="context-tab__details">
        <SectionPanel title="Selected point">
          <div v-if="selectedPoint" class="context-tab__detail-card">
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
          <div v-if="displayedToolCalls.length" class="context-tab__contributors">
          <button
            v-for="(item, index) in displayedToolCalls"
            :key="item.toolCallId ?? `${item.turn}-${item.toolName}-${index}`"
            type="button"
            class="context-tab__contributor"
            :class="{ 'context-tab__contributor--selected': selectedToolCall === item }"
            @click="selectToolCall(item)"
          >
            <span class="context-tab__contributor-rank">{{ index + 1 }}</span>
            <span class="context-tab__contributor-name">
              <strong>{{ item.toolName }}</strong>
              <small>
                Turn {{ item.turn }} · {{ formatNumber(item.argumentTokens) }} arguments ·
                {{ formatNumber(item.resultTokens) }} result
              </small>
            </span>
            <Badge v-if="item.success === false" variant="danger">Failed</Badge>
            <span>{{ formatNumber(item.totalTokens) }} tokens</span>
          </button>
        </div>
          <p v-else class="context-tab__placeholder">No tool calls were captured for this session.</p>
          <div v-if="selectedToolCall" class="context-tab__tool-inspector">
            <div class="context-tab__detail-heading">
              <div>
                <span class="context-tab__eyebrow">Turn {{ selectedToolCall.turn }}</span>
                <h3>{{ selectedToolCall.toolName }}</h3>
              </div>
              <Badge variant="neutral">{{ formatNumber(selectedToolCall.totalTokens) }} estimated tokens</Badge>
            </div>
            <p class="context-tab__footnote">
              Arguments and returned results can become later LLM prompt input. The event stream
              does not reveal whether this individual payload was a cache write, cache read, or
              uncached input.
            </p>
            <template v-if="selectedToolCall.argumentsPreview">
              <h4>Arguments</h4>
              <pre>{{ selectedToolCall.argumentsPreview }}</pre>
            </template>
            <template v-if="selectedToolCall.resultPreview">
              <h4>Returned result preview</h4>
              <pre>{{ fullResults.get(selectedToolCall.toolCallId ?? '') ?? selectedToolCall.resultPreview }}</pre>
            </template>
            <button
              v-if="selectedToolCall.toolCallId && !fullResults.has(selectedToolCall.toolCallId)"
              type="button"
              class="context-tab__load-result"
              :disabled="loadingResults.has(selectedToolCall.toolCallId)"
              @click="
                failedResults.has(selectedToolCall.toolCallId)
                  ? retryFullResult(selectedToolCall.toolCallId)
                  : loadFullResult(selectedToolCall.toolCallId)
              "
            >
              {{
                loadingResults.has(selectedToolCall.toolCallId)
                  ? 'Loading…'
                  : failedResults.has(selectedToolCall.toolCallId)
                    ? 'Retry full result'
                    : 'Load full captured result'
              }}
            </button>
          </div>
        </SectionPanel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.context-tab__loading {
  display: grid;
  align-content: start;
  gap: 16px;
  min-height: 620px;
}

.context-tab__notice {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  margin-bottom: 20px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  color: var(--text-secondary);
}

.context-tab__notice svg {
  color: var(--accent-fg);
  flex-shrink: 0;
}

.context-tab__notice div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.context-tab__notice strong {
  color: var(--text-primary);
  font-size: 0.8125rem;
}

.context-tab__notice span {
  font-size: 0.75rem;
  line-height: 1.45;
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

.context-tab__placeholder {
  display: grid;
  place-items: center;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-align: center;
}

.context-tab__contributors {
  display: grid;
  gap: 6px;
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

.context-tab__contributor {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.context-tab__contributor:hover {
  border-color: var(--border-default);
  background: var(--canvas-subtle);
}

.context-tab__contributor--selected {
  border-color: var(--border-accent);
  background: var(--canvas-subtle);
}

.context-tab__contributor-rank {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--neutral-subtle);
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.context-tab__contributor-name {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}

.context-tab__contributor-name strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-tab__contributor-name small {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.context-tab__tool-inspector {
  margin-top: 12px;
  padding: 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.context-tab__tool-inspector h4 {
  margin: 14px 0 5px;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.context-tab__tool-inspector pre {
  max-height: 240px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--text-secondary);
  font-size: 0.6875rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.context-tab__load-result {
  margin-top: 10px;
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

@media (max-width: 900px) {
  .context-tab__details {
    grid-template-columns: 1fr;
  }

  .context-tab__token-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .context-tab__notice {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
</style>
