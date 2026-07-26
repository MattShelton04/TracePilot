<script setup lang="ts">
import {
  type ContextCompaction,
  type ContextTimelineEvent,
  type ContextWindowPoint,
  formatAiCredits,
  type TurnToolCall,
} from "@tracepilot/types";
import { Badge, formatNumberFull, formatTime, LoadingSpinner, ToolCallItem } from "@tracepilot/ui";

defineProps<{
  selectedTimelineEvent: ContextTimelineEvent | null;
  selectedPoint: ContextWindowPoint | null;
  selectedCompaction: ContextCompaction | null;
  pointModel: string | null;
  cachedInputAiCredits: number | null;
  selectedTurnToolCalls: TurnToolCall[];
  selectedTurnToolCall: TurnToolCall | null;
  loadingTurnTools: boolean;
  turnsError: string | null;
  fullResults: Map<string, string>;
  loadingResults: Set<string>;
  failedResults: Set<string>;
  richEnabledFor: (toolName: string) => boolean;
}>();

const emit = defineEmits<{
  openConversation: [turn: number, eventIndex?: number | null];
  navigateCheckpoint: [checkpointNumber: number];
  selectTurnTool: [item: TurnToolCall];
  loadFullResult: [toolCallId: string];
  retryFullResult: [toolCallId: string];
}>();

function phaseLabel(point: ContextWindowPoint): string {
  const labels: Record<ContextWindowPoint["phase"], string> = {
    turn: "Turn",
    preCompaction: "Before compaction",
    postCompaction: "After compaction",
    shutdown: "Shutdown",
  };
  return labels[point.phase];
}

function formatContextChange(value?: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${formatNumberFull(value)}`;
}
</script>

<template>
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
          emit(
            'openConversation',
            selectedTimelineEvent.turn,
            selectedTimelineEvent.eventIndex,
          )
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
        <div>
          <dt>Total</dt>
          <dd>{{ formatNumberFull(selectedPoint.totalTokens) }}</dd>
        </div>
        <div>
          <dt>Change from previous point</dt>
          <dd>{{ formatContextChange(selectedPoint.contextChangeTokens) }}</dd>
        </div>
        <div>
          <dt>System prompt</dt>
          <dd>{{ formatNumberFull(selectedPoint.systemTokens) }}</dd>
        </div>
        <div>
          <dt>Tool definitions</dt>
          <dd>{{ formatNumberFull(selectedPoint.toolDefinitionTokens) }}</dd>
        </div>
        <div>
          <dt>Conversation</dt>
          <dd>{{ formatNumberFull(selectedPoint.conversationTokens) }}</dd>
        </div>
        <div v-if="cachedInputAiCredits != null">
          <dt>Cached-input equivalent</dt>
          <dd>{{ formatAiCredits(cachedInputAiCredits) }}</dd>
        </div>
      </dl>
      <p class="context-tab__footnote">
        Change is the current displayed total minus the previous displayed point.
      </p>
      <p v-if="selectedPoint.source === 'observed'" class="context-tab__footnote">
        Copilot reported all three displayed layers for this point.
      </p>
      <p v-else class="context-tab__footnote">
        Estimated points reuse observed system/tool layers when available. Before the first
        telemetry anchor, System is estimated from the initial main-agent system message; full tool
        definitions are not present in events.jsonl, so that layer is shown as zero.
      </p>
      <p v-if="cachedInputAiCredits != null" class="context-tab__footnote">
        At current {{ pointModel }} rates, if this entire displayed context were one cache read.
        This is a comparison baseline, not the turn's bill; it excludes uncached input, cache
        writes, output/reasoning, compaction, and subagent usage.
      </p>
      <button
        type="button"
        class="context-tab__conversation-link"
        @click="emit('openConversation', selectedPoint.turn)"
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
          {{ selectedCompaction.success ? "Completed" : "Failed" }}
        </Badge>
      </div>
      <dl class="context-tab__token-grid">
        <div>
          <dt>Before</dt>
          <dd>{{ formatNumberFull(selectedCompaction.beforeTokens ?? 0) }}</dd>
        </div>
        <div>
          <dt>After</dt>
          <dd>{{ formatNumberFull(selectedCompaction.afterTokens ?? 0) }}</dd>
        </div>
        <div>
          <dt>Removed</dt>
          <dd>{{ formatNumberFull(selectedCompaction.tokensRemoved ?? 0) }}</dd>
        </div>
        <div>
          <dt>Checkpoint</dt>
          <dd>{{ selectedCompaction.checkpointNumber ?? "—" }}</dd>
        </div>
      </dl>
      <p class="context-tab__footnote">
        After-compaction total is {{ selectedCompaction.afterSource }}; savings inherit that
        confidence.
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
        @click="emit('navigateCheckpoint', selectedCompaction.checkpointNumber)"
      >
        Open checkpoint #{{ selectedCompaction.checkpointNumber }} in Overview
      </button>
    </div>

    <div v-if="selectedPoint" class="context-tab__turn-tools">
      <div class="context-tab__turn-tools-heading">
        <div>
          <span class="context-tab__eyebrow">Turn {{ selectedPoint.turn }}</span>
          <strong>Main-agent tool calls in this turn</strong>
        </div>
        <LoadingSpinner v-if="loadingTurnTools" size="sm" />
      </div>
      <p v-if="turnsError" class="context-tab__turn-tools-error">{{ turnsError }}</p>
      <div v-else-if="selectedTurnToolCalls.length" class="context-tab__turn-tool-list">
        <ToolCallItem
          v-for="(item, index) in selectedTurnToolCalls"
          :key="item.toolCallId ?? `${item.toolName}-${index}`"
          class="context-tab__bounded-tool"
          :tc="item"
          :expanded="selectedTurnToolCall === item"
          :full-result="item.toolCallId ? fullResults.get(item.toolCallId) : undefined"
          :loading-full-result="item.toolCallId ? loadingResults.has(item.toolCallId) : false"
          :failed-full-result="item.toolCallId ? failedResults.has(item.toolCallId) : false"
          :rich-enabled="richEnabledFor(item.toolName)"
          @toggle="emit('selectTurnTool', item)"
          @load-full-result="emit('loadFullResult', $event)"
          @retry-full-result="emit('retryFullResult', $event)"
        />
      </div>
      <p v-else-if="!loadingTurnTools" class="context-tab__turn-tools-empty">
        No main-agent tool calls in this turn.
      </p>
    </div>
  </div>
</template>

<style scoped>
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

.context-tab__token-grid dt,
.context-tab__compaction-request dt {
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

.context-tab__conversation-link,
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

.context-tab__compaction-request dd {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-tab__placeholder {
  display: grid;
  place-items: center;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-align: center;
}

@media (max-width: 900px) {
  .context-tab__token-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
