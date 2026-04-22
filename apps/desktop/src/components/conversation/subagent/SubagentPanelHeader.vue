<script setup lang="ts">
import { formatNumber } from "@tracepilot/ui";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";

defineProps<{
  subagent: SubagentFullData;
  agentColor: string;
  agentIcon: string;
  agentLabel: string;
  model: string;
  headerDuration: string;
  status: "completed" | "failed" | "in-progress";
  statusText: string;
}>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <div class="cv-panel-header" :style="{ '--agent-color': agentColor }">
    <button
      class="cv-panel-close"
      aria-label="Close panel"
      title="Close (Esc)"
      @click="emit('close')"
    >
      ✕
    </button>
    <div class="cv-panel-info">
      <div class="cv-panel-name" :style="{ color: agentColor }">
        <span class="cv-panel-name-icon">{{ agentIcon }}</span>
        <span>{{ agentLabel }}</span>
      </div>
      <div class="cv-panel-meta">
        <span v-if="model" class="cv-panel-model">{{ model }}</span>
        <span v-if="model" class="sep">·</span>
        <span v-if="headerDuration">{{ headerDuration }}</span>
        <span class="sep">·</span>
        <span>Turn {{ subagent.turnIndex }}</span>
        <template v-if="subagent.toolCall.totalTokens">
          <span class="sep">·</span>
          <span title="Total tokens consumed">{{ formatNumber(subagent.toolCall.totalTokens) }} tok</span>
        </template>
        <template v-if="subagent.toolCall.totalToolCalls">
          <span class="sep">·</span>
          <span title="Total tool calls made">{{ subagent.toolCall.totalToolCalls }} tools</span>
        </template>
      </div>
    </div>
    <span :class="['cv-panel-status', status]">{{ statusText }}</span>
  </div>
</template>

<style scoped>
.cv-panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
  background: var(--canvas-inset);
  flex-shrink: 0;
}

.cv-panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.cv-panel-close:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.cv-panel-info {
  flex: 1;
  min-width: 0;
}

.cv-panel-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.3;
}

.cv-panel-name-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.cv-panel-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.cv-panel-meta .sep {
  color: var(--text-placeholder);
  user-select: none;
}

.cv-panel-model {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.625rem;
  padding: 1px 5px;
  background: var(--neutral-subtle);
  border-radius: var(--radius-full);
  color: var(--text-secondary);
}

.cv-panel-status {
  flex-shrink: 0;
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.cv-panel-status.completed {
  color: var(--success-fg);
  background: var(--success-subtle);
}

.cv-panel-status.failed {
  color: var(--danger-fg);
  background: var(--danger-subtle);
}

.cv-panel-status.in-progress {
  color: var(--warning-fg);
  background: var(--warning-subtle);
}
</style>
