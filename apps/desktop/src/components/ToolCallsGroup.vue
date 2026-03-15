<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  toolCalls: Array<{
    toolName: string;
    success: boolean;
    durationMs: number;
    args?: string;
    result?: string;
  }>;
}>();

const isExpanded = ref(true);
const passCount = computed(() => props.toolCalls.filter(tc => tc.success).length);
const failCount = computed(() => props.toolCalls.filter(tc => !tc.success).length);

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
</script>

<template>
  <div class="tool-calls-container">
    <div class="tool-call-header" @click="toggleExpand" role="button" :aria-expanded="isExpanded">
      <svg
        class="tool-call-chevron"
        :class="{ expanded: isExpanded }"
        width="16" height="16" viewBox="0 0 16 16"
      >
        <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      </svg>
      <span>Tool Calls ({{ toolCalls.length }})</span>
      <span class="badge badge-success" v-if="passCount > 0">✓ {{ passCount }}</span>
      <span class="badge badge-danger" v-if="failCount > 0">✕ {{ failCount }}</span>
    </div>
    <div v-show="isExpanded" class="tool-calls-body">
      <div
        v-for="(call, i) in toolCalls"
        :key="i"
        class="tool-call-item"
      >
        <div class="tool-call-name">
          <span class="badge" :class="call.success ? 'badge-success' : 'badge-danger'">
            {{ call.success ? '✓' : '✕' }}
          </span>
          {{ call.toolName }}
          <span class="tool-call-duration">{{ formatDuration(call.durationMs) }}</span>
        </div>
        <div v-if="call.args" class="tool-call-args">
          <code>{{ call.args }}</code>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-call-chevron {
  transition: transform var(--transition-normal);
  color: var(--text-tertiary);
}
.tool-call-chevron.expanded {
  transform: rotate(90deg);
}
.tool-calls-body {
  padding: 8px 0;
}
.tool-call-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  font-weight: 500;
}
.tool-call-duration {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  margin-left: auto;
}
.tool-call-args {
  margin-top: 4px;
  padding: 6px 10px;
  background: var(--canvas-inset);
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  overflow-x: auto;
}
.tool-call-args code {
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
