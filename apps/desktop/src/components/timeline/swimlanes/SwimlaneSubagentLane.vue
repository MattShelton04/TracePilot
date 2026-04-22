<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import {
  ExpandChevron,
  formatLiveDuration,
  getAgentColor,
  getToolStatusColor,
  inferAgentTypeFromToolCall,
  toolIcon,
} from "@tracepilot/ui";
import { computed } from "vue";
import {
  agentStatusIcon,
  barWidthPct,
  toolTooltip,
  turnMaxDuration,
} from "@/composables/useSwimlaneLayout";

const props = defineProps<{
  agent: TurnToolCall;
  turn: ConversationTurn;
  nestedTools: TurnToolCall[];
  collapsed: boolean;
  selected: boolean;
  parallel: boolean;
  liveDurationMs?: number;
  isToolSelected: (tc: TurnToolCall) => boolean;
}>();

const emit = defineEmits<{
  (e: "select-agent"): void;
  (e: "toggle-collapsed"): void;
  (e: "select-tool", tc: TurnToolCall): void;
}>();

const color = computed(() => getAgentColor(inferAgentTypeFromToolCall(props.agent)));

const maxMs = computed(() => turnMaxDuration(props.turn));
</script>

<template>
  <div class="subagent-lane" :style="{ '--agent-color': color }">
    <!-- Subagent header -->
    <div
      class="subagent-header"
      :class="{ 'subagent-header--selected': selected }"
      role="button"
      tabindex="0"
      :aria-label="`Select agent: ${agent.agentDisplayName ?? agent.toolName}`"
      :aria-expanded="!collapsed"
      @click="emit('select-agent')"
      @keydown.enter.space.prevent="emit('select-agent')"
    >
      <span
        class="subagent-chevron"
        role="button"
        tabindex="0"
        :aria-label="`Toggle ${agent.agentDisplayName ?? agent.toolName} expansion`"
        @click.stop="emit('toggle-collapsed')"
        @keydown.enter.space.stop.prevent="emit('toggle-collapsed')"
      >
        <ExpandChevron :expanded="!collapsed" size="sm" />
      </span>
      <span class="subagent-icon">{{ toolIcon(agent.toolName) }}</span>
      <span class="subagent-name">
        {{ agent.agentDisplayName ?? agent.toolName }}
      </span>
      <span class="subagent-meta">
        <span v-if="liveDurationMs" class="subagent-duration">
          {{ formatLiveDuration(liveDurationMs) }}
        </span>
        <span class="subagent-tool-count">
          {{ nestedTools.length }} tool{{ nestedTools.length !== 1 ? "s" : "" }}
        </span>
        <span v-if="parallel" class="subagent-parallel">‖ parallel</span>
        <span
          class="subagent-status"
          :class="{ 'subagent-status--fail': agent.success === false }"
        >
          {{ agentStatusIcon(agent) }}
        </span>
      </span>
    </div>

    <!-- Subagent tool track (collapsible) -->
    <div v-if="!collapsed" class="subagent-track">
      <div class="swimlane">
        <div class="swimlane-label"></div>
        <div class="swimlane-track">
          <div
            v-for="(tc, idx) in nestedTools"
            :key="tc.toolCallId ?? idx"
            class="swimlane-bar swimlane-bar--tool"
            :class="{ 'swimlane-bar--selected': isToolSelected(tc) }"
            :style="{
              width: barWidthPct(tc, maxMs),
              background: getToolStatusColor(tc),
              position: 'relative',
            }"
            :title="toolTooltip(tc)"
            role="button"
            tabindex="0"
            :aria-label="`Select tool: ${tc.toolName}`"
            @click.stop="emit('select-tool', tc)"
            @keydown.enter.space.prevent="emit('select-tool', tc)"
          >
            <span class="bar-icon">{{ toolIcon(tc.toolName) }}</span>
            {{ tc.toolName }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.subagent-lane {
  margin: 2px 0 2px 40px;
  border-left: 3px solid var(--agent-color, var(--accent-fg));
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--canvas-inset);
  overflow: hidden;
}

.subagent-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
  border-bottom: 1px solid var(--border-subtle);
}

.subagent-header:hover {
  background: var(--canvas-subtle);
}

.subagent-header--selected {
  background: var(--canvas-subtle);
  box-shadow: inset 3px 0 0 0 var(--agent-color, var(--accent-fg));
}

.subagent-chevron {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}

.subagent-icon {
  font-size: 0.875rem;
  flex-shrink: 0;
}

.subagent-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--agent-color, var(--accent-fg));
  white-space: nowrap;
}

.subagent-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.subagent-duration {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.subagent-tool-count {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.subagent-parallel {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--warning-fg);
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--warning-subtle);
  white-space: nowrap;
}

.subagent-status {
  font-size: 0.75rem;
}

.subagent-status--fail {
  color: var(--danger-fg);
}

.subagent-track {
  transition: max-height var(--transition-slow);
}

/* ── Shared swimlane layout (scoped to subagent's nested track) ── */
.swimlane {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 0;
}

.swimlane-label {
  padding: 6px 12px;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
}

.swimlane-track {
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  overflow: hidden;
  flex-wrap: wrap;
}

.swimlane-bar {
  height: 22px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  font-size: 0.625rem;
  font-weight: 500;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
  transition: opacity var(--transition-fast), box-shadow var(--transition-fast);
  cursor: default;
}

.swimlane-bar:hover {
  opacity: 0.85;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
}

.swimlane-bar--tool {
  cursor: pointer;
}

.swimlane-bar--tool .bar-icon {
  margin-right: 4px;
  font-size: 0.6875rem;
}

.swimlane-bar--selected {
  box-shadow: 0 0 0 2px var(--accent-fg), 0 0 8px rgba(56, 139, 253, 0.4);
  z-index: 1;
}

@media (max-width: 768px) {
  .subagent-lane {
    margin-left: 16px;
  }

  .swimlane {
    grid-template-columns: 60px 1fr;
  }
}
</style>
