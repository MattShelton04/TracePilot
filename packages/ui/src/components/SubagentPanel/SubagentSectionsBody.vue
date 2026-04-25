<script setup lang="ts">
// Sections body — agent-tree style sectioned layout (Description, Source row,
// Prompt, Info grid, Failure, Output, Result, Reasoning toggle, Tool list).
// Pure props/events — no app-store imports.
import type { TurnToolCall } from "@tracepilot/types";
import { computed } from "vue";
import { useToggleSet } from "../../composables/useToggleSet";
import { STATUS_ICONS } from "../../utils/agentTypes";
import {
  formatDuration,
  formatLiveDuration,
  formatNumber,
  formatTime,
  truncateText,
} from "../../utils/formatters";
import { formatArgsSummary, toolIcon } from "../../utils/toolCall";
import Badge from "../Badge.vue";
import EmptyState from "../EmptyState.vue";
import ExpandChevron from "../ExpandChevron.vue";
import MarkdownContent from "../MarkdownContent.vue";
import ToolArgsRenderer from "../renderers/ToolArgsRenderer.vue";
import ToolResultRenderer from "../renderers/ToolResultRenderer.vue";
import type { SubagentView } from "./types";

const props = defineProps<{
  view: SubagentView;
  /** Live duration ms for in-progress nodes (host computes; falls back to view.durationMs). */
  liveDurationMs?: number;
  renderMarkdown: boolean;
  isRichRenderingEnabled?: (toolName: string) => boolean;
  fullResults: Map<string, string>;
  loadingResults: Set<string>;
  failedResults: Set<string>;
}>();

const emit = defineEmits<{
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
  "select-subagent": [toolCallId: string];
}>();

const expandedToolCalls = useToggleSet<string>();
const reasoningExpanded = useToggleSet<string>();
const outputExpanded = useToggleSet<string>();

function richEnabled(toolName: string): boolean {
  return props.isRichRenderingEnabled ? props.isRichRenderingEnabled(toolName) : true;
}

const trimmedMessages = computed(() => props.view.messages.filter((m) => m.trim()));
const messagesText = computed(() => trimmedMessages.value.join(""));
const isOutputLong = computed(() => messagesText.value.length > 500);

const headerTools = computed(() => (props.view.isMainAgent ? "Tools & Agents" : "Tool Calls"));

const liveDur = computed(() => props.liveDurationMs ?? props.view.durationMs);

function isResultLoaded(tc: TurnToolCall): boolean {
  return !!(tc.toolCallId && props.fullResults.has(tc.toolCallId));
}

function resultContentOf(tc: TurnToolCall): string {
  if (tc.toolCallId && props.fullResults.has(tc.toolCallId)) {
    return props.fullResults.get(tc.toolCallId) ?? "";
  }
  return tc.resultContent ?? "";
}

function isResultTruncated(tc: TurnToolCall): boolean {
  if (!tc.toolCallId) return false;
  return !!tc.resultContent?.includes("…[truncated]") && !props.fullResults.has(tc.toolCallId);
}

function isResultLoading(tc: TurnToolCall): boolean {
  return !!(tc.toolCallId && props.loadingResults.has(tc.toolCallId));
}

function onToolClick(tc: TurnToolCall, idx: number) {
  if (tc.isSubagent && tc.toolCallId) {
    emit("select-subagent", tc.toolCallId);
    return;
  }
  expandedToolCalls.toggle(tc.toolCallId ?? `tc-${idx}`);
}
</script>

<template>
  <div class="sap-sections">
    <!-- Description -->
    <div v-if="view.description" class="sap-info-row">
      <span class="sap-label">Description</span>
      <span class="sap-value">{{ view.description }}</span>
    </div>

    <!-- Cross-turn source -->
    <div v-if="view.isCrossTurnParent && view.sourceTurnIndex != null" class="sap-info-row">
      <span class="sap-label">Source</span>
      <span class="sap-value sap-italic">Launched in turn {{ view.sourceTurnIndex }}</span>
    </div>

    <!-- Prompt -->
    <div v-if="view.prompt" class="sap-section">
      <h4 class="sap-section-title">Prompt</h4>
      <MarkdownContent :content="view.prompt" :render="renderMarkdown" max-height="200px" />
    </div>

    <!-- Info grid -->
    <div class="sap-info-grid">
      <div class="sap-info-item">
        <span class="sap-label">Status</span>
        <Badge
          :variant="view.status === 'completed' ? 'success' : view.status === 'failed' ? 'danger' : 'warning'"
        >
          {{ STATUS_ICONS[view.status] }} {{ view.status }}
        </Badge>
      </div>
      <div class="sap-info-item">
        <span class="sap-label">Duration</span>
        <span class="sap-value">{{ formatLiveDuration(liveDur ?? 0) || "—" }}</span>
      </div>
      <div class="sap-info-item">
        <span class="sap-label">Tools</span>
        <span class="sap-value">{{ view.toolCount }}</span>
      </div>
      <div v-if="view.model" class="sap-info-item">
        <span class="sap-label">Model</span>
        <Badge variant="done">{{ view.model }}</Badge>
        <span v-if="view.modelSubstituted" class="sap-model-warn"
          :title="`Requested ${view.requestedModel} but a different model ran`"
        >⚠ substituted</span>
      </div>
      <div v-if="view.totalTokens" class="sap-info-item">
        <span class="sap-label">Tokens</span>
        <span class="sap-value">{{ formatNumber(view.totalTokens) }}</span>
      </div>
    </div>

    <!-- Failure -->
    <div v-if="view.status === 'failed' && view.error" class="sap-section sap-failure detail-failure">
      <h4 class="sap-section-title sap-failure-title">❌ Failure Reason</h4>
      <pre class="sap-failure-body detail-failure-body">{{ view.error }}</pre>
    </div>

    <!-- Output (assistant messages) -->
    <div v-if="trimmedMessages.length > 0" class="sap-section">
      <h4 class="sap-section-title">Output</h4>
      <div
        class="sap-output detail-output"
        :class="{
          'sap-output--collapsed detail-output--collapsed': isOutputLong && !outputExpanded.has(view.id),
          'sap-output--expanded detail-output--expanded': outputExpanded.has(view.id),
        }"
      >
        <MarkdownContent
          v-for="(msg, idx) in trimmedMessages"
          :key="`output-msg-${idx}`"
          class="sap-output-message"
          :content="msg"
          :render="renderMarkdown"
        />
      </div>
      <button v-if="isOutputLong" class="sap-output-toggle output-toggle" @click="outputExpanded.toggle(view.id)">
        {{ outputExpanded.has(view.id) ? "▲ Show less" : "▼ Show more" }}
      </button>
    </div>

    <!-- Result (parent tool result; not shown for main-agent views) -->
    <div
      v-if="!view.isMainAgent && view.toolCallRef && (view.toolCallRef.resultContent || isResultLoaded(view.toolCallRef))"
      class="sap-section"
    >
      <h4 class="sap-section-title">Result</h4>
      <div class="sap-output">
        <ToolResultRenderer
          :tc="view.toolCallRef"
          :content="resultContentOf(view.toolCallRef)"
          :rich-enabled="richEnabled(view.toolCallRef.toolName)"
          :is-truncated="isResultTruncated(view.toolCallRef)"
          :loading="isResultLoading(view.toolCallRef)"
          @load-full="view.toolCallRef!.toolCallId && emit('load-full-result', view.toolCallRef!.toolCallId)"
        />
      </div>
    </div>

    <!-- Reasoning -->
    <div v-if="view.reasoning.length > 0" class="sap-section">
      <button
        class="sap-reasoning-toggle reasoning-toggle"
        :aria-expanded="reasoningExpanded.has(view.id)"
        @click="reasoningExpanded.toggle(view.id)"
      >
        <ExpandChevron :expanded="reasoningExpanded.has(view.id)" />
        💭 {{ view.reasoning.length }} reasoning block{{ view.reasoning.length !== 1 ? "s" : "" }}
      </button>
      <div v-if="reasoningExpanded.has(view.id)" class="sap-reasoning-content reasoning-content" tabindex="0">
        <template v-for="(text, rIdx) in view.reasoning" :key="`reasoning-${rIdx}`">
          <hr v-if="rIdx > 0" class="sap-reasoning-divider" />
          <MarkdownContent :content="text" :render="renderMarkdown" />
        </template>
      </div>
    </div>

    <!-- Tools -->
    <div class="sap-tools">
      <h4 class="sap-tools-heading">
        {{ headerTools }} <span class="sap-tools-count">({{ view.childTools.length }})</span>
      </h4>

      <EmptyState v-if="view.childTools.length === 0" message="No tool calls recorded." />

      <div v-else class="sap-tools-list">
        <div
          v-for="(tc, idx) in view.childTools"
          :key="tc.toolCallId ?? idx"
          class="sap-tool-row detail-tool-row"
        >
          <button
            type="button"
            class="sap-tool-btn"
            :aria-expanded="expandedToolCalls.has(tc.toolCallId ?? `tc-${idx}`)"
            @click="onToolClick(tc, idx)"
          >
            <span class="sap-tool-idx">{{ idx + 1 }}.</span>
            <span class="sap-tool-icon">{{ toolIcon(tc.toolName) }}</span>
            <span class="sap-tool-name">
              {{ tc.isSubagent && tc.agentDisplayName ? tc.agentDisplayName : tc.toolName }}
            </span>
            <Badge v-if="tc.isSubagent" variant="neutral" class="sap-agent-badge detail-agent-badge">agent</Badge>
            <span v-if="tc.intentionSummary" class="sap-tool-intent" :title="tc.intentionSummary">
              {{ truncateText(tc.intentionSummary, 60) }}
            </span>
            <span
              v-else-if="formatArgsSummary(tc.arguments, tc.toolName)"
              class="sap-tool-args"
              :title="formatArgsSummary(tc.arguments, tc.toolName)"
            >
              ({{ truncateText(formatArgsSummary(tc.arguments, tc.toolName), 60) }})
            </span>
            <span class="sap-tool-right">
              <span v-if="tc.durationMs != null" class="sap-tool-dur">{{ formatDuration(tc.durationMs) }}</span>
              <span v-if="tc.success === true" class="sap-tool-status success">✓</span>
              <span v-else-if="tc.success === false" class="sap-tool-status failed">✗</span>
              <span v-else class="sap-tool-status pending">○</span>
            </span>
          </button>

          <div
            v-if="!tc.isSubagent && expandedToolCalls.has(tc.toolCallId ?? `tc-${idx}`)"
            class="sap-tool-expanded"
          >
            <div v-if="tc.error" class="sap-tool-error">
              <div class="sap-tool-error-label">Error</div>
              <pre class="sap-tool-error-body">{{ tc.error }}</pre>
            </div>
            <div class="sap-tool-meta">
              <div v-if="tc.startedAt" class="sap-meta-item"><span class="sap-label">Started</span><span class="sap-value">{{ formatTime(tc.startedAt) }}</span></div>
              <div v-if="tc.completedAt" class="sap-meta-item"><span class="sap-label">Completed</span><span class="sap-value">{{ formatTime(tc.completedAt) }}</span></div>
              <div v-if="tc.durationMs != null" class="sap-meta-item"><span class="sap-label">Duration</span><span class="sap-value">{{ formatDuration(tc.durationMs) }}</span></div>
              <div v-if="tc.toolCallId" class="sap-meta-item"><span class="sap-label">Call ID</span><span class="sap-value sap-mono">{{ tc.toolCallId }}</span></div>
            </div>
            <ToolArgsRenderer :tc="tc" :rich-enabled="richEnabled(tc.toolName)" />
            <div
              v-if="tc.resultContent || isResultLoaded(tc)"
              class="sap-tool-result"
            >
              <ToolResultRenderer
                :tc="tc"
                :content="resultContentOf(tc)"
                :rich-enabled="richEnabled(tc.toolName)"
                :is-truncated="isResultTruncated(tc)"
                :loading="isResultLoading(tc)"
                @load-full="tc.toolCallId && emit('load-full-result', tc.toolCallId)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sap-sections { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; }
.sap-label { font-size: 0.6875rem; font-weight: 500; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
.sap-value { font-size: 0.8125rem; color: var(--text-primary); }
.sap-italic { font-style: italic; color: var(--text-secondary); }
.sap-mono { font-family: "JetBrains Mono", monospace; font-size: 0.75rem; }
.sap-info-row { display: flex; gap: 8px; align-items: baseline; }
.sap-section { padding: 0; }
.sap-section-title { font-size: 0.6875rem; font-weight: 600; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 6px; }
.sap-info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; padding: 10px 0; border-top: 1px solid var(--border-muted); border-bottom: 1px solid var(--border-muted); }
.sap-info-item { display: flex; flex-direction: column; gap: 4px; }
.sap-info-item .sap-model-warn { font-size: 0.6875rem; color: var(--warning-fg); }

.sap-failure { background: var(--danger-subtle); border: 1px solid color-mix(in srgb, var(--danger-fg) 30%, transparent); border-radius: var(--radius-md); padding: 10px 12px; }
.sap-failure-title { color: var(--danger-fg); }
.sap-failure-body { font-family: "JetBrains Mono", monospace; font-size: 0.75rem; color: var(--danger-fg); white-space: pre-wrap; word-break: break-word; margin: 0; }

.sap-output { font-size: 0.8125rem; color: var(--text-primary); line-height: 1.55; }
.sap-output--collapsed { max-height: 200px; overflow: hidden; mask-image: linear-gradient(to bottom, black 70%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%); }
.sap-output--expanded { max-height: none; }
.sap-output-message { padding: 6px 0; border-bottom: 1px dashed var(--border-muted); }
.sap-output-message:last-child { border-bottom: none; }
.sap-output-toggle { margin-top: 6px; background: transparent; border: none; color: var(--accent-fg); font-size: 0.75rem; cursor: pointer; padding: 2px 0; }
.sap-output-toggle:hover { text-decoration: underline; }

.sap-reasoning-toggle { display: inline-flex; align-items: center; gap: 6px; background: transparent; border: none; color: var(--text-secondary); font-size: 0.8125rem; cursor: pointer; padding: 4px 0; }
.sap-reasoning-toggle:hover { color: var(--text-primary); }
.sap-reasoning-content { padding: 8px 12px; background: var(--canvas-inset); border-radius: var(--radius-md); border: 1px solid var(--border-muted); font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.55; }
.sap-reasoning-divider { border: none; border-top: 1px dashed var(--border-muted); margin: 10px 0; }

.sap-tools { padding: 0; }
.sap-tools-heading { font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; margin: 0 0 8px; display: flex; align-items: center; gap: 6px; }
.sap-tools-count { color: var(--text-tertiary); font-weight: 400; }
.sap-tools-list { display: flex; flex-direction: column; gap: 4px; }
.sap-tool-row { border: 1px solid var(--border-muted); border-radius: var(--radius-md); overflow: hidden; }
.sap-tool-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px; border: none; background: transparent; cursor: pointer; text-align: left; font-size: 0.8125rem; color: var(--text-primary); }
.sap-tool-btn:hover { background: var(--neutral-subtle); }
.sap-tool-idx { color: var(--text-tertiary); font-variant-numeric: tabular-nums; flex-shrink: 0; }
.sap-tool-icon { font-size: 14px; flex-shrink: 0; }
.sap-tool-name { font-weight: 500; flex-shrink: 0; }
.sap-tool-intent { color: var(--text-secondary); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.sap-tool-args { color: var(--text-tertiary); font-family: "JetBrains Mono", monospace; font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.sap-tool-right { margin-left: auto; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.sap-tool-dur { font-size: 0.6875rem; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
.sap-tool-status { font-weight: 600; font-size: 0.75rem; }
.sap-tool-status.success { color: var(--success-fg); }
.sap-tool-status.failed { color: var(--danger-fg); }
.sap-tool-status.pending { color: var(--text-tertiary); }
.sap-tool-expanded { padding: 10px 12px; border-top: 1px solid var(--border-muted); background: var(--canvas-inset); display: flex; flex-direction: column; gap: 10px; }
.sap-tool-error { background: var(--danger-subtle); border-radius: var(--radius-sm); padding: 8px 10px; }
.sap-tool-error-label { font-size: 0.6875rem; font-weight: 600; color: var(--danger-fg); text-transform: uppercase; margin-bottom: 4px; }
.sap-tool-error-body { font-family: "JetBrains Mono", monospace; font-size: 0.75rem; color: var(--danger-fg); white-space: pre-wrap; word-break: break-word; margin: 0; }
.sap-tool-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; padding: 4px 0; }
.sap-meta-item { display: flex; flex-direction: column; gap: 2px; }
.sap-tool-result { padding-top: 6px; border-top: 1px dashed var(--border-muted); }
.sap-agent-badge { flex-shrink: 0; }
</style>
