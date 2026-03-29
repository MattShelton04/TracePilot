<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import type { ConversationTurn, TurnToolCall, SessionEventSeverity } from "@tracepilot/types";
import {
  formatDuration,
  formatTime,
  formatNumber,
  truncateText,
  toolIcon,
  formatArgsSummary,
  ReasoningBlock,
  MarkdownContent,
  ToolCallItem,
  useConversationSections,
  useToggleSet,
  getAgentColor,
  getAgentIcon,
  inferAgentTypeFromToolCall,
} from "@tracepilot/ui";
import { useCrossTurnSubagents } from "@/composables/useCrossTurnSubagents";
import { useSubagentPanel } from "@/composables/useSubagentPanel";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import SubagentCard from "./SubagentCard.vue";
import SubagentPanel from "./SubagentPanel.vue";
import {
  segmentToolCalls,
  getMainReasoning,
  getMainMessages,
  MAX_VISIBLE_TOOLS,
  COLLAPSE_THRESHOLD,
  countRegularTools,
  getCollapsedToolNames,
  type ToolSegment,
  type ToolGroupItem,
} from "./chatViewUtils";

// ─── Store & Route ────────────────────────────────────────────────

const store = useSessionDetailStore();
const preferences = usePreferencesStore();
const route = useRoute();
const turns = computed(() => store.turns);
const renderMd = computed(() => preferences.isFeatureEnabled("renderMarkdown"));

// ─── Cross-turn subagent data ─────────────────────────────────────

const { subagentMap, allSubagents } = useCrossTurnSubagents(turns);

// ─── Panel state ──────────────────────────────────────────────────

const panel = useSubagentPanel(allSubagents);

// ─── Disclosure state ─────────────────────────────────────────────

const expandedReasoning = useToggleSet<string>();
const expandedGroups = useToggleSet<string>();
const expandedToolDetails = useToggleSet<string>();

// ─── Tool result loader ───────────────────────────────────────────

const { fullResults, loadingResults, failedResults, loadFullResult: handleLoadFullResult, retryFullResult: handleRetryResult } = useToolResultLoader(
  () => store.sessionId
);

// ─── Conversation sections (for tool call index) ─────────────────

const { findToolCallIndex, getArgsSummary } = useConversationSections(() => store.turns);

// ─── Scroll ───────────────────────────────────────────────────────

const scrollEl = ref<HTMLElement | null>(null);
const cvRootEl = ref<HTMLElement | null>(null);

// ─── Panel top offset (fixed position below sticky action bar) ────

const panelTopPx = ref(0);
let pageScrollEl: HTMLElement | null = null;

function updatePanelTop() {
  const cvRect = cvRootEl.value?.getBoundingClientRect();
  if (!cvRect) return;

  // Find the sticky action bar (.detail-actions) — it sticks at top of scroll area
  const actionsEl = document.querySelector('.detail-actions') as HTMLElement | null;
  const actionsBottom = actionsEl ? actionsEl.getBoundingClientRect().bottom : 0;

  // Panel top = whichever is lower: cv-root top or sticky bar bottom
  panelTopPx.value = Math.max(cvRect.top, actionsBottom);
}

onMounted(() => {
  updatePanelTop();
  window.addEventListener("resize", updatePanelTop);
  // Listen to scroll on the page-content container (the page scroller)
  pageScrollEl = cvRootEl.value?.closest('.page-content') as HTMLElement | null;
  if (pageScrollEl) {
    pageScrollEl.addEventListener("scroll", updatePanelTop, { passive: true });
  }
});

onUnmounted(() => {
  window.removeEventListener("resize", updatePanelTop);
  if (pageScrollEl) {
    pageScrollEl.removeEventListener("scroll", updatePanelTop);
  }
});

// ─── Computed helpers ─────────────────────────────────────────────

function showGap(turn: ConversationTurn, ti: number): boolean {
  if (ti === 0) return false;
  return turn.turnIndex - turns.value[ti - 1].turnIndex > 1;
}

function gapCount(turn: ConversationTurn, ti: number): number {
  return turn.turnIndex - turns.value[ti - 1].turnIndex - 1;
}

function userEventId(turn: ConversationTurn): string | undefined {
  return turn.eventIndex != null ? `event-${turn.eventIndex}` : undefined;
}

function mainReasoningForTurn(turn: ConversationTurn): string[] {
  return getMainReasoning(turn);
}

function mainMessagesForTurn(turn: ConversationTurn) {
  return getMainMessages(turn);
}

function toolSegmentsForTurn(turn: ConversationTurn): ToolSegment[] {
  return segmentToolCalls(turn.toolCalls);
}

function severityClass(severity: SessionEventSeverity): string {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

function severityIcon(severity: SessionEventSeverity): string {
  if (severity === "error") return "⚠️";
  if (severity === "warning") return "⚠️";
  return "ℹ️";
}

// ─── Progressive disclosure ───────────────────────────────────────

function shouldCollapse(items: ToolGroupItem[]): boolean {
  return countRegularTools(items) > MAX_VISIBLE_TOOLS + COLLAPSE_THRESHOLD;
}

function isItemVisible(
  item: ToolGroupItem,
  items: ToolGroupItem[],
  itemIndex: number,
  groupKey: string,
): boolean {
  // Pills (intent, memory, ask-user) are always visible
  if (item.type !== "tool") return true;
  // If group is expanded, everything visible
  if (expandedGroups.has(groupKey)) return true;
  // If no collapse needed, everything visible
  if (!shouldCollapse(items)) return true;
  // Count regular tools up to this index
  let toolIdx = 0;
  for (let i = 0; i <= itemIndex; i++) {
    if (items[i].type === "tool") toolIdx++;
  }
  return toolIdx <= MAX_VISIBLE_TOOLS;
}

function hiddenToolCount(items: ToolGroupItem[]): number {
  return countRegularTools(items) - MAX_VISIBLE_TOOLS;
}

// ─── Intent/memory pill helpers ───────────────────────────────────

function intentLabel(tc: TurnToolCall): string {
  const args = tc.arguments as Record<string, unknown> | undefined;
  return (args?.intent as string) ?? "…";
}

function memoryLabel(tc: TurnToolCall): string {
  const args = tc.arguments as Record<string, unknown> | undefined;
  return (args?.fact as string) ?? (args?.subject as string) ?? "…";
}

// ─── ToolCallItem helpers ─────────────────────────────────────────

function tcProps(turn: ConversationTurn, tc: TurnToolCall) {
  const idx = findToolCallIndex(turn, tc);
  const key = `${turn.turnIndex}-${idx}`;
  return {
    tc,
    variant: "compact" as const,
    argsSummary: getArgsSummary(turn.turnIndex, idx),
    expanded: expandedToolDetails.has(key),
    fullResult: tc.toolCallId ? fullResults.get(tc.toolCallId) : undefined,
    loadingFullResult: tc.toolCallId ? loadingResults.has(tc.toolCallId) : false,
    failedFullResult: tc.toolCallId ? failedResults.has(tc.toolCallId) : false,
    richEnabled: preferences.isRichRenderingEnabled(tc.toolName),
  };
}

function toggleToolDetail(turn: ConversationTurn, tc: TurnToolCall) {
  const idx = findToolCallIndex(turn, tc);
  expandedToolDetails.toggle(`${turn.turnIndex}-${idx}`);
}

// ─── Subagent turn colors ─────────────────────────────────────────

/** Map turnIndex → agent color for turns that have subagent-owned content */
const subagentTurnColors = computed(() => {
  const map = new Map<number, string>();
  for (const sa of allSubagents.value) {
    const color = getAgentColor(inferAgentTypeFromToolCall(sa.toolCall));
    // The launch turn
    map.set(sa.turnIndex, color);
    // Any turns where child tools appear
    for (const ct of sa.childTools) {
      const turn = turns.value.find(t => t.toolCalls.some(tc => tc.toolCallId === ct.toolCallId));
      if (turn) map.set(turn.turnIndex, color);
    }
  }
  return map;
});

// ─── Deep-link: revealEvent ───────────────────────────────────────

/**
 * Resolve an eventIndex to its owning subagent (if it's a child tool call).
 * Returns the subagent's toolCallId, or null if the event is not a child.
 */
function findOwningSubagent(turnIndex: number, eventIndex: number): string | null {
  const turn = turns.value.find(t => t.turnIndex === turnIndex);
  if (!turn) return null;
  const tc = turn.toolCalls.find(t => t.eventIndex === eventIndex);
  if (!tc) return null;
  // If this IS a subagent launch, return its own toolCallId
  if (tc.isSubagent && tc.toolCallId) return tc.toolCallId;
  // If this is a child tool call, return its parent
  if (tc.parentToolCallId && subagentMap.value.has(tc.parentToolCallId)) {
    return tc.parentToolCallId;
  }
  return null;
}

function revealEvent(turnIndex: number, eventIndex?: number) {
  const elId = eventIndex != null ? `event-${eventIndex}` : `turn-${turnIndex}`;
  let el = document.getElementById(elId);

  // If event not in DOM, check if it belongs to a subagent and open the panel
  if (!el && eventIndex != null) {
    const agentId = findOwningSubagent(turnIndex, eventIndex);
    if (agentId) {
      panel.selectSubagent(agentId);
      // Scroll to the subagent card wrapper instead
      const cardEl = document.querySelector(`[data-agent-id="${agentId}"]`) as HTMLElement | null;
      if (cardEl) el = cardEl;
    }
  }

  if (!el) {
    // Final fallback: scroll to the turn block
    el = document.getElementById(`turn-${turnIndex}`);
    if (!el) return;
  }

  // If the element is inside a collapsed group, expand it
  const collapsedParent = el.closest("[data-collapse-key]") as HTMLElement | null;
  if (collapsedParent) {
    const key = collapsedParent.dataset.collapseKey;
    if (key && !expandedGroups.has(key)) {
      expandedGroups.toggle(key);
    }
  }

  // If tool call belongs to a subagent, open the panel
  const agentEl = el.closest("[data-agent-id]") as HTMLElement | null;
  if (agentEl) {
    const agentId = agentEl.dataset.agentId;
    if (agentId) {
      panel.selectSubagent(agentId);
    }
  }

  nextTick(() => {
    el!.scrollIntoView({ behavior: "smooth", block: "center" });
    el!.classList.add("cv-highlight");
    setTimeout(() => el!.classList.remove("cv-highlight"), 4000);
  });
}

defineExpose({ revealEvent });
</script>

<template>
  <div class="cv-root" ref="cvRootEl">
    <!-- Main column (shrinks when panel is open) -->
    <div :class="['cv-main', { 'panel-open': panel.isPanelOpen.value }]">
      <div class="cv-scroll" ref="scrollEl">
        <div class="cv-content">
          <div class="cv-stream">
            <template v-for="(turn, ti) in turns" :key="turn.turnIndex">
              <!-- Gap indicator -->
              <div v-if="showGap(turn, ti)" class="cv-gap">
                <div class="cv-gap-line" />
                <div class="cv-gap-label">⋯ {{ gapCount(turn, ti) }} turns not shown</div>
                <div class="cv-gap-line" />
              </div>

              <!-- Session events -->
              <div
                v-for="evt in (turn.sessionEvents ?? [])"
                :key="evt.timestamp"
                :class="['cv-session-event', severityClass(evt.severity)]"
              >
                <span class="cv-session-event-icon">{{ severityIcon(evt.severity) }}</span>
                <span class="cv-session-event-type">{{ evt.eventType }}</span>
                <span class="cv-session-event-summary">{{ evt.summary }}</span>
                <span v-if="evt.timestamp" class="cv-session-event-time">
                  {{ formatTime(evt.timestamp) }}
                </span>
              </div>

              <!-- User message anchor -->
              <div
                v-if="turn.userMessage"
                class="cv-user-anchor"
                :id="userEventId(turn)"
              >
                <div class="cv-user-header">
                  <span class="cv-user-avatar" aria-hidden="true">👤</span>
                  <span class="cv-user-name">User</span>
                  <span class="cv-user-turn">T{{ turn.turnIndex }}</span>
                  <span v-if="turn.timestamp" class="cv-user-time">
                    {{ formatTime(turn.timestamp) }}
                  </span>
                </div>
                <div class="cv-user-body">
                  <MarkdownContent :content="turn.userMessage" :render="renderMd" />
                </div>
              </div>

              <!-- Turn block with timeline line -->
              <div
                class="cv-turn-block"
                :data-turn="`T${turn.turnIndex}`"
                :id="`turn-${turn.turnIndex}`"
                :style="subagentTurnColors.get(turn.turnIndex) ? { borderLeft: `3px solid ${subagentTurnColors.get(turn.turnIndex)}`, paddingLeft: '12px' } : {}"
              >
                <!-- Main reasoning -->
                <ReasoningBlock
                  v-for="(reasoning, rIdx) in mainReasoningForTurn(turn)"
                  :key="`r-${turn.turnIndex}-${rIdx}`"
                  :reasoning="[reasoning]"
                  :expanded="expandedReasoning.has(`${turn.turnIndex}-main-${rIdx}`)"
                  @toggle="expandedReasoning.toggle(`${turn.turnIndex}-main-${rIdx}`)"
                />

                <!-- Main messages -->
                <div
                  v-for="(msg, mIdx) in mainMessagesForTurn(turn)"
                  :key="`m-${turn.turnIndex}-${mIdx}`"
                  class="cv-agent-bubble"
                >
                  <div class="cv-agent-bubble-header">
                    <span class="cv-agent-avatar" aria-hidden="true">🤖</span>
                    <span class="cv-agent-name">Copilot</span>
                  </div>
                  <MarkdownContent :content="msg.content" :render="renderMd" />
                </div>

                <!-- Tool segments -->
                <template
                  v-for="(segment, sIdx) in toolSegmentsForTurn(turn)"
                  :key="`seg-${turn.turnIndex}-${sIdx}`"
                >
                  <!-- Tool group -->
                  <template v-if="segment.type === 'tool-group'">
                    <div
                      class="cv-tool-group"
                      :data-collapse-key="`${turn.turnIndex}-group-${sIdx}`"
                    >
                      <template v-for="(item, iIdx) in segment.items" :key="iIdx">
                        <!-- Intent pill -->
                        <div
                          v-if="item.type === 'intent'"
                          class="cv-intent-pill"
                          :id="item.toolCall.eventIndex != null ? `event-${item.toolCall.eventIndex}` : undefined"
                        >
                          <span class="cv-pill-icon" aria-hidden="true">🎯</span>
                          <span class="cv-pill-label">{{ intentLabel(item.toolCall) }}</span>
                        </div>

                        <!-- Memory pill -->
                        <div
                          v-else-if="item.type === 'memory'"
                          class="cv-memory-pill"
                          :id="item.toolCall.eventIndex != null ? `event-${item.toolCall.eventIndex}` : undefined"
                        >
                          <span class="cv-pill-icon" aria-hidden="true">🧠</span>
                          <span class="cv-pill-label">{{ truncateText(memoryLabel(item.toolCall), 80) }}</span>
                        </div>

                        <!-- Ask-user card -->
                        <div
                          v-else-if="item.type === 'ask-user'"
                          class="cv-ask-user-card"
                          :id="item.toolCall.eventIndex != null ? `event-${item.toolCall.eventIndex}` : undefined"
                        >
                          <div class="cv-ask-user-header">
                            <span aria-hidden="true">💬</span>
                            <span>Asked User</span>
                          </div>
                          <div v-if="item.toolCall.resultContent" class="cv-ask-user-body">
                            {{ truncateText(item.toolCall.resultContent, 300) }}
                          </div>
                        </div>

                        <!-- Regular tool row (with progressive disclosure) -->
                        <ToolCallItem
                          v-else-if="item.type === 'tool'"
                          v-show="isItemVisible(item, segment.items, iIdx, `${turn.turnIndex}-group-${sIdx}`)"
                          :id="item.toolCall.eventIndex != null ? `event-${item.toolCall.eventIndex}` : undefined"
                          v-bind="tcProps(turn, item.toolCall)"
                          @toggle="toggleToolDetail(turn, item.toolCall)"
                          @load-full-result="handleLoadFullResult"
                          @retry-full-result="handleRetryResult"
                        />
                      </template>

                      <!-- Collapse toggle -->
                      <button
                        v-if="shouldCollapse(segment.items) && !expandedGroups.has(`${turn.turnIndex}-group-${sIdx}`)"
                        class="cv-collapsed-toggle"
                        :aria-expanded="false"
                        @click="expandedGroups.toggle(`${turn.turnIndex}-group-${sIdx}`)"
                      >
                        <span class="cv-collapsed-toggle-label">
                          Show {{ hiddenToolCount(segment.items) }} more tools
                        </span>
                        <span class="cv-collapsed-toggle-tags">
                          <span
                            v-for="name in getCollapsedToolNames(segment.items, MAX_VISIBLE_TOOLS)"
                            :key="name"
                            class="cv-collapsed-tag"
                          >{{ name }}</span>
                        </span>
                      </button>

                      <button
                        v-if="shouldCollapse(segment.items) && expandedGroups.has(`${turn.turnIndex}-group-${sIdx}`)"
                        class="cv-collapsed-toggle"
                        :aria-expanded="true"
                        @click="expandedGroups.toggle(`${turn.turnIndex}-group-${sIdx}`)"
                      >
                        <span class="cv-collapsed-toggle-label">Show fewer tools</span>
                      </button>
                    </div>
                  </template>

                  <!-- Subagent group -->
                  <template v-if="segment.type === 'subagent-group'">
                    <div
                      v-if="segment.subagents.length > 1"
                      class="cv-parallel-header"
                      aria-hidden="true"
                    >
                      ⚡ {{ segment.subagents.length }} agents launched in parallel
                    </div>
                    <div :class="{ 'cv-parallel-stack': segment.subagents.length > 1 }">
                      <div
                        v-for="sa in segment.subagents"
                        :key="sa.toolCallId"
                        :id="sa.eventIndex != null ? `event-${sa.eventIndex}` : undefined"
                        :data-agent-id="sa.toolCallId"
                      >
                        <SubagentCard
                          :tool-call="sa"
                          :child-tool-count="subagentMap.get(sa.toolCallId!)?.childTools.length ?? 0"
                          :selected="panel.selectedAgentId.value === sa.toolCallId"
                          @select="panel.selectSubagent"
                        />
                      </div>
                    </div>
                  </template>
                </template>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Subagent panel (fixed viewport-sticky, below header) -->
    <SubagentPanel
      :subagent="panel.selectedSubagent.value"
      :is-open="panel.isPanelOpen.value"
      :current-index="panel.selectedIndex.value"
      :total-count="allSubagents.length"
      :has-prev="panel.hasPrev.value"
      :has-next="panel.hasNext.value"
      :top-offset="panelTopPx"
      @close="panel.closePanel"
      @prev="panel.navigatePrev"
      @next="panel.navigateNext"
    />
  </div>
</template>

<style scoped>
/* ─── Root layout ──────────────────────────────────────────────── */

.cv-root {
  display: flex;
  position: relative;
}

.cv-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  transition: margin-right var(--transition-normal, 0.2s) ease;
}

.cv-main.panel-open {
  margin-right: min(38%, 650px);
}

.cv-main.panel-open .cv-content {
  max-width: none;
}

@media (max-width: 959px) {
  .cv-main.panel-open {
    margin-right: 0;
  }
}

.cv-scroll {
  flex: 1;
}

.cv-content {
  max-width: var(--content-max-width, 1600px);
  margin: 0 auto;
  padding: 24px 32px 80px;
}

.cv-stream {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ─── Gap indicator ────────────────────────────────────────────── */

.cv-gap {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
}

.cv-gap-line {
  flex: 1;
  height: 0;
  border-top: 1px dashed var(--border-muted, #484f58);
}

.cv-gap-label {
  font-size: 12px;
  color: var(--text-placeholder, #6e7681);
  white-space: nowrap;
  user-select: none;
}

/* ─── Session events ───────────────────────────────────────────── */

.cv-session-event {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-md, 8px);
  font-size: 12px;
  margin: 4px 0;
}

.cv-session-event.info {
  background: var(--neutral-subtle, rgba(110, 118, 129, 0.1));
  color: var(--text-secondary, #8b949e);
}

.cv-session-event.warning {
  background: var(--warning-subtle, rgba(210, 153, 34, 0.1));
  color: var(--warning-fg, #d29922);
}

.cv-session-event.error {
  background: var(--danger-subtle, rgba(248, 81, 73, 0.1));
  color: var(--danger-fg, #f85149);
}

.cv-session-event-icon {
  flex-shrink: 0;
}

.cv-session-event-type {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  opacity: 0.7;
}

.cv-session-event-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-session-event-time {
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.6;
}

/* ─── User message anchor ──────────────────────────────────────── */

.cv-user-anchor {
  border-left: 3px solid var(--accent-emphasis, #1f6feb);
  background: var(--canvas-subtle, #161b22);
  border-radius: 0 var(--radius-md, 8px) var(--radius-md, 8px) 0;
  padding: 12px 16px;
  margin: 12px 0 4px;
}

.cv-user-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.cv-user-avatar {
  font-size: 16px;
  flex-shrink: 0;
}

.cv-user-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--accent-fg, #58a6ff);
}

.cv-user-turn {
  font-size: 11px;
  font-family: "JetBrains Mono", monospace;
  color: var(--text-placeholder, #6e7681);
}

.cv-user-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-placeholder, #6e7681);
}

.cv-user-body {
  position: relative;
  background: var(--accent-subtle, rgba(56, 139, 253, 0.08));
  border: 1px solid var(--accent-muted, rgba(56, 139, 253, 0.15));
  border-radius: var(--radius-md, 8px);
  padding: 12px 16px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-primary, #c9d1d9);
  overflow-wrap: break-word;
}

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

/* ─── Tool group ───────────────────────────────────────────────── */

.cv-tool-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 4px 0;
}

/* ─── Intent pill ──────────────────────────────────────────────── */

.cv-intent-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: var(--accent-subtle, rgba(56, 139, 253, 0.1));
  border: 1px solid var(--accent-muted, rgba(56, 139, 253, 0.2));
  border-radius: var(--radius-full, 100px);
  font-size: 12px;
  color: var(--accent-fg, #58a6ff);
  max-width: 100%;
  margin: 2px 0;
}

.cv-intent-pill .cv-pill-icon {
  flex-shrink: 0;
  font-size: 13px;
}

.cv-intent-pill .cv-pill-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Memory pill ──────────────────────────────────────────────── */

.cv-memory-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: var(--done-subtle, rgba(163, 113, 247, 0.1));
  border: 1px solid color-mix(in srgb, var(--done-fg, #a371f7) 30%, transparent);
  border-radius: var(--radius-full, 100px);
  font-size: 12px;
  color: var(--done-fg, #a371f7);
  max-width: 100%;
  margin: 2px 0;
}

.cv-memory-pill .cv-pill-icon {
  flex-shrink: 0;
  font-size: 13px;
}

.cv-memory-pill .cv-pill-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ─── Ask-user card ────────────────────────────────────────────── */

.cv-ask-user-card {
  background: var(--warning-subtle, rgba(210, 153, 34, 0.1));
  border: 1px solid var(--warning-muted, rgba(210, 153, 34, 0.2));
  border-radius: var(--radius-md, 8px);
  padding: 10px 14px;
  margin: 4px 0;
}

.cv-ask-user-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--warning-fg, #d29922);
  margin-bottom: 4px;
}

.cv-ask-user-body {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary, #c9d1d9);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

/* ─── Parallel subagent layout ─────────────────────────────────── */

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

/* ─── Collapse toggle ──────────────────────────────────────────── */

.cv-collapsed-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  background: var(--canvas-inset, #010409);
  border: 1px dashed var(--border-muted, #484f58);
  border-radius: var(--radius-sm, 4px);
  color: var(--accent-fg, #58a6ff);
  font-size: 12px;
  cursor: pointer;
  transition: background var(--transition-fast, 0.1s) ease;
}

.cv-collapsed-toggle:hover {
  background: var(--accent-subtle, rgba(56, 139, 253, 0.1));
}

.cv-collapsed-toggle-label {
  white-space: nowrap;
  font-weight: 500;
}

.cv-collapsed-toggle-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  overflow: hidden;
}

.cv-collapsed-tag {
  display: inline-block;
  padding: 1px 6px;
  background: var(--neutral-subtle, rgba(110, 118, 129, 0.1));
  border-radius: var(--radius-sm, 4px);
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  color: var(--text-tertiary, #484f58);
  white-space: nowrap;
}

/* ─── Deep-link highlight animation ────────────────────────────── */

@keyframes cv-flash {
  0% {
    box-shadow: 0 0 0 2px var(--accent-emphasis, #1f6feb);
  }
  50% {
    box-shadow: 0 0 0 4px var(--accent-muted, rgba(56, 139, 253, 0.2));
  }
  100% {
    box-shadow: none;
  }
}

.cv-highlight {
  animation: cv-flash 2s ease-out 2;
  border-radius: var(--radius-sm, 4px);
}
</style>
