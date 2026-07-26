<script setup lang="ts">
import type { ContextTimeline, ContextToolCallContribution, TurnToolCall } from "@tracepilot/types";
import { formatNumber, ToolCallItem } from "@tracepilot/ui";
import { computed, ref } from "vue";
import ToolTypeDonut from "./ToolTypeDonut.vue";

const props = defineProps<{
  timeline: ContextTimeline;
  selectedToolCall: ContextToolCallContribution | null;
  selectedContributionToolCall: TurnToolCall | null;
  fullResults: Map<string, string>;
  loadingResults: Set<string>;
  failedResults: Set<string>;
  richEnabledFor: (toolName: string) => boolean;
}>();

const emit = defineEmits<{
  selectToolCall: [item: ContextToolCallContribution];
  clearToolCall: [];
  loadFullResult: [toolCallId: string];
  retryFullResult: [toolCallId: string];
}>();

type ToolAnalysisView = "overview" | "calls";
const toolAnalysisViews: Array<{ id: ToolAnalysisView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "calls", label: "Expensive calls" },
];
const toolAnalysisView = ref<ToolAnalysisView>("overview");
const displayedToolCalls = computed(() => props.timeline.topToolCalls.slice(0, 10));
const displayedToolTypes = computed(() => props.timeline.toolTypes.slice(0, 8));
const maxToolCallTokens = computed(() => displayedToolCalls.value[0]?.totalTokens ?? 1);

function toolCallSummary(item: ContextToolCallContribution): string {
  const value = item.argumentsPreview?.replace(/\s+/g, " ").trim();
  if (!value) return "No captured arguments";
  return value.length > 110 ? `${value.slice(0, 107)}…` : value;
}
</script>

<template>
  <div class="context-tab__analysis">
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
      v-if="toolAnalysisView === 'overview' && timeline.toolTypes.length"
      class="context-tab__tool-overview"
    >
      <div class="context-tab__tool-type-panel">
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
              <span> {{ formatNumber(item.totalTokens) }} · {{ item.percentage.toFixed(1) }}% </span>
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
      <ToolTypeDonut :items="timeline.toolTypes" />
    </div>
    <template v-else-if="toolAnalysisView === 'calls'">
      <div v-if="displayedToolCalls.length" class="context-tab__ranked-tools">
        <button
          v-for="(item, index) in displayedToolCalls"
          :key="item.toolCallId ?? `${item.turn}-${item.toolName}-${index}`"
          type="button"
          class="context-tab__ranked-tool"
          :class="{ 'context-tab__ranked-tool--selected': selectedToolCall === item }"
          :aria-expanded="selectedToolCall === item"
          @click="emit('selectToolCall', item)"
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
          <button type="button" aria-label="Close tool call details" @click="emit('clearToolCall')">
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
            selectedToolCall.toolCallId ? failedResults.has(selectedToolCall.toolCallId) : false
          "
          :rich-enabled="richEnabledFor(selectedContributionToolCall.toolName)"
          @toggle="emit('clearToolCall')"
          @load-full-result="emit('loadFullResult', $event)"
          @retry-full-result="emit('retryFullResult', $event)"
        />
      </div>
      <p v-if="!displayedToolCalls.length" class="context-tab__placeholder">
        No tool calls were captured for this session.
      </p>
      <p v-if="displayedToolCalls.length" class="context-tab__footnote">
        Contribution estimates measure captured arguments and returned results that may become later
        prompt input; they are not per-call cache attribution.
      </p>
    </template>
    <p v-else class="context-tab__placeholder">
      No tool calls were captured for this session.
    </p>
  </div>
</template>

<style scoped>
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

.context-tab__tool-overview {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: stretch;
  gap: 16px;
}

.context-tab__tool-overview :deep(.tool-donut) {
  min-width: 0;
  padding: 12px;
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

.context-tab__bar,
.context-tab__ranked-tool-bar {
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--neutral-subtle);
}

.context-tab__bar {
  height: 5px;
}

.context-tab__bar span,
.context-tab__ranked-tool-bar > span {
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

.context-tab__eyebrow {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
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

.context-tab__placeholder {
  display: grid;
  min-height: 150px;
  padding: 16px;
  place-items: center;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-align: center;
}

.context-tab__footnote {
  margin: 14px 0 0;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  line-height: 1.45;
}

@media (max-width: 900px) {
  .context-tab__tool-overview {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
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
