<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from '@tracepilot/types';
import {
  AgentBadge,
  Badge,
  BtnGroup,
  categoryColor,
  EmptyState,
  ErrorAlert,
  ExpandChevron,
  formatDuration,
  formatNumber,
  formatTime,
  getAgentColor,
  MarkdownContent,
  ReasoningBlock,
  StatCard,
  ToolCallDetail,
  ToolCallItem,
  toolCategory,
  toolIcon,
  truncateText,
  useConversationSections,
  useSessionTabLoader,
  useToggleSet,
} from '@tracepilot/ui';
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAutoScroll } from '@/composables/useAutoScroll';
import { useToolResultLoader } from '@/composables/useToolResultLoader';
import { usePreferencesStore } from '@/stores/preferences';
import { useSessionDetailStore } from '@/stores/sessionDetail';

const route = useRoute();
const store = useSessionDetailStore();
const preferences = usePreferencesStore();
const expandedTools = useToggleSet<number>();
const expandedToolDetails = useToggleSet<string>();
const expandedReasoning = useToggleSet<string>();
const collapsedSubagents = useToggleSet<string>();
const activeView = ref('chat');

const {
  fullResults,
  loadingResults,
  failedResults,
  loadFullResult: handleLoadFullResult,
  retryFullResult: handleRetryResult,
} = useToolResultLoader(() => store.sessionId);

// Shared derived data from turns
const { getSections, getArgsSummary, findToolCallIndex, totalToolCalls, totalDurationMs } =
  useConversationSections(() => store.turns);

// Auto-scroll
const scrollContainer = ref<HTMLElement | null>(null);
onMounted(() => {
  scrollContainer.value = document.querySelector('.page-content');
});
const { isLockedToBottom, showScrollToTop, hasOverflow, scrollToBottom, scrollToTop } =
  useAutoScroll({
    containerRef: scrollContainer,
    watchSource: () => store.turns,
    viewModeSource: () => activeView.value,
  });

// Scroll to a specific element when navigated from search.
// Tries event-level first (via ?event=N), falls back to turn-level (via ?turn=N).
// Uses IntersectionObserver so the highlight animation only starts once
// the element is actually visible (loading can take a while).
// Track timers and observers for cleanup on unmount
const activeTimers: ReturnType<typeof setTimeout>[] = [];
let activeObserver: IntersectionObserver | null = null;

function scrollAndHighlight(el: HTMLElement) {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  activeObserver?.disconnect();
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) {
        observer.disconnect();
        if (activeObserver === observer) activeObserver = null;
        el.classList.add('turn-highlight');
        const t = setTimeout(() => el.classList.remove('turn-highlight'), 4000);
        activeTimers.push(t);
      }
    },
    { threshold: 0.3 },
  );
  activeObserver = observer;
  observer.observe(el);
  const fallback = setTimeout(() => observer.disconnect(), 10000);
  activeTimers.push(fallback);
}

onBeforeUnmount(() => {
  activeObserver?.disconnect();
  for (const t of activeTimers) clearTimeout(t);
  activeTimers.length = 0;
});

function scrollToTarget(turnIndex: number, eventIndex: number | null) {
  if (eventIndex != null) {
    const eventEl = document.getElementById(`event-${eventIndex}`);
    if (eventEl) {
      scrollAndHighlight(eventEl);
      return;
    }
  }
  const turnEl = document.getElementById(`turn-${turnIndex}`);
  if (turnEl) scrollAndHighlight(turnEl);
}

// Watch for turns to load, then scroll to the target.
// Also re-scroll when query params change (e.g., clicking a different search result
// in the same session without the component remounting).
let lastScrolledKey: string | null = null;
watch(
  [() => store.turns.length, () => route.query.turn, () => route.query.event],
  ([len, turnParam, eventParam]) => {
    if (!turnParam || len === 0) return;
    const turnIndex = Number(turnParam);
    if (Number.isNaN(turnIndex)) return;
    const eventIndex = eventParam ? Number(eventParam) : null;
    const key = `${turnIndex}-${eventIndex}`;
    if (key === lastScrolledKey) return;
    if (!store.turns.some((t) => t.turnIndex === turnIndex)) return;
    lastScrolledKey = key;
    // Defer expansion to nextTick so useSessionTabLoader's onClear() runs first
    nextTick(() => {
      if (eventIndex != null) {
        if (!expandedTools.has(turnIndex)) expandedTools.toggle(turnIndex);
        const turn = store.turns.find((t) => t.turnIndex === turnIndex);
        if (turn) {
          const tc = turn.toolCalls.find((t) => t.eventIndex === eventIndex);
          if (tc) {
            if (tc.parentToolCallId) {
              const subKey = `${turnIndex}-${tc.parentToolCallId}`;
              if (collapsedSubagents.has(subKey)) collapsedSubagents.toggle(subKey);
            }
            const idx = findToolCallIndex(turn, tc);
            const detailKey = `${turnIndex}-${idx}`;
            if (!expandedToolDetails.has(detailKey)) expandedToolDetails.toggle(detailKey);
          }
        }
      }
      nextTick(() => scrollToTarget(turnIndex, eventIndex));
    });
  },
  { immediate: true },
);

const viewModes = [
  { value: 'chat', label: 'Chat' },
  { value: 'compact', label: 'Compact' },
  { value: 'timeline', label: 'Timeline' },
];

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadTurns(),
  {
    onClear() {
      expandedTools.clear();
      expandedToolDetails.clear();
      expandedReasoning.clear();
      collapsedSubagents.clear();
      lastScrolledKey = null;
    },
  },
);

/** Build prop object for ToolCallItem — eliminates repeated 10-prop bindings. */
function tcProps(
  turn: ConversationTurn,
  tc: TurnToolCall,
  prefix = '',
  variant: 'full' | 'compact' = 'full',
) {
  const idx = findToolCallIndex(turn, tc);
  const key = `${prefix}${turn.turnIndex}-${idx}`;
  return {
    tc,
    variant,
    argsSummary: getArgsSummary(turn.turnIndex, idx),
    expanded: expandedToolDetails.has(key),
    fullResult: tc.toolCallId ? fullResults.get(tc.toolCallId) : undefined,
    loadingFullResult: tc.toolCallId ? loadingResults.has(tc.toolCallId) : false,
    failedFullResult: tc.toolCallId ? failedResults.has(tc.toolCallId) : false,
    richEnabled: preferences.isRichRenderingEnabled(tc.toolName),
    _key: key,
  };
}

function toggleToolDetail(turn: ConversationTurn, tc: TurnToolCall, prefix = '') {
  const idx = findToolCallIndex(turn, tc);
  expandedToolDetails.toggle(`${prefix}${turn.turnIndex}-${idx}`);
}

// ── Session event helpers ──

import type { SessionEventSeverity } from '@tracepilot/types';

function severityVariant(severity: SessionEventSeverity): 'danger' | 'warning' | 'neutral' {
  if (severity === 'error') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'neutral';
}

function severityIcon(severity: SessionEventSeverity): string {
  if (severity === 'error') return '🔴';
  if (severity === 'warning') return '🟡';
  return 'ℹ️';
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  'session.error': 'Error',
  'session.warning': 'Warning',
  'session.compaction_start': 'Compaction',
  'session.compaction_complete': 'Compaction',
  'session.truncation': 'Truncation',
  'session.plan_changed': 'Plan',
  'session.mode_changed': 'Mode',
};

function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType.replace('session.', '');
}

function retryLoadTurns() {
  store.loaded.delete('turns');
  store.loadTurns();
}
</script>

<template>
  <div>
    <!-- Error alert for failed turn loading -->
    <ErrorAlert
      v-if="store.turnsError"
      :message="store.turnsError"
      variant="inline"
      :retryable="true"
      class="mb-4"
      @retry="retryLoadTurns"
    />

    <!-- Mini stat row -->
    <div class="grid-3 mb-4">
      <StatCard :value="store.turns.length" label="Turns" color="accent" mini />
      <StatCard :value="totalToolCalls" label="Tool Calls" color="accent" mini />
      <StatCard :value="formatDuration(totalDurationMs)" label="Total Time" color="done" mini />
    </div>

    <!-- View mode toggle -->
    <div class="flex items-center justify-between mb-4">
      <BtnGroup v-model="activeView" :options="viewModes" />
    </div>

    <EmptyState v-if="store.turns.length === 0 && !store.turnsError" message="No conversation turns found." />

    <!-- ═══════════════ CHAT VIEW ═══════════════ -->
    <div v-else-if="activeView === 'chat'" class="turn-group">
      <div v-for="turn in store.turns" :key="turn.turnIndex" :id="`turn-${turn.turnIndex}`" class="conversation-turn">
        <!-- User message -->
        <div v-if="turn.userMessage" :id="turn.eventIndex != null ? `event-${turn.eventIndex}` : undefined" class="turn-item">
          <div class="turn-avatar user">👤</div>
          <div class="turn-body">
            <div class="turn-header">
              <span class="turn-author">You</span>
              <span class="turn-meta">Turn {{ turn.turnIndex }}</span>
              <span v-if="turn.timestamp" class="turn-meta">{{ formatTime(turn.timestamp) }}</span>
            </div>
            <div class="turn-bubble user">
              <MarkdownContent :content="turn.userMessage" :render="preferences.isFeatureEnabled('renderMarkdown')" />
            </div>
          </div>
        </div>

        <!-- Agent-grouped content -->
        <template v-for="(section, sIdx) in getSections(turn.turnIndex)" :key="sIdx">
          <!-- ── Main Agent Section ── -->
          <template v-if="!section.agentId">
            <!-- Reasoning (main agent) -->
            <ReasoningBlock
              class="turn-reasoning"
              :reasoning="section.reasoning"
              :expanded="expandedReasoning.has(`${turn.turnIndex}-main-${sIdx}`)"
              @toggle="expandedReasoning.toggle(`${turn.turnIndex}-main-${sIdx}`)"
            />

            <!-- Assistant messages (main agent) -->
            <div v-for="(msg, idx) in section.messages.filter(m => m.trim())" :key="`main-msg-${idx}`" class="turn-item">
              <div class="turn-avatar assistant">🤖</div>
              <div class="turn-body">
                <div class="turn-header">
                  <span class="turn-author">Copilot</span>
                  <Badge v-if="turn.model" variant="done" style="font-size: 0.625rem; padding: 1px 6px;">{{ turn.model }}</Badge>
                  <span v-if="turn.durationMs" class="turn-meta">{{ formatDuration(turn.durationMs) }}</span>
                  <span v-if="turn.endTimestamp || turn.timestamp" class="turn-meta">{{ formatTime(turn.endTimestamp ?? turn.timestamp) }}</span>
                  <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
                </div>
                <div class="turn-bubble assistant">
                  <MarkdownContent :content="msg" :render="preferences.isFeatureEnabled('renderMarkdown')" />
                </div>
              </div>
            </div>

            <!-- Tool calls (main agent — includes subagent launch calls) -->
            <div v-if="section.toolCalls.length > 0" class="turn-tool-calls">
              <div class="tool-calls-container">
                <button
                  class="tool-call-header w-full"
                  :aria-expanded="expandedTools.has(turn.turnIndex)"
                  @click="expandedTools.toggle(turn.turnIndex)"
                >
                  <ExpandChevron :expanded="expandedTools.has(turn.turnIndex)" />
                  <span>{{ section.toolCalls.length }} tool call{{ section.toolCalls.length !== 1 ? "s" : "" }}</span>
                  <span style="margin-left: auto; display: flex; gap: 6px;">
                    <span class="tool-summary-badge tool-summary-pass">
                      {{ section.toolCalls.filter((tc) => tc.success === true).length }} passed
                    </span>
                    <span
                      v-if="section.toolCalls.some((tc) => tc.success === false)"
                      class="tool-summary-badge tool-summary-fail"
                    >
                      {{ section.toolCalls.filter((tc) => tc.success === false).length }} failed
                    </span>
                  </span>
                </button>

                <div v-if="expandedTools.has(turn.turnIndex)">
                  <ToolCallItem
                    v-for="tc in section.toolCalls"
                    :id="tc.eventIndex != null ? `event-${tc.eventIndex}` : undefined"
                    :key="tc.toolCallId ?? tc.toolName"
                    v-bind="tcProps(turn, tc)"
                    @toggle="toggleToolDetail(turn, tc)"
                    @load-full-result="handleLoadFullResult"
                    @retry-full-result="handleRetryResult"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- ── Subagent Section ── -->
          <div
            v-else
            :id="`subagent-${turn.turnIndex}-${section.agentId}`"
            class="subagent-block"
            :style="{ '--agent-border-color': getAgentColor(section.agentType) }"
          >
            <button
              class="subagent-header"
              :aria-expanded="!collapsedSubagents.has(`${turn.turnIndex}-${section.agentId}`)"
              @click="collapsedSubagents.toggle(`${turn.turnIndex}-${section.agentId}`)"
            >
              <ExpandChevron :expanded="!collapsedSubagents.has(`${turn.turnIndex}-${section.agentId}`)" />
              <AgentBadge
                :agent-name="section.agentDisplayName"
                :agent-type="section.agentType"
                :model="section.model"
                :status="section.status"
              />
              <span v-if="section.durationMs" class="turn-meta">{{ formatDuration(section.durationMs) }}</span>
              <span v-if="section.toolCalls.length" class="turn-meta">
                · {{ section.toolCalls.length }} tool{{ section.toolCalls.length !== 1 ? 's' : '' }}
              </span>
            </button>

            <div v-if="!collapsedSubagents.has(`${turn.turnIndex}-${section.agentId}`)" class="subagent-content">
              <!-- Subagent reasoning -->
              <ReasoningBlock
                class="turn-reasoning"
                :reasoning="section.reasoning"
                :expanded="expandedReasoning.has(`${turn.turnIndex}-${section.agentId}`)"
                @toggle="expandedReasoning.toggle(`${turn.turnIndex}-${section.agentId}`)"
              />

              <!-- Subagent messages -->
              <div v-for="(msg, idx) in section.messages.filter(m => m.trim())" :key="`sub-msg-${idx}`" class="turn-item subagent-message">
                <div class="turn-avatar assistant" :style="{ fontSize: '0.9rem' }">
                  {{ section.agentType === 'explore' ? '🔍' : section.agentType === 'code-review' ? '🔎' : section.agentType === 'general-purpose' ? '🛠️' : '📋' }}
                </div>
                <div class="turn-body">
                  <div class="turn-header">
                    <span class="turn-author" :style="{ color: getAgentColor(section.agentType) }">{{ section.agentDisplayName }}</span>
                    <Badge v-if="section.model" variant="done" style="font-size: 0.625rem; padding: 1px 6px;">{{ section.model }}</Badge>
                  </div>
                  <div class="turn-bubble assistant">
                  <MarkdownContent :content="msg" :render="preferences.isFeatureEnabled('renderMarkdown')" />
                </div>
                </div>
              </div>

              <!-- Subagent tool calls -->
              <div v-if="section.toolCalls.length > 0" style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px;">
                <ToolCallItem
                  v-for="tc in section.toolCalls"
                  :id="tc.eventIndex != null ? `event-${tc.eventIndex}` : undefined"
                  :key="tc.toolCallId ?? tc.toolName"
                  v-bind="tcProps(turn, tc, '', 'compact')"
                  @toggle="toggleToolDetail(turn, tc)"
                  @load-full-result="handleLoadFullResult"
                  @retry-full-result="handleRetryResult"
                />
              </div>

              <!-- Empty state for subagents with no captured content -->
              <div
                v-if="section.messages.filter(m => m.trim()).length === 0 && section.reasoning.length === 0 && section.toolCalls.length === 0"
                class="subagent-empty"
              >
                No content captured for this subagent
              </div>
            </div>
          </div>
        </template>

        <!-- Session events (errors, compactions, etc.) -->
        <div v-if="turn.sessionEvents?.length" class="session-events-list">
          <div v-for="(se, seIdx) in turn.sessionEvents" :key="seIdx" class="session-event-row" :class="`session-event-${se.severity}`">
            <Badge :variant="severityVariant(se.severity)" size="sm">{{ severityIcon(se.severity) }} {{ eventTypeLabel(se.eventType) }}</Badge>
            <span class="session-event-summary">{{ se.summary }}</span>
            <span v-if="se.timestamp" class="turn-meta">{{ formatTime(se.timestamp) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════ COMPACT VIEW ═══════════════ -->
    <div v-else-if="activeView === 'compact'" class="turn-group">
      <template v-for="turn in store.turns" :key="turn.turnIndex">
        <div v-if="turn.userMessage" :id="turn.eventIndex != null ? `event-${turn.eventIndex}` : `turn-${turn.turnIndex}`" class="compact-turn-user">
          <span class="compact-turn-label-prefix user">👤 User</span>
          <div class="compact-turn-user-text">{{ truncateText(turn.userMessage, 300) }}</div>
        </div>
        <div class="compact-turn">
        <div class="compact-turn-header">
          <span class="turn-meta" style="font-weight: 700; color: var(--accent-fg);">Turn {{ turn.turnIndex }}</span>
          <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
          <span v-if="turn.durationMs" class="turn-meta">{{ formatDuration(turn.durationMs) }}</span>
          <span v-if="turn.timestamp" class="turn-meta">{{ formatTime(turn.timestamp) }}</span>
          <span v-if="turn.outputTokens" class="token-badge">🪙 {{ formatNumber(turn.outputTokens) }}</span>
          <span v-if="turn.toolCalls.length" style="margin-left: auto;" class="turn-meta">
            {{ turn.toolCalls.length }} tool{{ turn.toolCalls.length !== 1 ? "s" : "" }}
          </span>
          <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
        </div>

        <div class="compact-turn-body">
          <!-- Agent-grouped messages in compact view -->
          <template v-for="(section, sIdx) in getSections(turn.turnIndex)" :key="`compact-s-${sIdx}`">
            <div v-for="(msg, idx) in section.messages.filter(m => m.trim())" :key="`compact-msg-${sIdx}-${idx}`" class="compact-turn-label">
              <span class="compact-turn-label-prefix assistant">
                <span
                  v-if="section.agentId"
                  class="compact-agent-dot"
                  :style="{ backgroundColor: getAgentColor(section.agentType) }"
                  :title="section.agentDisplayName"
                />
                {{ section.agentId ? section.agentDisplayName + ':' : 'Copilot:' }}
              </span>
              {{ truncateText(msg, 300) }}
            </div>
          </template>

          <!-- Tool pills grouped by agent -->
          <template v-for="(section, sIdx) in getSections(turn.turnIndex)" :key="`pills-${sIdx}`">
            <div v-if="section.toolCalls.length > 0" class="compact-tool-pills">
              <AgentBadge
                v-if="section.agentId"
                :agent-name="section.agentDisplayName"
                :agent-type="section.agentType"
                :status="section.status"
                compact
              />
              <button
                v-for="tc in section.toolCalls"
                :id="tc.eventIndex != null ? `event-${tc.eventIndex}` : undefined"
                :key="tc.toolCallId ?? tc.toolName"
                class="compact-tool-pill"
                :class="{
                  failed: tc.success === false,
                  unknown: tc.success == null,
                }"
                :style="section.agentId ? { borderLeft: `3px solid ${getAgentColor(section.agentType)}` } : {}"
                :aria-expanded="expandedToolDetails.has(`compact-${turn.turnIndex}-${findToolCallIndex(turn, tc)}`)"
                :title="section.agentId ? `${section.agentDisplayName} → ${tc.toolName}` : tc.toolName"
                @click="expandedToolDetails.toggle(`compact-${turn.turnIndex}-${findToolCallIndex(turn, tc)}`)"
              >
                {{ toolIcon(tc.toolName) }} {{ tc.toolName }}
                <span v-if="tc.durationMs" class="turn-meta">{{ formatDuration(tc.durationMs) }}</span>
              </button>
            </div>
          </template>

          <!-- Expanded tool detail (compact view) -->
          <template v-for="(tc, tcIdx) in turn.toolCalls" :key="`detail-${tcIdx}`">
            <div v-if="expandedToolDetails.has(`compact-${turn.turnIndex}-${tcIdx}`)" class="tool-calls-container" style="margin-top: 4px;">
              <div class="tool-call-header">
                <span>{{ toolIcon(tc.toolName) }}</span>
                <span class="tool-call-name" :class="categoryColor(toolCategory(tc.toolName))">{{ tc.toolName }}</span>
                <span v-if="getArgsSummary(turn.turnIndex, tcIdx)" class="tool-call-args" style="font-family: var(--font-mono, monospace);">{{ getArgsSummary(turn.turnIndex, tcIdx) }}</span>
              </div>
              <ToolCallDetail
                :tc="tc"
                :show-metadata="false"
                :full-result="tc.toolCallId ? fullResults.get(tc.toolCallId) : undefined"
                :loading-full-result="tc.toolCallId ? loadingResults.has(tc.toolCallId) : false"
                :rich-enabled="preferences.isRichRenderingEnabled(tc.toolName)"
                @load-full-result="handleLoadFullResult"
              />
            </div>
          </template>

          <!-- Session events (compact) -->
          <div v-if="turn.sessionEvents?.length" class="session-events-list compact">
            <div v-for="(se, seIdx) in turn.sessionEvents" :key="seIdx" class="session-event-row" :class="`session-event-${se.severity}`">
              <Badge :variant="severityVariant(se.severity)" size="sm">{{ severityIcon(se.severity) }} {{ eventTypeLabel(se.eventType) }}</Badge>
              <span class="session-event-summary">{{ se.summary }}</span>
            </div>
          </div>
        </div>
        </div>
      </template>
    </div>

    <!-- ═══════════════ TIMELINE VIEW ═══════════════ -->
    <div v-else-if="activeView === 'timeline'" class="timeline-view">
      <div v-for="(turn, turnIdx) in store.turns" :key="turn.turnIndex" :id="`turn-${turn.turnIndex}`" class="timeline-turn">
        <div v-if="turnIdx < store.turns.length - 1" class="timeline-connector" />
        <div class="timeline-marker">{{ turn.turnIndex }}</div>

        <div class="timeline-turn-body">
          <div class="timeline-meta">
            <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
            <span v-if="turn.durationMs" class="turn-meta">{{ formatDuration(turn.durationMs) }}</span>
            <span v-if="turn.outputTokens" class="token-badge">🪙 {{ formatNumber(turn.outputTokens) }}</span>
            <span v-if="turn.timestamp" class="turn-meta">{{ formatTime(turn.timestamp) }}</span>
            <span v-if="turn.toolCalls.length" class="turn-meta">· {{ turn.toolCalls.length }} tools</span>
            <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
          </div>

          <div v-if="turn.userMessage" class="timeline-block user">
            <div class="timeline-block-label user">User</div>
            <div class="timeline-block-text">{{ truncateText(turn.userMessage, 500) }}</div>
          </div>

          <!-- Agent-grouped content in timeline -->
          <template v-for="(section, sIdx) in getSections(turn.turnIndex)" :key="`tl-s-${sIdx}`">
            <!-- Reasoning -->
            <ReasoningBlock
              :reasoning="section.reasoning"
              :expanded="expandedReasoning.has(`tl-${turn.turnIndex}-${section.agentId ?? 'main'}`)"
              @toggle="expandedReasoning.toggle(`tl-${turn.turnIndex}-${section.agentId ?? 'main'}`)"
            >
              <template v-if="section.agentId" #prefix>
                <AgentBadge :agent-name="section.agentDisplayName" :agent-type="section.agentType" compact />
              </template>
            </ReasoningBlock>

            <!-- Tool calls with agent context -->
            <div v-if="section.toolCalls.length > 0">
              <!-- Subagent separator -->
              <div v-if="section.agentId" class="timeline-agent-separator">
                <AgentBadge
                  :agent-name="section.agentDisplayName"
                  :agent-type="section.agentType"
                  :model="section.model"
                  :status="section.status"
                />
                <span v-if="section.durationMs" class="turn-meta">{{ formatDuration(section.durationMs) }}</span>
              </div>
              <div :style="section.agentId ? { paddingLeft: '12px', borderLeft: `2px solid color-mix(in srgb, ${getAgentColor(section.agentType)} 25%, transparent)` } : {}" style="display: flex; flex-direction: column; gap: 6px;">
                <ToolCallItem
                  v-for="tc in section.toolCalls"
                  :id="tc.eventIndex != null ? `event-${tc.eventIndex}` : undefined"
                  :key="tc.toolCallId ?? tc.toolName"
                  v-bind="tcProps(turn, tc, 'tl-', 'compact')"
                  @toggle="toggleToolDetail(turn, tc, 'tl-')"
                  @load-full-result="handleLoadFullResult"
                  @retry-full-result="handleRetryResult"
                />
              </div>
            </div>

            <!-- Assistant messages with agent attribution -->
            <div v-for="(msg, idx) in section.messages.filter(m => m.trim())" :key="`tl-msg-${sIdx}-${idx}`" class="timeline-block assistant">
              <div class="timeline-block-label assistant">
                <AgentBadge v-if="section.agentId" :agent-name="section.agentDisplayName" :agent-type="section.agentType" compact />
                <template v-else>Copilot</template>
              </div>
              <div class="timeline-block-text">{{ truncateText(msg, 500) }}</div>
            </div>
          </template>

          <!-- Session events (timeline) -->
          <div v-if="turn.sessionEvents?.length" class="session-events-list">
            <div v-for="(se, seIdx) in turn.sessionEvents" :key="seIdx" class="session-event-row" :class="`session-event-${se.severity}`">
              <Badge :variant="severityVariant(se.severity)" size="sm">{{ severityIcon(se.severity) }} {{ eventTypeLabel(se.eventType) }}</Badge>
              <span class="session-event-summary">{{ se.summary }}</span>
              <span v-if="se.timestamp" class="turn-meta">{{ formatTime(se.timestamp) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Floating scroll buttons -->
    <Transition name="fab">
      <div v-if="hasOverflow && (!isLockedToBottom || showScrollToTop)" class="scroll-fab-group">
        <button
          v-if="showScrollToTop"
          class="scroll-fab"
          aria-label="Scroll to top"
          title="Jump to top"
          @click="scrollToTop()"
        >
          ↑
        </button>
        <button
          v-if="!isLockedToBottom"
          class="scroll-fab scroll-fab--primary"
          aria-label="Scroll to bottom"
          title="Jump to bottom"
          @click="scrollToBottom()"
        >
          ↓
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Highlight animation for scroll-to-turn from search deep-links */
.turn-highlight {
  animation: turn-flash 4s ease-out;
}
@keyframes turn-flash {
  0%, 30% { box-shadow: 0 0 0 3px var(--accent-emphasis); background: color-mix(in srgb, var(--accent-emphasis) 8%, transparent); }
  100% { box-shadow: 0 0 0 0 transparent; background: transparent; }
}

.subagent-block {
  margin: 8px 0 8px 24px;
  border-left: 3px solid var(--agent-border-color, var(--accent-emphasis));
  border-radius: 0 8px 8px 0;
  background: color-mix(in srgb, var(--agent-border-color) 4%, var(--canvas-subtle));
  overflow: hidden;
}

.subagent-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.subagent-header:hover {
  background: color-mix(in srgb, var(--agent-border-color) 8%, transparent);
}

.subagent-content {
  padding: 4px 12px 12px;
}

.subagent-empty {
  padding: 8px 12px;
  font-size: 0.75rem;
  opacity: 0.5;
  font-style: italic;
}

.subagent-message .turn-avatar {
  width: 28px;
  height: 28px;
  min-width: 28px;
  font-size: 0.85rem;
}

.compact-agent-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}

.timeline-agent-separator {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 4px;
}

/* Floating scroll buttons */
.scroll-fab-group {
  position: fixed;
  bottom: 28px;
  right: 28px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: var(--z-fab, 55);
}

.scroll-fab {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border-default);
  background: var(--canvas-overlay);
  color: var(--text-secondary);
  font-size: 1.125rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(8px);
}

.scroll-fab:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
  border-color: var(--border-accent);
}

.scroll-fab:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}

.scroll-fab--primary {
  background: var(--accent-emphasis);
  color: white;
  border-color: transparent;
}

.scroll-fab--primary:hover {
  opacity: 0.9;
  box-shadow: var(--shadow-glow-accent);
}

/* FAB group transition */
.fab-enter-active,
.fab-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: scale(0.8) translateY(8px);
}

/* ── Session events ─────────────────────────────── */
.session-events-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 0 2px 48px;
}
.session-events-list.compact {
  margin-left: 0;
  margin-top: 8px;
}
.session-event-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.8rem;
  border-left: 3px solid transparent;
}
.session-event-error {
  background: color-mix(in srgb, var(--danger-fg, #f87171) 8%, transparent);
  border-left-color: var(--danger-fg, #f87171);
}
.session-event-warning {
  background: color-mix(in srgb, var(--warning-fg, #fbbf24) 8%, transparent);
  border-left-color: var(--warning-fg, #fbbf24);
}
.session-event-info {
  background: color-mix(in srgb, var(--accent-fg, #60a5fa) 6%, transparent);
  border-left-color: var(--accent-fg, #60a5fa);
}
.session-event-summary {
  flex: 1;
  color: var(--fg-secondary, #a0a0a0);
}

/* ── Compact view: distinct user message container ─ */
.compact-turn-user {
  background: var(--accent-subtle);
  border: 1px solid var(--accent-muted);
  border-left: 3px solid var(--accent-fg);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  font-size: 0.8125rem;
  color: var(--text-primary);
  line-height: 1.5;
}
.compact-turn-user .compact-turn-label-prefix {
  display: block;
  font-size: 0.6875rem;
  margin-bottom: 4px;
  color: var(--accent-fg);
}
.compact-turn-user-text {
  white-space: pre-wrap;
}
</style>
