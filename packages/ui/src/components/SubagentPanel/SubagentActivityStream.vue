<script setup lang="ts">
// Stream body — chronological activity stream with reasoning, tool calls,
// pills, nested-subagent rows, and final agent messages. Pure props/events;
// no app-store imports.
import type { TurnToolCall } from "@tracepilot/types";
import { getToolArgs, toolArgString } from "@tracepilot/types";
import { ref, watch } from "vue";
import { useToggleSet } from "../../composables/useToggleSet";
import {
  agentStatusFromToolCall,
  getAgentColor,
  getAgentIcon,
  inferAgentTypeFromToolCall,
} from "../../utils/agentTypes";
import { formatDuration } from "../../utils/formatters";
import MarkdownContent from "../MarkdownContent.vue";
import ToolCallItem from "../ToolCallItem.vue";
import type { SubagentActivityItem, SubagentActivityPillType } from "./types";

const props = defineProps<{
  activities: SubagentActivityItem[];
  /** Stable key for the owning subagent — resets local expansion state on change. */
  agentKey: string;
  renderMarkdown: boolean;
  fullResults: Map<string, string>;
  loadingResults: Set<string>;
  failedResults: Set<string>;
  /** When true, render rich content for the given tool name. Defaults to true. */
  isRichRenderingEnabled?: (toolName: string) => boolean;
}>();

const emit = defineEmits<{
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
  "select-subagent": [toolCallId: string];
}>();

const expandedReasoning = ref<Set<string>>(new Set());
const expandedToolDetails = useToggleSet<string>();

watch(
  () => props.agentKey,
  () => {
    expandedReasoning.value = new Set();
    expandedToolDetails.clear();
  },
);

function toggleReasoning(key: string) {
  const next = new Set(expandedReasoning.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedReasoning.value = next;
}

function reasoningPreview(content: string): string {
  const first = content.split("\n")[0] ?? "";
  return first.length > 80 ? `${first.slice(0, 80)}…` : first;
}

function pillIcon(type: SubagentActivityPillType): string {
  if (type === "intent") return "📋";
  if (type === "memory") return "💾";
  return "⏳";
}

function nestedSubagentDesc(tc: TurnToolCall): string {
  return tc.intentionSummary || toolArgString(getToolArgs(tc), "description");
}

function nestedStatusClass(tc: TurnToolCall): string {
  const s = agentStatusFromToolCall(tc);
  return s;
}

function richEnabled(toolName: string): boolean {
  return props.isRichRenderingEnabled ? props.isRichRenderingEnabled(toolName) : true;
}
</script>

<template>
  <div v-if="activities.length > 0" class="sap-section">
    <div class="sap-divider">
      <span class="sap-divider-label">Activity ({{ activities.length }})</span>
    </div>

    <div class="sap-activities">
      <template v-for="item in activities" :key="item.key">
        <div v-if="item.kind === 'reasoning'" class="sap-reasoning">
          <button
            class="sap-reasoning-toggle"
            :aria-expanded="expandedReasoning.has(item.key)"
            aria-label="Toggle reasoning block"
            @click="toggleReasoning(item.key)"
          >
            <span :class="['sap-chevron', { open: expandedReasoning.has(item.key) }]">▸</span>
            <span class="sap-reasoning-icon">💭</span>
            <span class="sap-reasoning-label">Thinking…</span>
            <span
              v-if="!expandedReasoning.has(item.key)"
              class="sap-reasoning-preview"
            >{{ reasoningPreview(item.content) }}</span>
          </button>
          <div
            v-if="expandedReasoning.has(item.key)"
            class="sap-reasoning-content"
          >{{ item.content }}</div>
        </div>

        <div
          v-else-if="item.kind === 'pill'"
          :class="['sap-pill', `sap-pill--${item.type}`]"
        >
          <span class="sap-pill-icon">{{ pillIcon(item.type) }}</span>
          <span class="sap-pill-label">{{ item.label }}</span>
          <span v-if="item.toolCall.isComplete" class="sap-pill-check">✓</span>
        </div>

        <ToolCallItem
          v-else-if="item.kind === 'tool'"
          :tc="item.toolCall"
          variant="compact"
          :expanded="expandedToolDetails.has(item.key)"
          :full-result="item.toolCall.toolCallId ? fullResults.get(item.toolCall.toolCallId) : undefined"
          :loading-full-result="item.toolCall.toolCallId ? loadingResults.has(item.toolCall.toolCallId) : false"
          :failed-full-result="item.toolCall.toolCallId ? failedResults.has(item.toolCall.toolCallId) : false"
          :rich-enabled="richEnabled(item.toolCall.toolName)"
          @toggle="expandedToolDetails.toggle(item.key)"
          @load-full-result="emit('load-full-result', $event)"
          @retry-full-result="emit('retry-full-result', $event)"
        />

        <button
          v-else-if="item.kind === 'nested-subagent'"
          type="button"
          class="sap-nested-subagent"
          @click="item.toolCall.toolCallId && emit('select-subagent', item.toolCall.toolCallId)"
        >
          <div
            class="sap-nested-header"
            :style="{ borderLeftColor: getAgentColor(inferAgentTypeFromToolCall(item.toolCall)) }"
          >
            <span class="sap-nested-icon">{{ getAgentIcon(inferAgentTypeFromToolCall(item.toolCall)) }}</span>
            <span class="sap-nested-name">{{ item.toolCall.agentDisplayName || item.toolCall.toolName }}</span>
            <span v-if="item.toolCall.durationMs" class="sap-nested-meta">{{ formatDuration(item.toolCall.durationMs) }}</span>
            <span :class="['sap-nested-status', nestedStatusClass(item.toolCall)]">
              {{ item.toolCall.success === false ? '✗' : item.toolCall.isComplete ? '✓' : '…' }}
            </span>
          </div>
          <div v-if="nestedSubagentDesc(item.toolCall)" class="sap-nested-desc">
            {{ nestedSubagentDesc(item.toolCall) }}
          </div>
        </button>

        <div v-else-if="item.kind === 'message'" class="sap-message">
          <MarkdownContent :content="item.content" :render="renderMarkdown" />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sap-section { margin: 0; }
.sap-divider { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.sap-divider::after { content: ""; flex: 1; height: 1px; background: var(--border-muted); }
.sap-divider-label { font-size: 0.6875rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
.sap-activities { display: flex; flex-direction: column; gap: 4px; }
.sap-chevron { display: inline-block; font-size: 10px; transition: transform var(--transition-fast); }
.sap-chevron.open { transform: rotate(90deg); }
.sap-reasoning { border-radius: var(--radius-sm); border: 1px solid var(--border-muted); background: var(--canvas-inset); overflow: hidden; }
.sap-reasoning-toggle { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; border: none; background: transparent; cursor: pointer; text-align: left; font-size: 0.75rem; color: var(--text-secondary); transition: background var(--transition-fast); }
.sap-reasoning-toggle:hover { background: var(--neutral-subtle); }
.sap-reasoning-icon { font-size: 13px; flex-shrink: 0; }
.sap-reasoning-label { font-weight: 500; color: var(--text-secondary); flex-shrink: 0; }
.sap-reasoning-preview { flex: 1; color: var(--text-placeholder); font-size: 0.6875rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-style: italic; }
.sap-reasoning-content { padding: 8px 12px; font-size: 0.75rem; color: var(--text-secondary); line-height: 1.55; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; border-top: 1px solid var(--border-muted); }
.sap-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: var(--radius-full); font-size: 0.6875rem; font-weight: 500; max-width: 100%; }
.sap-pill-icon { font-size: 12px; flex-shrink: 0; }
.sap-pill-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.sap-pill-check { font-size: 10px; flex-shrink: 0; opacity: 0.7; }
.sap-pill--intent { color: var(--accent-fg); background: var(--accent-subtle); }
.sap-pill--memory { color: var(--done-fg); background: var(--done-subtle); }
.sap-pill--read_agent { color: var(--success-fg); background: var(--success-subtle); }
.sap-message { padding: 10px 12px; background: var(--canvas-inset); border-radius: var(--radius-md); border: 1px solid var(--border-muted); font-size: 0.8125rem; color: var(--text-primary); line-height: 1.55; }
.sap-message :deep(.markdown-content) { font-size: inherit; line-height: inherit; }
.sap-nested-subagent { display: block; width: 100%; text-align: left; border: none; padding: 0; cursor: pointer; border-radius: var(--radius-md, 8px); background: var(--canvas-inset, #010409); overflow: hidden; margin: 2px 0; transition: background var(--transition-fast); }
.sap-nested-subagent:hover { background: var(--neutral-subtle); }
.sap-nested-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-left: 3px solid var(--accent-fg); font-size: 0.75rem; font-weight: 600; color: var(--text-primary); }
.sap-nested-icon { font-size: 14px; flex-shrink: 0; }
.sap-nested-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sap-nested-meta { color: var(--text-tertiary); font-weight: 400; font-size: 0.6875rem; flex-shrink: 0; }
.sap-nested-status { flex-shrink: 0; font-weight: 600; font-size: 0.6875rem; }
.sap-nested-status.completed { color: var(--success-fg, #3fb950); }
.sap-nested-status.failed { color: var(--danger-fg, #f85149); }
.sap-nested-status.in-progress { color: var(--warning-fg, #d29922); }
.sap-nested-desc { padding: 4px 12px 8px 15px; font-size: 0.6875rem; color: var(--text-secondary); line-height: 1.4; }
</style>
