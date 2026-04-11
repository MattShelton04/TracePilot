<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import {
  agentStatusFromToolCall,
  formatDuration,
  formatLiveDuration,
  formatNumber,
  getAgentColor,
  getAgentIcon,
  inferAgentTypeFromToolCall,
} from "@tracepilot/ui";
import { computed } from "vue";

const props = defineProps<{
  toolCall: TurnToolCall;
  childToolCount?: number;
  selected?: boolean;
}>();

const emit = defineEmits<{
  select: [agentId: string];
}>();

const agentType = computed(() => inferAgentTypeFromToolCall(props.toolCall));
const agentColor = computed(() => getAgentColor(agentType.value));
const agentIcon = computed(() => getAgentIcon(agentType.value));
const status = computed(() => agentStatusFromToolCall(props.toolCall));

const displayName = computed(() => {
  return props.toolCall.agentDisplayName || props.toolCall.toolName || "Subagent";
});

const description = computed(() => {
  const tc = props.toolCall;
  const args = tc.arguments as Record<string, unknown> | undefined;
  return tc.intentionSummary || (args?.description as string) || (args?.name as string) || "";
});

const model = computed(() => {
  const args = props.toolCall.arguments as Record<string, unknown> | undefined;
  return props.toolCall.model || (args?.model as string) || "";
});

const duration = computed(() => {
  if (status.value === "in-progress" && !props.toolCall.durationMs) {
    return "";
  }
  if (status.value === "in-progress") {
    return formatLiveDuration(props.toolCall.durationMs);
  }
  return formatDuration(props.toolCall.durationMs ?? 0);
});

function handleClick() {
  if (props.toolCall.toolCallId) {
    emit("select", props.toolCall.toolCallId);
  }
}
</script>

<template>
  <div
    :class="['cv-subagent-card', { selected }]"
    :style="{ '--agent-color': agentColor }"
    role="button"
    tabindex="0"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
  >
    <div class="cv-subagent-inner">
      <span class="cv-subagent-badge">
        {{ agentIcon }} {{ displayName }}
      </span>
      <div class="cv-subagent-meta">
        <span class="cv-subagent-desc">{{ description }}</span>
      </div>
      <span v-if="model" class="cv-subagent-model">{{ model }}</span>
      <span v-if="duration" class="cv-subagent-dur">{{ duration }}</span>
      <span
        :class="[
          'cv-subagent-status',
          status === 'failed' ? 'fail' : status === 'in-progress' ? 'pending' : 'success',
        ]"
      />
      <span class="cv-subagent-arrow">▶</span>
    </div>
    <div v-if="childToolCount || toolCall.totalTokens || toolCall.totalToolCalls" class="cv-subagent-hint">
      <span v-if="childToolCount">{{ childToolCount }} tool call{{ childToolCount !== 1 ? "s" : "" }} inside</span>
      <span v-if="childToolCount && (toolCall.totalTokens || toolCall.totalToolCalls)"> · </span>
      <span v-if="toolCall.totalTokens" title="Tokens consumed">{{ formatNumber(toolCall.totalTokens) }} tok</span>
      <span v-if="toolCall.totalTokens && toolCall.totalToolCalls"> · </span>
      <span v-if="toolCall.totalToolCalls" title="Tool calls made">{{ toolCall.totalToolCalls }} tool exec{{ toolCall.totalToolCalls !== 1 ? "s" : "" }}</span>
    </div>
  </div>
</template>

<style scoped>
.cv-subagent-card {
  margin: 6px 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--canvas-subtle);
  cursor: pointer;
  transition: all var(--transition-normal);
  user-select: none;
}
.cv-subagent-card:hover {
  border-color: var(--border-accent);
  background: var(--canvas-overlay);
}
.cv-subagent-card.selected {
  border-color: var(--accent-emphasis);
  box-shadow:
    0 0 0 1px var(--accent-emphasis),
    0 0 12px rgba(99, 102, 241, 0.15);
}
.cv-subagent-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 2px solid var(--agent-color, var(--accent-emphasis));
}
.cv-subagent-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-size: 0.625rem;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--agent-color) 15%, transparent);
  color: var(--agent-color);
}
.cv-subagent-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.cv-subagent-desc {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cv-subagent-model {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.5625rem;
  color: var(--text-placeholder);
  white-space: nowrap;
  flex-shrink: 0;
}
.cv-subagent-dur {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.625rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  flex-shrink: 0;
}
.cv-subagent-status {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.cv-subagent-status.success {
  background: var(--success-fg);
}
.cv-subagent-status.fail {
  background: var(--danger-fg);
}
.cv-subagent-status.pending {
  background: var(--warning-fg);
}
.cv-subagent-arrow {
  font-size: 9px;
  color: var(--text-placeholder);
  flex-shrink: 0;
  transition: transform var(--transition-fast);
}
.cv-subagent-card:hover .cv-subagent-arrow {
  transform: translateX(2px);
  color: var(--accent-fg);
}
.cv-subagent-hint {
  font-size: 0.625rem;
  color: var(--text-placeholder);
  padding: 0 12px 6px;
}
</style>
