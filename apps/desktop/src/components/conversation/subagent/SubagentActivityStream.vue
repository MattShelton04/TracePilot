<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { getToolArgs, toolArgString } from "@tracepilot/types";
import {
  formatDuration,
  getAgentColor,
  getAgentIcon,
  inferAgentTypeFromToolCall,
  MarkdownContent,
  ToolCallItem,
  useToggleSet,
} from "@tracepilot/ui";
import { ref, watch } from "vue";
import type { ActivityItem, ActivityPillType } from "@/composables/useSubagentActivities";
import { usePreferencesStore } from "@/stores/preferences";

const props = defineProps<{
  activities: ActivityItem[];
  /** Unique key for the owning subagent — resets expansion state on change. */
  agentKey: string;
  renderMarkdown: boolean;
  fullResults: Map<string, string>;
  loadingResults: Set<string>;
  failedResults: Set<string>;
}>();

const emit = defineEmits<{
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
}>();

const preferences = usePreferencesStore();

const expandedReasoning = ref<Set<number>>(new Set());
const expandedToolDetails = useToggleSet<string>();

watch(
  () => props.agentKey,
  () => {
    expandedReasoning.value = new Set();
    expandedToolDetails.clear();
  },
);

function toggleReasoning(index: number) {
  const next = new Set(expandedReasoning.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  expandedReasoning.value = next;
}

function reasoningPreview(content: string): string {
  const first = content.split("\n")[0] ?? "";
  return first.length > 80 ? `${first.slice(0, 80)}…` : first;
}

function toggleToolDetail(_tc: TurnToolCall, index: number) {
  expandedToolDetails.toggle(`panel-${props.agentKey}-${index}`);
}

function isToolExpanded(_tc: TurnToolCall, index: number): boolean {
  return expandedToolDetails.has(`panel-${props.agentKey}-${index}`);
}

function pillIcon(type: ActivityPillType): string {
  if (type === "intent") return "📋";
  if (type === "memory") return "💾";
  return "⏳";
}

/** Get description text for a nested-subagent item in the activity stream. */
function nestedSubagentDesc(tc: TurnToolCall): string {
  return tc.intentionSummary || toolArgString(getToolArgs(tc), "description");
}
</script>

<template>
  <div v-if="activities.length > 0" class="cv-panel-section">
    <div class="cv-panel-divider">
      <span class="cv-panel-divider-label">Activity ({{ activities.length }})</span>
    </div>

    <div class="cv-panel-activities">
      <template v-for="item in activities" :key="item.index">
        <!-- Reasoning block -->
        <div v-if="item.kind === 'reasoning'" class="cv-panel-reasoning">
          <button
            class="cv-panel-reasoning-toggle"
            :aria-expanded="expandedReasoning.has(item.index)"
            aria-label="Toggle reasoning block"
            @click="toggleReasoning(item.index)"
          >
            <span :class="['cv-panel-chevron', { open: expandedReasoning.has(item.index) }]">▸</span>
            <span class="cv-panel-reasoning-icon">💭</span>
            <span class="cv-panel-reasoning-label">Thinking…</span>
            <span
              v-if="!expandedReasoning.has(item.index)"
              class="cv-panel-reasoning-preview"
            >{{ reasoningPreview(item.content) }}</span>
          </button>
          <div
            v-if="expandedReasoning.has(item.index)"
            class="cv-panel-reasoning-content"
          >{{ item.content }}</div>
        </div>

        <!-- Special tool pills -->
        <div
          v-else-if="item.kind === 'pill'"
          :class="['cv-panel-pill', `cv-panel-pill--${item.type}`]"
        >
          <span class="cv-panel-pill-icon">{{ pillIcon(item.type) }}</span>
          <span class="cv-panel-pill-label">{{ item.label }}</span>
          <span
            v-if="item.toolCall.isComplete"
            class="cv-panel-pill-check"
          >✓</span>
        </div>

        <!-- Regular tool call -->
        <ToolCallItem
          v-else-if="item.kind === 'tool'"
          :tc="item.toolCall"
          variant="compact"
          :expanded="isToolExpanded(item.toolCall, item.index)"
          :full-result="item.toolCall.toolCallId ? fullResults.get(item.toolCall.toolCallId) : undefined"
          :loading-full-result="item.toolCall.toolCallId ? loadingResults.has(item.toolCall.toolCallId) : false"
          :failed-full-result="item.toolCall.toolCallId ? failedResults.has(item.toolCall.toolCallId) : false"
          :rich-enabled="preferences.isRichRenderingEnabled(item.toolCall.toolName)"
          @toggle="toggleToolDetail(item.toolCall, item.index)"
          @load-full-result="emit('load-full-result', $event)"
          @retry-full-result="emit('retry-full-result', $event)"
        />

        <!-- Nested subagent -->
        <div
          v-else-if="item.kind === 'nested-subagent'"
          class="cv-panel-nested-subagent"
        >
          <div class="cv-panel-nested-header" :style="{ borderLeftColor: getAgentColor(inferAgentTypeFromToolCall(item.toolCall)) }">
            <span class="cv-panel-nested-icon">{{ getAgentIcon(inferAgentTypeFromToolCall(item.toolCall)) }}</span>
            <span class="cv-panel-nested-name">{{ item.toolCall.agentDisplayName || item.toolCall.toolName }}</span>
            <span v-if="item.toolCall.durationMs" class="cv-panel-nested-meta">{{ formatDuration(item.toolCall.durationMs) }}</span>
            <span :class="['cv-panel-nested-status', item.toolCall.success === false ? 'failed' : item.toolCall.isComplete ? 'completed' : 'running']">
              {{ item.toolCall.success === false ? '✗' : item.toolCall.isComplete ? '✓' : '…' }}
            </span>
          </div>
          <div v-if="nestedSubagentDesc(item.toolCall)" class="cv-panel-nested-desc">
            {{ nestedSubagentDesc(item.toolCall) }}
          </div>
        </div>

        <!-- Agent message (rendered markdown) -->
        <div v-else-if="item.kind === 'message'" class="cv-panel-message">
          <MarkdownContent :content="item.content" :render="renderMarkdown" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* ── Sections ─────────────────────────────────────────────────── */

.cv-panel-section {
  margin-bottom: 16px;
}

/* ── Activity divider ─────────────────────────────────────────── */

.cv-panel-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.cv-panel-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--border-muted);
}

.cv-panel-divider-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* ── Activity stream ──────────────────────────────────────────── */

.cv-panel-activities {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Chevron (shared) ─────────────────────────────────────────── */

.cv-panel-chevron {
  display: inline-block;
  font-size: 10px;
  transition: transform var(--transition-fast);
}

.cv-panel-chevron.open {
  transform: rotate(90deg);
}

/* ── Reasoning block ──────────────────────────────────────────── */

.cv-panel-reasoning {
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-muted);
  background: var(--canvas-inset);
  overflow: hidden;
}

.cv-panel-reasoning-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 0.75rem;
  color: var(--text-secondary);
  transition: background var(--transition-fast);
}

.cv-panel-reasoning-toggle:hover {
  background: var(--neutral-subtle);
}

.cv-panel-reasoning-icon {
  font-size: 13px;
  flex-shrink: 0;
}

.cv-panel-reasoning-label {
  font-weight: 500;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.cv-panel-reasoning-preview {
  flex: 1;
  color: var(--text-placeholder);
  font-size: 0.6875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-style: italic;
}

.cv-panel-reasoning-content {
  padding: 8px 12px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  border-top: 1px solid var(--border-muted);
}

/* ── Special pills (intent / memory / read_agent) ─────────────── */

.cv-panel-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: 0.6875rem;
  font-weight: 500;
  max-width: 100%;
}

.cv-panel-pill-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.cv-panel-pill-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.cv-panel-pill-check {
  font-size: 10px;
  flex-shrink: 0;
  opacity: 0.7;
}

.cv-panel-pill--intent {
  color: var(--accent-fg);
  background: var(--accent-subtle);
}

.cv-panel-pill--memory {
  color: var(--done-fg);
  background: var(--done-subtle);
}

.cv-panel-pill--read_agent {
  color: var(--success-fg);
  background: var(--success-subtle);
}

/* ── Agent message bubble ─────────────────────────────────────── */

.cv-panel-message {
  padding: 10px 12px;
  background: var(--canvas-inset);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-muted);
  font-size: 0.8125rem;
  color: var(--text-primary);
  line-height: 1.55;
}

.cv-panel-message :deep(.markdown-content) {
  font-size: inherit;
  line-height: inherit;
}

/* ── Nested subagent ─────────────────────────────────────────── */

.cv-panel-nested-subagent {
  border-radius: var(--radius-md, 8px);
  background: var(--canvas-inset, #010409);
  overflow: hidden;
  margin: 2px 0;
}

.cv-panel-nested-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-left: 3px solid var(--accent-fg);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
}

.cv-panel-nested-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.cv-panel-nested-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-panel-nested-meta {
  color: var(--text-tertiary);
  font-weight: 400;
  font-size: 0.6875rem;
  flex-shrink: 0;
}

.cv-panel-nested-status {
  flex-shrink: 0;
  font-weight: 600;
  font-size: 0.6875rem;
}
.cv-panel-nested-status.completed {
  color: var(--success-fg, #3fb950);
}
.cv-panel-nested-status.failed {
  color: var(--danger-fg, #f85149);
}
.cv-panel-nested-status.running {
  color: var(--warning-fg, #d29922);
}

.cv-panel-nested-desc {
  padding: 4px 12px 8px 15px;
  font-size: 0.6875rem;
  color: var(--text-secondary);
  line-height: 1.4;
}
</style>
