<script setup lang="ts">
/**
 * ToolDetailPanel — shared detail panel for timeline tool-call selection.
 *
 * Covers the common detail-panel pattern used by TurnWaterfallView and
 * NestedSwimlanesView.  Consumers supply the TurnToolCall and optional
 * extras (badges, child-tool count, full-result state).  Styling is left
 * to the parent component.
 */
import type { TurnToolCall } from '@tracepilot/types';
import Badge from './Badge.vue';
import ToolArgsRenderer from './renderers/ToolArgsRenderer.vue';
import ToolResultRenderer from './renderers/ToolResultRenderer.vue';
import { toolIcon, extractPrompt } from '../utils/toolCall';
import { formatDuration, formatTime } from '../utils/formatters';

const props = defineProps<{
  tc: TurnToolCall;
  /** Full (non-truncated) result if loaded */
  fullResult?: string;
  /** Whether full result is currently loading */
  loadingFullResult?: boolean;
  /** Whether rich rendering is enabled for this tool */
  richEnabled?: boolean;
  /** Number of child/nested tool calls (for subagents) */
  childToolCount?: number;
  /** Extra badges to show (e.g., "parallel") */
  badges?: { label: string; variant: string }[];
}>();

defineEmits<{
  close: [];
  'load-full-result': [toolCallId: string];
}>();
</script>

<template>
  <div class="detail-panel">
    <div class="detail-header">
      <span class="detail-title">
        <span class="detail-icon">{{ toolIcon(tc.toolName) }}</span>
        <strong>{{ tc.agentDisplayName ?? tc.toolName }}</strong>
      </span>
      <div class="detail-badges">
        <Badge v-if="tc.success === false" variant="danger">failed</Badge>
        <Badge v-else-if="tc.success === true" variant="success">ok</Badge>
        <Badge
          v-for="badge in badges"
          :key="badge.label"
          :variant="(badge.variant as any)"
        >{{ badge.label }}</Badge>
        <Badge v-if="tc.isSubagent" variant="neutral">agent</Badge>
      </div>
      <button class="detail-close" @click.stop="$emit('close')" aria-label="Close detail panel">✕</button>
    </div>

    <!-- Metadata grid -->
    <div class="detail-meta">
      <div v-if="tc.model" class="detail-field">
        <span class="detail-label">Model</span>
        <span class="detail-value">{{ tc.model }}</span>
      </div>
      <div class="detail-field">
        <span class="detail-label">Status</span>
        <span class="detail-value">
          {{ tc.success === false ? '✕ Failed' : tc.success === true ? '✓ Success' : '⏳ In Progress' }}
        </span>
      </div>
      <div v-if="tc.durationMs != null" class="detail-field">
        <span class="detail-label">Duration</span>
        <span class="detail-value">{{ formatDuration(tc.durationMs) }}</span>
      </div>
      <div v-if="tc.startedAt" class="detail-field">
        <span class="detail-label">Start</span>
        <span class="detail-value">{{ formatTime(tc.startedAt) }}</span>
      </div>
      <div v-if="tc.completedAt" class="detail-field">
        <span class="detail-label">End</span>
        <span class="detail-value">{{ formatTime(tc.completedAt) }}</span>
      </div>
      <div v-if="tc.mcpServerName" class="detail-field">
        <span class="detail-label">MCP Server</span>
        <span class="detail-value">{{ tc.mcpServerName }}</span>
      </div>
    </div>

    <!-- Subagent info -->
    <div v-if="tc.isSubagent" class="detail-subagent">
      <div v-if="tc.agentDisplayName" class="detail-field">
        <span class="detail-label">Agent</span>
        <span class="detail-value">{{ tc.agentDisplayName }}</span>
      </div>
      <div v-if="tc.agentDescription" class="detail-field">
        <span class="detail-label">Description</span>
        <span class="detail-value">{{ tc.agentDescription }}</span>
      </div>
      <div v-if="childToolCount != null" class="detail-field">
        <span class="detail-label">Child tools</span>
        <span class="detail-value">{{ childToolCount }}</span>
      </div>
    </div>

    <!-- Prompt (subagent only) -->
    <div v-if="tc.isSubagent && extractPrompt(tc.arguments)" class="detail-prompt-section">
      <span class="detail-label">Prompt</span>
      <pre class="detail-prompt">{{ extractPrompt(tc.arguments) }}</pre>
    </div>

    <!-- Intent -->
    <div v-if="tc.intentionSummary" class="detail-field detail-intent">
      <span class="detail-label">Intent</span>
      <span class="detail-value detail-value--italic">{{ tc.intentionSummary }}</span>
    </div>

    <!-- Slot for extra content before args/results -->
    <slot name="before-renderers" />

    <!-- Arguments (rich renderer) -->
    <ToolArgsRenderer :tc="tc" :rich-enabled="richEnabled ?? true" />

    <!-- Result (rich renderer) -->
    <div v-if="tc.resultContent || (tc.toolCallId && fullResult)" class="tool-result-section">
      <ToolResultRenderer
        :tc="tc"
        :content="fullResult ?? tc.resultContent ?? ''"
        :rich-enabled="richEnabled ?? true"
        :is-truncated="!!(tc.toolCallId && tc.resultContent?.includes('…[truncated]') && !fullResult)"
        :loading="loadingFullResult ?? false"
        @load-full="$emit('load-full-result', tc.toolCallId!)"
      />
    </div>

    <!-- Error -->
    <div v-if="tc.error" class="detail-error">
      <span class="detail-error-label">Error</span>
      <pre class="detail-error-body">{{ tc.error }}</pre>
    </div>

    <!-- Slot for extra content after -->
    <slot name="after" />
  </div>
</template>

<style scoped>
.detail-panel {
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 0;
  font-size: 0.8125rem;
  overflow: hidden;
  padding-bottom: 10px;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--canvas-overlay);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
}

.detail-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.detail-badges {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-shrink: 0;
}

.detail-close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  transition: background var(--transition-fast), color var(--transition-fast);
  flex-shrink: 0;
}

.detail-close:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
}

.detail-meta {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px 16px;
  padding: 10px 12px 0;
}

.detail-subagent {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px 16px;
  padding: 8px 12px 0;
  border-top: 1px solid var(--border-muted);
}

.detail-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.detail-value {
  font-size: 0.75rem;
  color: var(--text-primary);
}

.detail-value--italic {
  font-style: italic;
  color: var(--text-secondary);
}

.detail-intent {
  padding: 8px 12px 0;
  border-top: 1px solid var(--border-subtle);
}

.detail-prompt-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px 0;
  border-top: 1px solid var(--border-muted);
}

.detail-prompt {
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
  padding: 8px;
  background: var(--canvas-default);
  border-radius: 6px;
  border: 1px solid var(--border-default);
  margin: 0;
}

.tool-result-section {
  padding: 8px 12px 0;
}

.detail-error {
  margin: 8px 12px 0;
  padding: 6px 8px;
  background: var(--danger-subtle);
  border: 1px solid var(--danger-muted, var(--danger-fg));
  border-radius: var(--radius-sm);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-error-label {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--danger-fg);
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.detail-error-body {
  margin: 0;
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--danger-fg);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
