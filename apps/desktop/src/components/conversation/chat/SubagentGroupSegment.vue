<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import SubagentCard from "@/components/conversation/SubagentCard.vue";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";

defineProps<{
  subagents: TurnToolCall[];
  subagentMap: Map<string, SubagentFullData>;
  selectedAgentId: string | null;
}>();

const emit = defineEmits<{
  "select-subagent": [agentId: string];
}>();
</script>

<template>
  <div
    v-if="subagents.length > 1"
    class="cv-parallel-header"
    aria-hidden="true"
  >
    ⚡ {{ subagents.length }} agents launched in parallel
  </div>
  <div :class="{ 'cv-parallel-stack': subagents.length > 1 }">
    <div
      v-for="sa in subagents"
      :key="sa.toolCallId"
      :data-event-idx="sa.eventIndex != null ? sa.eventIndex : undefined"
      :data-agent-id="sa.toolCallId"
    >
      <SubagentCard
        :tool-call="sa"
        :child-tool-count="subagentMap.get(sa.toolCallId!)?.childTools.length ?? 0"
        :selected="selectedAgentId === sa.toolCallId"
        @select="emit('select-subagent', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.cv-parallel-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--warning-fg, #d29922);
  padding: 6px 0 2px;
  user-select: none;
}

.cv-parallel-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-left: 2px solid var(--warning-emphasis, #d29922);
  padding-left: 12px;
  margin-left: 4px;
}
</style>
