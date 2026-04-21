<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { Badge, ExpandChevron, formatDuration, truncateText } from "@tracepilot/ui";
import type { Ref } from "vue";
import {
  type Phase,
  phaseAgentCount,
  phaseDurationMs,
  phaseToolCount,
  turnKey,
} from "@/composables/useSwimlaneLayout";
import SwimlaneTurnGroup from "./SwimlaneTurnGroup.vue";

interface ToggleSet<T> {
  set: Ref<Set<T>>;
  toggle: (key: T) => void;
  has: (key: T) => boolean;
}

const props = defineProps<{
  phase: Phase;
  collapsed: boolean;
  turnSet: ToggleSet<string>;
  expandedMessages: ToggleSet<string>;
  agentSet: ToggleSet<string>;
  nestedTools: (agent: TurnToolCall) => TurnToolCall[];
  directTools: (turn: ConversationTurn) => TurnToolCall[];
  countNestedTools: (agent: TurnToolCall) => number;
  parallelAgentIds: Set<string>;
  selectedTool: TurnToolCall | null;
  fullResults: Map<string, string>;
  loadingResults: Set<string>;
  // biome-ignore lint/suspicious/noExplicitAny: prefs store is exposed via composable
  prefs: any;
  turnOwnsSelected: ((turn: ConversationTurn) => boolean) | undefined;
  isToolSelected: (tc: TurnToolCall) => boolean;
  agentLiveDuration: (agent: TurnToolCall) => number | undefined;
  getAssistantMsgIdx: (turnIndex: number) => number;
}>();

const emit = defineEmits<{
  (e: "toggle-phase"): void;
  (e: "select-tool", tc: TurnToolCall): void;
  (e: "close-detail"): void;
  (e: "load-full-result", toolCallId: string): void;
  (e: "set-assistant-idx", turnIndex: number, idx: number): void;
}>();
</script>

<template>
  <div class="phase-group">
    <!-- Phase header -->
    <div
      class="phase-header"
      role="button"
      tabindex="0"
      :aria-label="`Toggle phase ${phase.index + 1}: ${phase.label}`"
      :aria-expanded="!collapsed"
      @click="emit('toggle-phase')"
      @keydown.enter.space.prevent="emit('toggle-phase')"
    >
      <ExpandChevron :expanded="!collapsed" size="md" />
      <span class="phase-label" :title="phase.label">
        Phase {{ phase.index + 1 }}: {{ truncateText(phase.label, 80) }}
      </span>
      <span class="phase-stats">
        <Badge variant="neutral">{{ formatDuration(phaseDurationMs(phase)) }}</Badge>
        <Badge variant="warning">{{ phaseToolCount(phase) }} tools</Badge>
        <Badge v-if="phaseAgentCount(phase) > 0" variant="accent">
          {{ phaseAgentCount(phase) }} agent{{ phaseAgentCount(phase) !== 1 ? "s" : "" }}
        </Badge>
      </span>
    </div>

    <!-- Phase body (collapsible) -->
    <div v-if="!collapsed" class="phase-body">
      <SwimlaneTurnGroup
        v-for="turn in phase.turns"
        :key="turn.turnIndex"
        :phase-idx="phase.index"
        :turn="turn"
        :collapsed="turnSet.has(turnKey(phase.index, turn))"
        :expanded-messages="expandedMessages"
        :agent-set="agentSet"
        :nested-tools="nestedTools"
        :direct-tools="directTools"
        :count-nested-tools="countNestedTools"
        :parallel-agent-ids="parallelAgentIds"
        :selected-tool="selectedTool"
        :full-results="fullResults"
        :loading-results="loadingResults"
        :prefs="prefs"
        :turn-owns-selected="turnOwnsSelected"
        :is-tool-selected="isToolSelected"
        :agent-live-duration="agentLiveDuration"
        :get-assistant-msg-idx="getAssistantMsgIdx"
        @toggle-turn="turnSet.toggle(turnKey(phase.index, turn))"
        @select-tool="(tc) => emit('select-tool', tc)"
        @close-detail="emit('close-detail')"
        @load-full-result="(id) => emit('load-full-result', id)"
        @set-assistant-idx="(turnIndex, idx) => emit('set-assistant-idx', turnIndex, idx)"
      />
    </div>
  </div>
</template>

<style scoped>
.phase-group {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--canvas-default);
  overflow: hidden;
}

.phase-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--canvas-raised);
  border-bottom: 1px solid var(--border-default);
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}

.phase-header:hover {
  background: var(--canvas-overlay);
}

.phase-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.phase-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.phase-body {
  display: flex;
  flex-direction: column;
  gap: 0;
}

@media (max-width: 768px) {
  .phase-header {
    flex-wrap: wrap;
  }

  .phase-stats {
    width: 100%;
    margin-top: 4px;
  }
}
</style>
