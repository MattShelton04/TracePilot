<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import {
  Badge,
  ExpandChevron,
  formatDuration,
  getToolStatusColor,
  ToolDetailPanel,
  toolIcon,
  truncateText,
} from "@tracepilot/ui";
import type { Ref } from "vue";
import { computed } from "vue";
import {
  agentKey,
  barWidthPct,
  subagents,
  toolTooltip,
  turnKey,
  turnMaxDuration,
  turnSubagentCount,
  turnToolCount,
} from "@/composables/useSwimlaneLayout";
import SwimlaneMessageLane from "./SwimlaneMessageLane.vue";
import SwimlaneSubagentLane from "./SwimlaneSubagentLane.vue";

interface ToggleSet<T> {
  set: Ref<Set<T>>;
  toggle: (key: T) => void;
  has: (key: T) => boolean;
}

const props = defineProps<{
  phaseIdx: number;
  turn: ConversationTurn;
  collapsed: boolean;
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
  (e: "toggle-turn"): void;
  (e: "select-tool", tc: TurnToolCall): void;
  (e: "close-detail"): void;
  (e: "load-full-result", toolCallId: string): void;
  (e: "set-assistant-idx", turnIndex: number, idx: number): void;
}>();

const tKey = computed(() => turnKey(props.phaseIdx, props.turn));
const maxMs = computed(() => turnMaxDuration(props.turn));

const assistantContent = computed(() => {
  const first = props.turn.assistantMessages.find((m) => m.content.trim());
  return first?.content ?? "";
});

const nonEmptyAssistantMessages = computed(() =>
  props.turn.assistantMessages.filter((m) => m.content.trim()),
);

const currentAssistantContent = computed(() => {
  const idx = props.getAssistantMsgIdx(props.turn.turnIndex);
  return nonEmptyAssistantMessages.value[idx]?.content ?? "";
});

const turnSubagents = computed(() => subagents(props.turn));
const turnDirectTools = computed(() => props.directTools(props.turn));
</script>

<template>
  <div class="turn-group">
    <!-- Turn header -->
    <div
      class="turn-header"
      role="button"
      tabindex="0"
      :aria-label="`Toggle turn ${turn.turnIndex}${turn.userMessage ? ': ' + truncateText(turn.userMessage, 60) : ''}`"
      :aria-expanded="!collapsed"
      @click="emit('toggle-turn')"
      @keydown.enter.space.prevent="emit('toggle-turn')"
    >
      <ExpandChevron :expanded="!collapsed" size="sm" />
      <span class="turn-label">Turn {{ turn.turnIndex }}</span>
      <span v-if="turn.userMessage" class="turn-user-msg">
        {{ truncateText(turn.userMessage, 60) }}
      </span>
      <span class="turn-stats">
        <span v-if="turnSubagentCount(turn) > 0" class="turn-stat">
          {{ turnSubagentCount(turn) }} agent{{ turnSubagentCount(turn) !== 1 ? "s" : "" }}
        </span>
        <span class="turn-stat">{{ turnToolCount(turn) }} tools</span>
        <span v-if="turn.durationMs" class="turn-stat">
          {{ formatDuration(turn.durationMs) }}
        </span>
        <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
      </span>
    </div>

    <!-- Turn body (collapsible) -->
    <div v-if="!collapsed" class="turn-body">
      <!-- User message lane -->
      <SwimlaneMessageLane
        v-if="turn.userMessage"
        variant="user"
        :turn-index="turn.turnIndex"
        :content="turn.userMessage"
        :expanded="expandedMessages.has(`${turn.turnIndex}-user`)"
        @toggle-expanded="expandedMessages.toggle(`${turn.turnIndex}-user`)"
      />

      <!-- Assistant lane -->
      <SwimlaneMessageLane
        v-if="nonEmptyAssistantMessages.length > 0"
        variant="assistant"
        :turn-index="turn.turnIndex"
        :content="
          expandedMessages.has(`${turn.turnIndex}-assistant`)
            ? currentAssistantContent
            : assistantContent
        "
        :message-count="nonEmptyAssistantMessages.length"
        :current-index="getAssistantMsgIdx(turn.turnIndex)"
        :expanded="expandedMessages.has(`${turn.turnIndex}-assistant`)"
        @toggle-expanded="expandedMessages.toggle(`${turn.turnIndex}-assistant`)"
        @set-index="(idx) => emit('set-assistant-idx', turn.turnIndex, idx)"
      />

      <!-- Subagent lanes -->
      <SwimlaneSubagentLane
        v-for="(agent, agentIdx) in turnSubagents"
        :key="agent.toolCallId ?? `${agent.toolName}-${agentIdx}`"
        :agent="agent"
        :turn="turn"
        :nested-tools="nestedTools(agent)"
        :collapsed="agentSet.has(agentKey(tKey, agent, agentIdx))"
        :selected="isToolSelected(agent)"
        :parallel="parallelAgentIds.has(agent.toolCallId ?? agent.toolName)"
        :live-duration-ms="agentLiveDuration(agent)"
        :is-tool-selected="isToolSelected"
        @select-agent="emit('select-tool', agent)"
        @toggle-collapsed="agentSet.toggle(agentKey(tKey, agent, agentIdx))"
        @select-tool="(tc) => emit('select-tool', tc)"
      />

      <!-- Direct tools lane -->
      <div v-if="turnDirectTools.length" class="direct-tools-lane">
        <div class="swimlane">
          <div class="swimlane-label">Direct</div>
          <div class="swimlane-track">
            <div
              v-for="(tc, idx) in turnDirectTools"
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

      <!-- Detail panel (shown when a tool in this turn is selected) -->
      <ToolDetailPanel
        v-if="selectedTool && turnOwnsSelected?.(turn)"
        :tc="selectedTool"
        :full-result="fullResults.get(selectedTool.toolCallId ?? '')"
        :loading-full-result="!!(selectedTool.toolCallId && loadingResults.has(selectedTool.toolCallId))"
        :rich-enabled="prefs.isRichRenderingEnabled(selectedTool.toolName)"
        :child-tool-count="selectedTool.isSubagent ? countNestedTools(selectedTool) : undefined"
        @close="emit('close-detail')"
        @load-full-result="(id) => emit('load-full-result', id)"
      />
    </div>
  </div>
</template>

<style scoped>
.turn-group {
  border-bottom: 1px solid var(--border-subtle);
}

.turn-group:last-child {
  border-bottom: none;
}

.turn-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px 8px 28px;
  background: var(--canvas-subtle);
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}

.turn-header:hover {
  background: var(--canvas-overlay);
}

.turn-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}

.turn-user-msg {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
}

.turn-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.turn-stat {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.turn-body {
  padding: 4px 0;
  transition: max-height var(--transition-slow);
}

/* ── Direct tools lane ── */
.direct-tools-lane {
  margin-left: 40px;
  border-left: 3px solid var(--border-muted);
  background: var(--canvas-default);
}

/* ── Swimlane (for direct tools track) ── */
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
  .turn-header {
    padding-left: 14px;
    flex-wrap: wrap;
  }

  .turn-stats {
    width: 100%;
    margin-top: 4px;
  }

  .direct-tools-lane {
    margin-left: 16px;
  }

  .swimlane {
    grid-template-columns: 60px 1fr;
  }
}
</style>
