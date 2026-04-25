<script setup lang="ts">
import { formatNumber } from "../../utils/formatters";
import type { SubagentStatus, SubagentView } from "./types";

defineProps<{
  view: SubagentView;
  agentColor: string;
  agentIcon: string;
  headerDuration: string;
  statusText: string;
}>();

const emit = defineEmits<{ close: [] }>();

function statusClass(s: SubagentStatus): string {
  return s;
}
</script>

<template>
  <div class="sap-header" :style="{ '--agent-color': agentColor }">
    <button
      class="sap-close detail-panel-close"
      aria-label="Close panel"
      title="Close (Esc)"
      @click="emit('close')"
    >✕</button>
    <div class="sap-info">
      <div class="sap-name" :style="{ color: agentColor }">
        <span class="sap-name-icon">{{ agentIcon }}</span>
        <span>{{ view.displayName }}</span>
      </div>
      <div class="sap-meta">
        <span v-if="view.model" class="sap-model">{{ view.model }}</span>
        <span v-if="view.model" class="sep">·</span>
        <span v-if="headerDuration">{{ headerDuration }}</span>
        <template v-if="view.turnIndex != null">
          <span class="sep">·</span>
          <span>Turn {{ view.turnIndex }}</span>
        </template>
        <template v-if="view.totalTokens">
          <span class="sep">·</span>
          <span title="Total tokens consumed">{{ formatNumber(view.totalTokens) }} tok</span>
        </template>
        <template v-if="view.totalToolCalls">
          <span class="sep">·</span>
          <span title="Total tool calls made">{{ view.totalToolCalls }} tools</span>
        </template>
      </div>
    </div>
    <span :class="['sap-status', statusClass(view.status)]">{{ statusText }}</span>
  </div>
</template>

<style scoped>
.sap-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
  background: var(--canvas-inset);
  flex-shrink: 0;
}
.sap-close {
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
.sap-close:hover { background: var(--neutral-subtle); color: var(--text-primary); }
.sap-info { flex: 1; min-width: 0; }
.sap-name { display: flex; align-items: center; gap: 6px; font-size: 0.875rem; font-weight: 600; line-height: 1.3; }
.sap-name-icon { font-size: 15px; flex-shrink: 0; }
.sap-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; font-size: 0.6875rem; color: var(--text-tertiary); margin-top: 2px; }
.sap-meta .sep { color: var(--text-placeholder); user-select: none; }
.sap-model { font-family: "JetBrains Mono", monospace; font-size: 0.625rem; padding: 1px 5px; background: var(--neutral-subtle); border-radius: var(--radius-full); color: var(--text-secondary); }
.sap-status { flex-shrink: 0; font-size: 0.6875rem; font-weight: 500; padding: 2px 8px; border-radius: var(--radius-full); }
.sap-status.completed { color: var(--success-fg); background: var(--success-subtle); }
.sap-status.failed { color: var(--danger-fg); background: var(--danger-subtle); }
.sap-status.in-progress { color: var(--warning-fg); background: var(--warning-subtle); }
</style>
