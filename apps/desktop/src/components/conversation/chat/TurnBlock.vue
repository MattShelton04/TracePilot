<script setup lang="ts">
import type { AttributedMessage, ConversationTurn, TurnToolCall } from "@tracepilot/types";
import {
  formatDuration,
  MarkdownContent,
  ReasoningBlock,
  useMainAgentLabel,
  type useToggleSet,
} from "@tracepilot/ui";
import { Bot, SquareTerminal } from "lucide-vue-next";
import { computed } from "vue";
import MessageCopyButton from "@/components/conversation/chat/MessageCopyButton.vue";
import SubagentGroupSegment from "@/components/conversation/chat/SubagentGroupSegment.vue";
import ToolGroupSegment from "@/components/conversation/chat/ToolGroupSegment.vue";
import {
  getCommandOutput,
  type OrderedTurnContent,
  type ToolSegment,
} from "@/components/conversation/chatViewUtils";
import type { PermissionPair } from "@/components/conversation/sessionEventPairing";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";
import { usePreferencesStore } from "@/stores/preferences";

type ToggleSet = ReturnType<typeof useToggleSet<string>>;

const props = defineProps<{
  turn: ConversationTurn;
  /** Main-agent content; `order` interleaves replies and reasoning with tool segments. */
  renderData: OrderedTurnContent;
  /** Permission events keyed by `toolCallId`, surfaced inline on the
   *  matching tool call row instead of as a standalone permission card.
   *  Only populated for tool calls whose `toolCallId` was paired with a
   *  `permission.*` event in the same turn. */
  permissionByToolCallId?: Map<string, PermissionPair>;
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
  /**
   * Keep the `T<n>` label visible. Set for a round trip that continues the
   * previous prompt: with no anchor of its own, its index would otherwise
   * look skipped between the user turns around it.
   */
  showTurnLabel?: boolean;
}>();

const emit = defineEmits<{
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
  "select-subagent": [agentId: string];
}>();

const preferences = usePreferencesStore();
const mainAgentLabel = useMainAgentLabel();

type TurnItem =
  | { kind: "reasoning"; index: number; content: string }
  | { kind: "message"; index: number; message: AttributedMessage }
  | { kind: "segment"; index: number; segment: ToolSegment };

// Replies carry no time of their own (only the turn's start is known), so
// their bubbles show none; the prompt above already shows when the turn began.
const items = computed<TurnItem[]>(() => {
  const { reasoning, messages, segments, order } = props.renderData;
  return order.map((ref): TurnItem => {
    if (ref.kind === "reasoning") return { ...ref, content: reasoning[ref.index] };
    if (ref.kind === "message") return { ...ref, message: messages[ref.index] };
    return { ...ref, segment: segments[ref.index] };
  });
});

const commandOutput = computed(() => getCommandOutput(props.turn));

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
    permission:
      tc.toolCallId && props.permissionByToolCallId
        ? props.permissionByToolCallId.get(tc.toolCallId)
        : undefined,
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
    :class="{ 'cv-turn-block--labelled': showTurnLabel }"
    :data-turn="`T${turn.turnIndex}`"
    :data-turn-idx="turn.turnIndex"
    :style="turnColor ? { borderLeft: `3px solid ${turnColor}`, paddingLeft: '12px' } : {}"
  >
    <!-- Output of a slash command that ran without the model (Claude Code /model, /cost) -->
    <div
      v-for="output in commandOutput"
      :key="`output-${turn.turnIndex}-${output.eventIndex}`"
      class="cv-command-output cv-msg-copy-host"
      :data-event-idx="output.eventIndex"
    >
      <div class="cv-command-output-header">
        <SquareTerminal :size="14" aria-hidden="true" />
        <span>Output</span>
        <MessageCopyButton :text="output.content" label="Copy output" />
      </div>
      <pre class="cv-command-output-text">{{ output.content }}</pre>
    </div>

    <!-- Main reasoning, replies and tool segments, in the order they happened -->
    <template v-for="item in items" :key="`${item.kind}-${turn.turnIndex}-${item.index}`">
      <ReasoningBlock
        v-if="item.kind === 'reasoning'"
        :reasoning="[item.content]"
        :expanded="expandedReasoning.has(`${turn.turnIndex}-main-${item.index}`)"
        @toggle="expandedReasoning.toggle(`${turn.turnIndex}-main-${item.index}`)"
      />

      <div v-else-if="item.kind === 'message'" class="cv-agent-bubble cv-msg-copy-host">
        <div class="cv-agent-bubble-header">
          <span class="cv-agent-avatar" aria-hidden="true"><Bot :size="16" /></span>
          <span class="cv-agent-name">{{ mainAgentLabel }}</span>
          <MessageCopyButton :text="item.message.content" label="Copy reply" />
        </div>
        <MarkdownContent :content="item.message.content" :render="renderMarkdown" />
      </div>

      <ToolGroupSegment
        v-else-if="item.segment.type === 'tool-group'"
        :turn="turn"
        :items="item.segment.items"
        :group-key="`${turn.turnIndex}-group-${item.index}`"
        :expanded-groups="expandedGroups"
        :tc-props="tcProps"
        :toggle-tool-detail="toggleToolDetail"
        @load-full-result="emit('load-full-result', $event)"
        @retry-full-result="emit('retry-full-result', $event)"
      />

      <SubagentGroupSegment
        v-else
        :subagents="item.segment.subagents"
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
  background: var(--border-muted);
  pointer-events: none;
}

.cv-turn-block::before {
  content: attr(data-turn);
  position: absolute;
  left: -2px;
  top: 8px;
  font-size: 10px;
  font-family: "JetBrains Mono", monospace;
  color: var(--text-placeholder);
  background: var(--canvas-default);
  padding: 0 3px;
  border-radius: var(--radius-sm, 4px);
  opacity: 0;
  transition: opacity var(--transition-fast, 0.1s) ease;
  z-index: 1;
  pointer-events: none;
}

.cv-turn-block:hover::before,
.cv-turn-block--labelled::before {
  opacity: 1;
}

/* ─── Agent bubble ─────────────────────────────────────────────── */

.cv-agent-bubble {
  background: var(--canvas-subtle);
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
  color: var(--text-secondary);
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

/* The copy button sits at the far end of the header. */
.cv-agent-bubble-header .cv-msg-copy {
  margin-left: auto;
}

/* ─── Command output ───────────────────────────────────────────── */

.cv-command-output {
  border: 1px solid var(--border-muted);
  background: var(--canvas-inset);
  border-radius: var(--radius-md, 8px);
  padding: 8px 12px;
  margin: 6px 0;
}

.cv-command-output-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.cv-command-output-header .cv-msg-copy {
  margin-left: auto;
}

.cv-command-output-text {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
  color: var(--success-fg);
}

.cv-subagent-complete-pill.failed {
  background: var(--danger-subtle, rgba(248, 81, 73, 0.1));
  color: var(--danger-fg);
}

.cv-subagent-complete-pill .cv-pill-duration {
  opacity: 0.7;
  font-size: 11px;
}
</style>
