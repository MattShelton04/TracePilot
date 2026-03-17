<script setup lang="ts">
import { computed } from "vue";
import {
  type AgentType,
  type AgentStatus,
  AGENT_COLORS,
  AGENT_ICONS,
  STATUS_ICONS,
} from "../utils/agentTypes";

const props = withDefaults(
  defineProps<{
    agentName?: string;
    agentType?: AgentType;
    model?: string;
    status?: AgentStatus;
    compact?: boolean;
  }>(),
  {
    agentType: "main",
    compact: false,
  },
);

const color = computed(() => AGENT_COLORS[props.agentType] ?? AGENT_COLORS.main);
const icon = computed(() => AGENT_ICONS[props.agentType] ?? AGENT_ICONS.main);
const statusIcon = computed(() =>
  props.status ? STATUS_ICONS[props.status] : undefined,
);
const displayName = computed(
  () => props.agentName ?? (props.agentType === "main" ? "Copilot" : "Subagent"),
);
</script>

<template>
  <span
    class="agent-badge"
    :class="{ compact }"
    :style="{ '--agent-color': color }"
    :title="`${displayName}${model ? ` (${model})` : ''}`"
  >
    <span class="agent-dot" :style="{ backgroundColor: color }" />
    <span class="agent-icon">{{ icon }}</span>
    <span class="agent-name">{{ displayName }}</span>
    <span v-if="statusIcon" class="agent-status">{{ statusIcon }}</span>
    <span v-if="model && !compact" class="agent-model">{{ model }}</span>
  </span>
</template>

<style scoped>
.agent-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  line-height: 1;
  padding: 2px 8px;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--agent-color) 12%, transparent);
  color: var(--text-primary);
  white-space: nowrap;
  font-weight: 500;
}

.agent-badge.compact {
  padding: 1px 6px;
  font-size: 0.625rem;
  gap: 3px;
}

.agent-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.compact .agent-dot {
  width: 5px;
  height: 5px;
}

.agent-icon {
  font-size: 0.7em;
}

.compact .agent-icon {
  display: none;
}

.agent-name {
  font-weight: 600;
}

.agent-status {
  font-size: 0.7em;
}

.agent-model {
  font-size: 0.625rem;
  opacity: 0.7;
  font-weight: 400;
  padding-left: 2px;
}
</style>
