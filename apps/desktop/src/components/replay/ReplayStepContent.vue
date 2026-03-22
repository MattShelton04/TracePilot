<script setup lang="ts">
/**
 * ReplayStepContent — renders a single replay step's content.
 *
 * Reuses existing UI components (ToolCallItem, ReasoningBlock, AgentBadge, etc.)
 * and the MarkdownContent component for rich assistant message rendering.
 *
 * Large-content handling:
 * - Tool calls capped at MAX_VISIBLE_TOOLS per section, with "Show N more" toggle
 * - Long messages truncated at MAX_MESSAGE_CHARS with "Show more" toggle
 */
import { computed, ref } from 'vue';
import { usePreferencesStore } from '@/stores/preferences';
import type { ConversationTurn, TurnToolCall } from '@tracepilot/types';
import type { ReplayStep } from '@tracepilot/types';
import {
  Badge,
  ToolCallItem,
  ExpandChevron,
  AgentBadge,
  ReasoningBlock,
  MarkdownContent,
  formatDuration,
  formatTime,
  toolIcon,
  AGENT_COLORS,
  useConversationSections,
  useToggleSet,
} from '@tracepilot/ui';

/** Max tool calls shown before requiring expand */
const MAX_VISIBLE_TOOLS = 8;
/** Max characters in a message bubble before truncation */
const MAX_MESSAGE_CHARS = 3000;

const props = defineProps<{
  step: ReplayStep;
  /** The source ConversationTurn for this step (for agent grouping). */
  turn: ConversationTurn;
  /** All session turns for cross-turn subagent attribution. */
  allTurns: ConversationTurn[];
  /** Whether this step is the currently active one. */
  isCurrent: boolean;
  /** Whether this step is in the past (already replayed). */
  isPast: boolean;
  /** Whether this step is in the future (not yet replayed). */
  isFuture: boolean;
  /** Loaded full tool results. */
  fullResults: Map<string, string>;
  /** Tool result IDs currently loading. */
  loadingResults: Set<string>;
  /** Tool result IDs that failed to load. */
  failedResults: Set<string>;
  /** Function to check if rich rendering is enabled for a tool. */
  isRichEnabled: (toolName: string) => boolean;
}>();

const preferences = usePreferencesStore();

const emit = defineEmits<{
  'load-full-result': [toolCallId: string];
  'retry-full-result': [toolCallId: string];
}>();

// Toggle sets for this step's expandable sections
// Tool call groups default to expanded in replay; this tracks manually collapsed groups
const collapsedTools = useToggleSet<string>();
// Tool detail toggles — behavior inverts when there are ≤ 5 tool calls (auto-expand)
const toolDetailToggles = useToggleSet<string>();
const expandedReasoning = useToggleSet<string>();
// Tracks which tool sections have been "Show all" expanded (for capping)
const expandedToolSections = useToggleSet<string>();
// Tracks which messages have been "Show more" expanded
const expandedMessages = useToggleSet<string>();

// Use conversation sections for agent grouping (full session for cross-turn attribution)
const { getSections, getArgsSummary, findToolCallIndex } = useConversationSections(
  () => props.allTurns,
);

const sections = computed(() => getSections(props.turn.turnIndex));

// Auto-expand individual tool details when ≤ 5 tool calls in main sections only.
// Subagent sections use compact variant and don't auto-expand.
const mainSectionToolCount = computed(() =>
  sections.value
    .filter((s) => !s.agentId)
    .reduce((sum, s) => sum + s.toolCalls.length, 0),
);

function isToolDetailExpanded(key: string): boolean {
  if (mainSectionToolCount.value <= 5) {
    return !toolDetailToggles.has(key);
  }
  return toolDetailToggles.has(key);
}

/** Get visible tool calls for a section, respecting the cap */
function visibleToolCalls(sectionIdx: number, toolCalls: TurnToolCall[]): TurnToolCall[] {
  const key = `${props.step.index}-${sectionIdx}`;
  if (toolCalls.length <= MAX_VISIBLE_TOOLS || expandedToolSections.has(key)) {
    return toolCalls;
  }
  return toolCalls.slice(0, MAX_VISIBLE_TOOLS);
}

/** Count of hidden tool calls for a section */
function hiddenToolCount(sectionIdx: number, toolCalls: TurnToolCall[]): number {
  const key = `${props.step.index}-${sectionIdx}`;
  if (toolCalls.length <= MAX_VISIBLE_TOOLS || expandedToolSections.has(key)) return 0;
  return toolCalls.length - MAX_VISIBLE_TOOLS;
}

/** Check if a message should be truncated */
function shouldTruncateMessage(msg: string, msgKey: string): boolean {
  return msg.length > MAX_MESSAGE_CHARS && !expandedMessages.has(msgKey);
}

/** Get display text for a message, truncating if needed */
function displayMessage(msg: string, msgKey: string): string {
  if (shouldTruncateMessage(msg, msgKey)) {
    return msg.slice(0, MAX_MESSAGE_CHARS);
  }
  return msg;
}

/** Build ToolCallItem prop object (mirrors ConversationTab pattern). */
function tcProps(tc: TurnToolCall) {
  const idx = findToolCallIndex(props.turn, tc);
  const key = `${props.step.index}-${idx}`;
  return {
    tc,
    variant: 'full' as const,
    argsSummary: getArgsSummary(props.turn.turnIndex, idx),
    expanded: isToolDetailExpanded(key),
    fullResult: tc.toolCallId ? props.fullResults.get(tc.toolCallId) : undefined,
    loadingFullResult: tc.toolCallId ? props.loadingResults.has(tc.toolCallId) : false,
    failedFullResult: tc.toolCallId ? props.failedResults.has(tc.toolCallId) : false,
    richEnabled: props.isRichEnabled(tc.toolName),
    _key: key,
  };
}

function toggleToolDetail(tc: TurnToolCall) {
  const idx = findToolCallIndex(props.turn, tc);
  toolDetailToggles.toggle(`${props.step.index}-${idx}`);
}

const hasUserMessage = computed(() => !!props.step.userMessage);
const hasAssistantContent = computed(() =>
  sections.value.some((s) => s.messages.some((m) => m.trim()) || s.toolCalls.length > 0),
);
</script>

<template>
  <div
    class="replay-step"
    :class="{
      'step-past': isPast,
      'step-current': isCurrent,
      'step-future': isFuture,
    }"
  >
    <!-- User message -->
    <div v-if="hasUserMessage" class="step-message user-message">
      <div class="message-header">
        <span class="author-badge user">👤 You</span>
        <span v-if="step.timestamp" class="msg-time">{{ formatTime(step.timestamp) }}</span>
        <span class="msg-meta">Turn {{ step.turnIndex }}</span>
      </div>
      <div class="message-bubble user-bubble">
        <MarkdownContent :content="displayMessage(step.userMessage!, `user-${step.index}`)" :render="preferences.isFeatureEnabled('renderMarkdown')" />
        <button
          v-if="shouldTruncateMessage(step.userMessage!, `user-${step.index}`)"
          class="show-more-btn"
          @click="expandedMessages.toggle(`user-${step.index}`)"
        >
          Show more ({{ Math.round((step.userMessage!.length - MAX_MESSAGE_CHARS) / 1000) }}k chars hidden)
        </button>
        <button
          v-else-if="step.userMessage!.length > MAX_MESSAGE_CHARS"
          class="show-more-btn"
          @click="expandedMessages.toggle(`user-${step.index}`)"
        >
          Show less
        </button>
      </div>
    </div>

    <!-- Agent-grouped assistant content -->
    <template v-for="(section, sIdx) in sections" :key="sIdx">
      <!-- Main agent section -->
      <template v-if="!section.agentId">
        <!-- Reasoning -->
        <ReasoningBlock
          v-if="section.reasoning.length > 0"
          class="step-reasoning"
          :reasoning="section.reasoning"
          :expanded="expandedReasoning.has(`${step.index}-main-${sIdx}`)"
          @toggle="expandedReasoning.toggle(`${step.index}-main-${sIdx}`)"
        />

        <!-- Assistant messages -->
        <div
          v-for="(msg, msgIdx) in section.messages.filter((m) => m.trim())"
          :key="`msg-${msgIdx}`"
          class="step-message assistant-message"
        >
          <div class="message-header">
            <span class="author-badge assistant">🤖 Copilot</span>
            <Badge v-if="step.model" variant="done" style="font-size: 0.6rem; padding: 1px 5px;">{{ step.model }}</Badge>
            <span v-if="step.durationMs" class="msg-meta">{{ formatDuration(step.durationMs) }}</span>
            <span v-if="step.timestamp" class="msg-time">{{ formatTime(step.timestamp) }}</span>
          </div>
          <div class="message-bubble assistant-bubble">
            <MarkdownContent :content="displayMessage(msg, `asst-${step.index}-${msgIdx}`)" :render="preferences.isFeatureEnabled('renderMarkdown')" />
            <button
              v-if="shouldTruncateMessage(msg, `asst-${step.index}-${msgIdx}`)"
              class="show-more-btn"
              @click="expandedMessages.toggle(`asst-${step.index}-${msgIdx}`)"
            >
              Show more ({{ Math.round((msg.length - MAX_MESSAGE_CHARS) / 1000) }}k chars hidden)
            </button>
            <button
              v-else-if="msg.length > MAX_MESSAGE_CHARS"
              class="show-more-btn"
              @click="expandedMessages.toggle(`asst-${step.index}-${msgIdx}`)"
            >
              Show less
            </button>
          </div>
        </div>

        <!-- Tool calls -->
        <div v-if="section.toolCalls.length > 0" class="step-tools">
          <button
            class="tools-toggle"
            :aria-expanded="!collapsedTools.has(`${step.index}-${sIdx}`)"
            @click="collapsedTools.toggle(`${step.index}-${sIdx}`)"
          >
            <ExpandChevron :expanded="!collapsedTools.has(`${step.index}-${sIdx}`)" />
            <span>{{ section.toolCalls.length }} tool call{{ section.toolCalls.length !== 1 ? 's' : '' }}</span>
            <span class="tools-summary">
              <span class="tools-pass">{{ section.toolCalls.filter((tc) => tc.success === true).length }} passed</span>
              <span
                v-if="section.toolCalls.some((tc) => tc.success === false)"
                class="tools-fail"
              >
                {{ section.toolCalls.filter((tc) => tc.success === false).length }} failed
              </span>
            </span>
          </button>

          <div v-if="!collapsedTools.has(`${step.index}-${sIdx}`)" class="tools-list">
            <ToolCallItem
              v-for="tc in visibleToolCalls(sIdx, section.toolCalls)"
              :key="tc.toolCallId ?? tc.toolName"
              v-bind="tcProps(tc)"
              @toggle="toggleToolDetail(tc)"
              @load-full-result="emit('load-full-result', $event)"
              @retry-full-result="emit('retry-full-result', $event)"
            />
            <button
              v-if="hiddenToolCount(sIdx, section.toolCalls) > 0"
              class="show-more-tools-btn"
              @click="expandedToolSections.toggle(`${step.index}-${sIdx}`)"
            >
              Show {{ hiddenToolCount(sIdx, section.toolCalls) }} more tool calls
            </button>
            <button
              v-else-if="section.toolCalls.length > MAX_VISIBLE_TOOLS"
              class="show-more-tools-btn"
              @click="expandedToolSections.toggle(`${step.index}-${sIdx}`)"
            >
              Show fewer tool calls
            </button>
          </div>
        </div>
      </template>

      <!-- Subagent section -->
      <div v-else class="subagent-block" :style="{ '--agent-color': AGENT_COLORS[section.agentType] ?? AGENT_COLORS.main }">
        <div class="subagent-header">
          <AgentBadge
            :agent-name="section.agentDisplayName"
            :agent-type="section.agentType"
            :model="section.model"
            :status="section.status"
          />
          <span v-if="section.durationMs" class="msg-meta">{{ formatDuration(section.durationMs) }}</span>
          <span v-if="section.toolCalls.length" class="msg-meta">
            · {{ section.toolCalls.length }} tool{{ section.toolCalls.length !== 1 ? 's' : '' }}
          </span>
        </div>

        <div class="subagent-content">
          <ReasoningBlock
            v-if="section.reasoning.length > 0"
            :reasoning="section.reasoning"
            :expanded="expandedReasoning.has(`${step.index}-${section.agentId}`)"
            @toggle="expandedReasoning.toggle(`${step.index}-${section.agentId}`)"
          />

          <div v-for="(msg, idx) in section.messages.filter((m) => m.trim())" :key="`sub-msg-${idx}`" class="step-message subagent-msg">
            <div class="message-bubble assistant-bubble subagent-bubble">
              <MarkdownContent :content="displayMessage(msg, `sub-${step.index}-${section.agentId}-${idx}`)" :render="preferences.isFeatureEnabled('renderMarkdown')" max-height="300px" />
              <button
                v-if="shouldTruncateMessage(msg, `sub-${step.index}-${section.agentId}-${idx}`)"
                class="show-more-btn"
                @click="expandedMessages.toggle(`sub-${step.index}-${section.agentId}-${idx}`)"
              >
                Show more ({{ Math.round((msg.length - MAX_MESSAGE_CHARS) / 1000) }}k chars hidden)
              </button>
              <button
                v-else-if="msg.length > MAX_MESSAGE_CHARS"
                class="show-more-btn"
                @click="expandedMessages.toggle(`sub-${step.index}-${section.agentId}-${idx}`)"
              >
                Show less
              </button>
            </div>
          </div>

          <div v-if="section.toolCalls.length > 0" class="step-tools subagent-tools">
            <ToolCallItem
              v-for="tc in visibleToolCalls(sIdx, section.toolCalls)"
              :key="tc.toolCallId ?? tc.toolName"
              v-bind="tcProps(tc)"
              variant="compact"
              @toggle="toggleToolDetail(tc)"
              @load-full-result="emit('load-full-result', $event)"
              @retry-full-result="emit('retry-full-result', $event)"
            />
            <button
              v-if="hiddenToolCount(sIdx, section.toolCalls) > 0"
              class="show-more-tools-btn"
              @click="expandedToolSections.toggle(`${step.index}-${sIdx}`)"
            >
              Show {{ hiddenToolCount(sIdx, section.toolCalls) }} more tool calls
            </button>
            <button
              v-else-if="section.toolCalls.length > MAX_VISIBLE_TOOLS"
              class="show-more-tools-btn"
              @click="expandedToolSections.toggle(`${step.index}-${sIdx}`)"
            >
              Show fewer tool calls
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Session events -->
    <div v-if="step.sessionEvents?.length" class="session-events">
      <div v-for="(se, seIdx) in step.sessionEvents" :key="seIdx" class="session-event-row" :class="`event-${se.severity}`">
        <Badge :variant="se.severity === 'error' ? 'danger' : se.severity === 'warning' ? 'warning' : 'neutral'" size="sm">
          {{ se.severity === 'error' ? '🔴' : se.severity === 'warning' ? '🟡' : 'ℹ️' }}
          {{ se.eventType.replace('session.', '') }}
        </Badge>
        <span class="event-summary">{{ se.summary }}</span>
      </div>
    </div>

    <!-- Token count moved to sidebar only -->
  </div>
</template>

<style scoped>
.replay-step {
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  transition: all 300ms ease;
}
.step-past { opacity: 0.7; }
.step-current {
  opacity: 1;
  border-color: var(--accent-fg);
  border-left: 3px solid var(--accent-fg);
  background: var(--canvas-overlay);
  box-shadow: 0 0 20px rgba(99, 102, 241, 0.08);
  animation: fadeInStep 300ms ease;
}
.step-future {
  opacity: 0.2;
  filter: blur(1px);
  pointer-events: none;
}
@keyframes fadeInStep {
  from { opacity: 0.5; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .step-current { animation: none; }
  .replay-step { transition: none; }
}

/* Message bubbles */
.step-message { margin-bottom: 10px; }
.message-header {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 4px; font-size: 0.7rem;
}
.author-badge {
  font-weight: 600; font-size: 0.7rem;
  padding: 1px 6px; border-radius: 4px;
}
.author-badge.user { background: var(--accent-subtle); color: var(--accent-fg); }
.author-badge.assistant { background: var(--success-subtle); color: var(--success-fg); }
.msg-time {
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
}
.msg-meta { color: var(--text-tertiary); font-size: 0.65rem; }

.message-bubble {
  padding: 10px 14px;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  line-height: 1.6;
}
.user-bubble {
  background: var(--accent-muted);
  border: 1px solid rgba(99, 102, 241, 0.15);
  max-width: 90%;
  border-bottom-left-radius: 4px;
}
.assistant-bubble {
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-bottom-right-radius: 4px;
}
.subagent-bubble {
  border-left: 3px solid var(--agent-color, var(--accent-muted));
  font-size: 0.775rem;
}

/* Tool calls */
.step-tools { margin: 8px 0; }
.tools-toggle {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  padding: 6px 10px;
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.75rem; font-weight: 500;
  cursor: pointer;
  transition: background 120ms;
}
.tools-toggle:hover { background: var(--canvas-subtle); }
.tools-summary { margin-left: auto; display: flex; gap: 6px; }
.tools-pass { color: var(--success-fg); font-size: 0.7rem; }
.tools-fail { color: var(--danger-fg); font-size: 0.7rem; }
.tools-list { margin-top: 4px; display: flex; flex-direction: column; gap: 4px; }

/* Subagent */
.subagent-block {
  margin: 8px 0;
  border-left: 3px solid var(--agent-color, var(--accent-muted));
  padding-left: 12px;
}
.subagent-header {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 6px;
}
.subagent-content { padding-left: 4px; }
.subagent-tools { margin-top: 4px; }
.subagent-msg { margin-bottom: 6px; }

/* Session events */
.session-events { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.session-event-row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.7rem;
}
.event-error { background: var(--danger-subtle); }
.event-warning { background: var(--warning-subtle); }
.event-info { background: var(--canvas-inset); }

/* Show more / truncation controls */
.show-more-btn {
  display: block;
  margin-top: 6px;
  padding: 4px 10px;
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--accent-fg);
  background: transparent;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 120ms;
}
.show-more-btn:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-fg);
}
.show-more-tools-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 6px 10px;
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--accent-fg);
  background: var(--canvas-inset);
  border: 1px dashed var(--border-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 120ms;
}
.show-more-tools-btn:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-fg);
  border-style: solid;
}

/* Reasoning */
.step-reasoning { margin-bottom: 8px; }
</style>
