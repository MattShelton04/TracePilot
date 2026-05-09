<script setup lang="ts">
/**
 * ConversationTurnList — pure rendering surface for the conversation timeline
 * in `compact` and `timeline` view modes. Pulled out of `ConversationTab.vue`
 * during the B2-D2 decomposition.
 *
 * Chat view stays in `ChatViewMode.vue`; this component only renders the two
 * non-chat layouts. Deep-link scroll, route watching, and the
 * `useToolResultLoader` cache live in the parent — those are passed in as
 * props so the loader's in-memory cache outlives any conditional re-mount of
 * this component.
 *
 * Per-turn highlight (`.turn-highlight`) is added by the parent via the
 * deep-link composable's DOM mutation. The matching style rule is kept here
 * (rather than in the parent's scoped style) so the scope hash matches the
 * DOM nodes that actually receive the class.
 */
import type { ConversationTurn, SessionEventSeverity, TurnToolCall } from "@tracepilot/types";
import {
  AgentBadge,
  Badge,
  type ConversationSectionsReturn,
  categoryColor,
  formatDuration,
  formatNumber,
  formatTime,
  getAgentColor,
  ReasoningBlock,
  ToolCallDetail,
  ToolCallItem,
  toolCategory,
  toolIcon,
  truncateText,
} from "@tracepilot/ui";
import { Coins, User } from "lucide-vue-next";

interface ToggleSetLike<T> {
  has: (value: T) => boolean;
  toggle: (value: T) => void;
}

const props = defineProps<{
  turns: readonly ConversationTurn[];
  viewMode: "compact" | "timeline";
  getSections: ConversationSectionsReturn["getSections"];
  getArgsSummary: ConversationSectionsReturn["getArgsSummary"];
  findToolCallIndex: ConversationSectionsReturn["findToolCallIndex"];
  expandedToolDetails: ToggleSetLike<string>;
  expandedReasoning: ToggleSetLike<string>;
  fullResults: ReadonlyMap<string, string>;
  loadingResults: ReadonlySet<string>;
  failedResults: ReadonlySet<string>;
  richEnabledFor: (toolName: string) => boolean;
}>();

const emit = defineEmits<{
  (e: "load-full-result", toolCallId: string): void;
  (e: "retry-full-result", toolCallId: string): void;
}>();

function tcProps(
  turn: ConversationTurn,
  tc: TurnToolCall,
  prefix = "",
  variant: "full" | "compact" = "full",
) {
  const idx = props.findToolCallIndex(turn, tc);
  const key = `${prefix}${turn.turnIndex}-${idx}`;
  return {
    tc,
    variant,
    argsSummary: props.getArgsSummary(turn.turnIndex, idx),
    expanded: props.expandedToolDetails.has(key),
    fullResult: tc.toolCallId ? props.fullResults.get(tc.toolCallId) : undefined,
    loadingFullResult: tc.toolCallId ? props.loadingResults.has(tc.toolCallId) : false,
    failedFullResult: tc.toolCallId ? props.failedResults.has(tc.toolCallId) : false,
    richEnabled: props.richEnabledFor(tc.toolName),
    _key: key,
  };
}

function toggleToolDetail(turn: ConversationTurn, tc: TurnToolCall, prefix = "") {
  const idx = props.findToolCallIndex(turn, tc);
  props.expandedToolDetails.toggle(`${prefix}${turn.turnIndex}-${idx}`);
}

function severityVariant(severity: SessionEventSeverity): "danger" | "warning" | "neutral" {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}

function severityIcon(severity: SessionEventSeverity): string {
  if (severity === "error") return "🔴";
  if (severity === "warning") return "🟡";
  return "ℹ️";
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  "session.error": "Error",
  "session.warning": "Warning",
  "session.compaction_start": "Compaction",
  "session.compaction_complete": "Compaction",
  "session.truncation": "Truncation",
  "session.plan_changed": "Plan",
  "session.mode_changed": "Mode",
};

function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType.replace("session.", "");
}

function onLoadFullResult(toolCallId: string) {
  emit("load-full-result", toolCallId);
}

function onRetryFullResult(toolCallId: string) {
  emit("retry-full-result", toolCallId);
}
</script>

<template>
  <!-- ═══════════════ COMPACT VIEW ═══════════════ -->
  <div v-if="viewMode === 'compact'" class="turn-group">
    <template v-for="turn in turns" :key="turn.turnIndex">
      <div v-if="turn.userMessage" :data-event-idx="turn.eventIndex != null ? turn.eventIndex : undefined" :data-turn-idx="turn.eventIndex == null ? turn.turnIndex : undefined" class="compact-turn-user">
        <span class="compact-turn-label-prefix user"><User :size="14" aria-hidden="true" /> User</span>
        <div class="compact-turn-user-text">{{ truncateText(turn.userMessage, 300) }}</div>
      </div>
      <div class="compact-turn">
      <div class="compact-turn-header">
        <span class="turn-meta" style="font-weight: 700; color: var(--accent-fg);">Turn {{ turn.turnIndex }}</span>
        <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
        <span v-if="turn.durationMs" class="turn-meta">{{ formatDuration(turn.durationMs) }}</span>
        <span v-if="turn.timestamp" class="turn-meta">{{ formatTime(turn.timestamp) }}</span>
        <span v-if="turn.outputTokens" class="token-badge"><Coins :size="12" aria-hidden="true" /> {{ formatNumber(turn.outputTokens) }}</span>
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
              :data-event-idx="tc.eventIndex != null ? tc.eventIndex : undefined"
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
              :rich-enabled="richEnabledFor(tc.toolName)"
              @load-full-result="onLoadFullResult"
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
  <div v-else-if="viewMode === 'timeline'" class="timeline-view">
    <div v-for="(turn, turnIdx) in turns" :key="turn.turnIndex" :data-turn-idx="turn.turnIndex" class="timeline-turn">
      <div v-if="turnIdx < turns.length - 1" class="timeline-connector" />
      <div class="timeline-marker">{{ turn.turnIndex }}</div>

      <div class="timeline-turn-body">
        <div class="timeline-meta">
          <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
          <span v-if="turn.durationMs" class="turn-meta">{{ formatDuration(turn.durationMs) }}</span>
          <span v-if="turn.outputTokens" class="token-badge"><Coins :size="12" aria-hidden="true" /> {{ formatNumber(turn.outputTokens) }}</span>
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
                :data-event-idx="tc.eventIndex != null ? tc.eventIndex : undefined"
                :key="tc.toolCallId ?? tc.toolName"
                v-bind="tcProps(turn, tc, 'tl-', 'compact')"
                @toggle="toggleToolDetail(turn, tc, 'tl-')"
                @load-full-result="onLoadFullResult"
                @retry-full-result="onRetryFullResult"
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
</template>

<style scoped>
/*
 * Highlight animation for scroll-to-turn from search deep-links.
 *
 * The class is added at runtime by `useConversationDeepLinkScroll` (via
 * `el.classList.add("turn-highlight")`) on a DOM node owned by *this*
 * component's template, so the rule must live in this component's scoped
 * <style> for the scope hash to match. It used to live on the parent
 * before B2-D2 — see Finding B2 / scoped-CSS isolation memory.
 */
.turn-highlight {
  animation: turn-flash 4s ease-out;
}
@keyframes turn-flash {
  0%, 30% { box-shadow: 0 0 0 3px var(--accent-emphasis); background: color-mix(in srgb, var(--accent-emphasis) 8%, transparent); }
  100% { box-shadow: 0 0 0 0 transparent; background: transparent; }
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
  background: color-mix(in srgb, var(--danger-fg) 8%, transparent);
  border-left-color: var(--danger-fg);
}
.session-event-warning {
  background: color-mix(in srgb, var(--warning-fg) 8%, transparent);
  border-left-color: var(--warning-fg);
}
.session-event-info {
  background: color-mix(in srgb, var(--accent-fg) 6%, transparent);
  border-left-color: var(--accent-fg);
}
.session-event-summary {
  flex: 1;
  color: var(--text-secondary);
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
