<script setup lang="ts">
import type { AttributedMessage, ConversationTurn, TurnToolCall } from "@tracepilot/types";
import {
  formatDuration,
  formatTime,
  MarkdownContent,
  ReasoningBlock,
  type useToggleSet,
} from "@tracepilot/ui";
import SubagentGroupSegment from "@/components/conversation/chat/SubagentGroupSegment.vue";
import ToolGroupSegment from "@/components/conversation/chat/ToolGroupSegment.vue";
import type { ToolSegment } from "@/components/conversation/chatViewUtils";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";
import { usePreferencesStore } from "@/stores/preferences";

type ToggleSet = ReturnType<typeof useToggleSet<string>>;

interface TurnRenderData {
  reasoning: string[];
  messages: AttributedMessage[];
  segments: ToolSegment[];
}

const props = defineProps<{
  turn: ConversationTurn;
  renderData: TurnRenderData;
  subagentMap: Map<string, SubagentFullData>;
  completionIds: string[];
  turnColor?: string;
  selectedAgentId: string | null;
  renderMarkdown: boolean;
  expandedReasoning: ToggleSet;
  expandedGroups: ToggleSet;
  expandedToolDetails: ToggleSet;
  fullResults: Map<string, string>;
  loadingResults: Set<string>;
  failedResults: Set<string>;
  completionLabel: (toolCallId: string) => string;
  findToolCallIndex: (turn: ConversationTurn, tc: TurnToolCall) => number;
  getArgsSummary: (turnIndex: number, tcIdx: number) => string;
}>();

const emit = defineEmits<{
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
  "select-subagent": [agentId: string];
}>();

const preferences = usePreferencesStore();

function tcProps(tc: TurnToolCall) {
  const idx = props.findToolCallIndex(props.turn, tc);
  const key = `${props.turn.turnIndex}-${idx}`;
  return {
    tc,
    variant: "compact" as const,
    argsSummary: props.getArgsSummary(props.turn.turnIndex, idx),
    expanded: props.expandedToolDetails.has(key),
    fullResult: tc.toolCallId ? props.fullResults.get(tc.toolCallId) : undefined,
    loadingFullResult: tc.toolCallId ? props.loadingResults.has(tc.toolCallId) : false,
    failedFullResult: tc.toolCallId ? props.failedResults.has(tc.toolCallId) : false,
    richEnabled: preferences.isRichRenderingEnabled(tc.toolName),
  };
}

function toggleToolDetail(tc: TurnToolCall) {
  const idx = props.findToolCallIndex(props.turn, tc);
  props.expandedToolDetails.toggle(`${props.turn.turnIndex}-${idx}`);
}
</script>

<template>
  <div
    class="cv-turn-block"
    :data-turn="`T${turn.turnIndex}`"
    :data-turn-idx="turn.turnIndex"
    :style="turnColor ? { borderLeft: `3px solid ${turnColor}`, paddingLeft: '12px' } : {}"
  >
    <!-- Main reasoning -->
    <ReasoningBlock
      v-for="(reasoning, rIdx) in renderData.reasoning"
      :key="`r-${turn.turnIndex}-${rIdx}`"
      :reasoning="[reasoning]"
      :expanded="expandedReasoning.has(`${turn.turnIndex}-main-${rIdx}`)"
      @toggle="expandedReasoning.toggle(`${turn.turnIndex}-main-${rIdx}`)"
    />

    <!-- Main messages -->
    <div
      v-for="(msg, mIdx) in renderData.messages"
      :key="`m-${turn.turnIndex}-${mIdx}`"
      class="cv-agent-bubble"
    >
      <div class="cv-agent-bubble-header">
        <span class="cv-agent-avatar" aria-hidden="true">🤖</span>
        <span class="cv-agent-name">Copilot</span>
        <span v-if="turn.timestamp" class="cv-agent-time">
          {{ formatTime(turn.timestamp) }}
        </span>
      </div>
      <MarkdownContent :content="msg.content" :render="renderMarkdown" />
    </div>

    <!-- Tool segments -->
    <template
      v-for="(segment, sIdx) in renderData.segments"
      :key="`seg-${turn.turnIndex}-${sIdx}`"
    >
      <ToolGroupSegment
        v-if="segment.type === 'tool-group'"
        :turn="turn"
        :items="segment.items"
        :group-key="`${turn.turnIndex}-group-${sIdx}`"
        :expanded-groups="expandedGroups"
        :tc-props="tcProps"
        :toggle-tool-detail="toggleToolDetail"
        @load-full-result="emit('load-full-result', $event)"
        @retry-full-result="emit('retry-full-result', $event)"
      />

      <SubagentGroupSegment
        v-else-if="segment.type === 'subagent-group'"
        :subagents="segment.subagents"
        :subagent-map="subagentMap"
        :selected-agent-id="selectedAgentId"
        @select-subagent="emit('select-subagent', $event)"
      />
    </template>

    <!-- Subagent completion pills (at the turn of their final read_agent) -->
    <div
      v-for="agentId in completionIds"
      :key="`complete-${agentId}`"
      :class="['cv-subagent-complete-pill', subagentMap.get(agentId)?.toolCall.success === false ? 'failed' : 'completed']"
      role="button"
      tabindex="0"
      @click="emit('select-subagent', agentId)"
      @keydown.enter="emit('select-subagent', agentId)"
    >
      <span class="cv-pill-icon" aria-hidden="true">{{ subagentMap.get(agentId)?.toolCall.success === false ? '✗' : '✓' }}</span>
      <span class="cv-pill-label">{{ completionLabel(agentId) }}</span>
      <span v-if="subagentMap.get(agentId)?.toolCall.durationMs" class="cv-pill-duration">
        {{ formatDuration(subagentMap.get(agentId)!.toolCall.durationMs!) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/* ─── Turn block + timeline ────────────────────────────────────── */

.cv-turn-block {
  position: relative;
  padding-left: 20px;
  padding-top: 4px;
  padding-bottom: 8px;
}

.cv-turn-block::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 7px;
  width: 1px;
  background: var(--border-muted, #484f58);
  pointer-events: none;
}

.cv-turn-block::before {
  content: attr(data-turn);
  position: absolute;
  left: -2px;
  top: 8px;
  font-size: 10px;
  font-family: "JetBrains Mono", monospace;
  color: var(--text-placeholder, #6e7681);
  background: var(--canvas-default, #0d1117);
  padding: 0 3px;
  border-radius: var(--radius-sm, 4px);
  opacity: 0;
  transition: opacity var(--transition-fast, 0.1s) ease;
  z-index: 1;
  pointer-events: none;
}

.cv-turn-block:hover::before {
  opacity: 1;
}

/* ─── Agent bubble ─────────────────────────────────────────────── */

.cv-agent-bubble {
  background: var(--canvas-subtle, #161b22);
  border-radius: var(--radius-md, 8px);
  padding: 12px 16px;
  margin: 6px 0;
}

.cv-agent-bubble-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #8b949e);
  margin-bottom: 6px;
}

.cv-agent-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  min-width: 22px;
  border-radius: var(--radius-full, 100px);
  background: var(--neutral-subtle, rgba(110, 118, 129, 0.1));
  font-size: 13px;
  line-height: 1;
}

.cv-agent-name {
  font-weight: 600;
}

.cv-agent-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-placeholder, #6e7681);
  font-weight: 400;
}

/* ─── Subagent completion pill ─────────────────────────────────── */

.cv-subagent-complete-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
  margin: 4px 0;
  transition: filter 0.15s ease;
}

.cv-subagent-complete-pill:hover {
  filter: brightness(1.15);
}

.cv-subagent-complete-pill.completed {
  background: var(--success-subtle, rgba(63, 185, 80, 0.1));
  color: var(--success-fg, #3fb950);
}

.cv-subagent-complete-pill.failed {
  background: var(--danger-subtle, rgba(248, 81, 73, 0.1));
  color: var(--danger-fg, #f85149);
}

.cv-subagent-complete-pill .cv-pill-duration {
  opacity: 0.7;
  font-size: 11px;
}
</style>
