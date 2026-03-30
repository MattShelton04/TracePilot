<script setup lang="ts">
import type {
  AttributedMessage,
  ConversationTurn,
  SessionEventSeverity,
  TurnToolCall,
} from "@tracepilot/types";
import {
  formatArgsSummary,
  formatDuration,
  formatNumber,
  formatTime,
  getAgentColor,
  getAgentIcon,
  inferAgentTypeFromToolCall,
  MarkdownContent,
  ReasoningBlock,
  ToolCallItem,
  toolIcon,
  truncateText,
  useConversationSections,
  useToggleSet,
} from "@tracepilot/ui";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useCrossTurnSubagents } from "@/composables/useCrossTurnSubagents";
import { useSubagentPanel } from "@/composables/useSubagentPanel";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import {
  COLLAPSE_THRESHOLD,
  countRegularTools,
  getCollapsedToolNames,
  getMainMessages,
  getMainReasoning,
  MAX_VISIBLE_TOOLS,
  segmentToolCalls,
  type ToolGroupItem,
  type ToolSegment,
} from "./chatViewUtils";
import { computePanelWidthPx, shouldReserveScrollInset } from "./panelLayout";
import SubagentCard from "./SubagentCard.vue";
import SubagentPanel from "./SubagentPanel.vue";

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

const {
  fullResults,
  loadingResults,
  failedResults,
  loadFullResult: handleLoadFullResult,
  retryFullResult: handleRetryResult,
} = useToolResultLoader(() => store.sessionId);

// ─── Conversation sections (for tool call index) ─────────────────

const { findToolCallIndex, getArgsSummary } = useConversationSections(() => store.turns);

// ─── Scroll ───────────────────────────────────────────────────────

const scrollEl = ref<HTMLElement | null>(null);
const cvRootEl = ref<HTMLElement | null>(null);
const panelWidthPx = ref(0);
const scrollMaxHeightPx = ref(520);
const usePanelScrollViewport = ref(false);

// ─── Panel top offset (fixed position below sticky action bar) ────

const panelTopPx = ref(0);
let pageScrollEl: HTMLElement | null = null;

function updatePanelTop() {
  const cvRoot = cvRootEl.value;
  if (!cvRoot) return;
  const cvRect = cvRoot.getBoundingClientRect();

  // Find the sticky action bar (.detail-actions) — it sticks at top of scroll area
  const actionsEl = document.querySelector(".detail-actions") as HTMLElement | null;
  const actionsBottom = actionsEl ? actionsEl.getBoundingClientRect().bottom : 0;

  // Panel top = whichever is lower: cv-root top or sticky bar bottom
  panelTopPx.value = Math.max(cvRect.top, actionsBottom);

  // Preserve chat edge alignment when page-content is centered with max-width.
  const pc = cvRoot.closest(".page-content") as HTMLElement | null;
  const pci = cvRoot.closest(".page-content-inner") as HTMLElement | null;
  if (pc && pci) {
    const pcStyle = getComputedStyle(pc);
    const padL = parseFloat(pcStyle.paddingLeft) || 0;
    const padR = parseFloat(pcStyle.paddingRight) || 0;
    const pcContentWidth = pc.clientWidth - padL - padR;
    const pciWidth = pci.offsetWidth;
    const sideGap = Math.max(0, (pcContentWidth - pciWidth) / 2);
    cvRoot.style.setProperty("--breakout-left", `${sideGap}px`);
    cvRoot.style.setProperty("--breakout-right", `${sideGap + padR}px`);
  }
}

function updateLayoutMetrics() {
  const viewportWidth = window.innerWidth;
  const reserveInset = panel.isPanelOpen.value && shouldReserveScrollInset(viewportWidth);
  panelWidthPx.value = reserveInset ? computePanelWidthPx(viewportWidth) : 0;
  usePanelScrollViewport.value = reserveInset;

  const cvRoot = cvRootEl.value;
  if (!cvRoot) return;
  const cvRect = cvRoot.getBoundingClientRect();
  // Keep chat scroller constrained to viewport so its own scrollbar can sit left of the panel.
  scrollMaxHeightPx.value = Math.max(320, Math.floor(window.innerHeight - cvRect.top - 24));
}

function handleLayoutResize() {
  updateLayoutMetrics();
  updatePanelTop();
}

function handlePageScroll() {
  updatePanelTop();
  if (usePanelScrollViewport.value) {
    updateLayoutMetrics();
  }
}

onMounted(() => {
  pageScrollEl = cvRootEl.value?.closest(".page-content") as HTMLElement | null;
  updateLayoutMetrics();
  updatePanelTop();
  window.addEventListener("resize", handleLayoutResize);
  // Listen to scroll on the page-content container (the page scroller)
  if (pageScrollEl) {
    pageScrollEl.addEventListener("scroll", handlePageScroll, { passive: true });
  }
});

watch(
  () => panel.isPanelOpen.value,
  () => {
    updateLayoutMetrics();
    updatePanelTop();
  },
);

onUnmounted(() => {
  window.removeEventListener("resize", handleLayoutResize);
  if (pageScrollEl) {
    pageScrollEl.removeEventListener("scroll", handlePageScroll);
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

// ─── Memoized per-turn render data ────────────────────────────────
// Computed once when turns change, avoids re-segmenting on every render.

interface TurnRenderData {
  reasoning: string[];
  messages: AttributedMessage[];
  segments: ToolSegment[];
}

const turnRenderData = computed(() => {
  const map = new Map<number, TurnRenderData>();
  for (const turn of turns.value) {
    map.set(turn.turnIndex, {
      reasoning: getMainReasoning(turn),
      messages: getMainMessages(turn),
      segments: segmentToolCalls(turn.toolCalls),
    });
  }
  return map;
});

function renderDataFor(turn: ConversationTurn): TurnRenderData {
  return turnRenderData.value.get(turn.turnIndex) ?? { reasoning: [], messages: [], segments: [] };
}

// ─── toolCallId → turnIndex index (O(1) lookups) ─────────────────

const toolCallTurnIndex = computed(() => {
  const map = new Map<string, number>();
  for (const turn of turns.value) {
    for (const tc of turn.toolCalls) {
      if (tc.toolCallId) {
        map.set(tc.toolCallId, turn.turnIndex);
      }
    }
  }
  return map;
});

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

// ─── Subagent completion tracking ─────────────────────────────────
// Maps turnIndex → subagent toolCallIds whose LAST read_agent appears in that turn.
// Only one pill per subagent, positioned at the final read.
// Bridge: read_agent uses agent_name (e.g. "explore-rust-backend") while
// subagentMap is keyed by toolCallId (e.g. "tooluse_QVH..."). The launch
// tool call's arguments.name provides the bridge.

function parseAgentNameFromReadAgent(tc: TurnToolCall): string | null {
  try {
    const args =
      typeof tc.arguments === "string"
        ? JSON.parse(tc.arguments)
        : (tc.arguments as Record<string, unknown> | null);
    return (args?.agent_id as string) ?? null;
  } catch {
    return null;
  }
}

/** Reverse map: agent launch name → subagentMap toolCallId */
const agentNameToToolCallId = computed(() => {
  const map = new Map<string, string>();
  for (const [toolCallId, sa] of subagentMap.value) {
    const args = sa.toolCall.arguments as Record<string, unknown> | undefined;
    const name = (args?.name as string) ?? undefined;
    if (name) {
      map.set(name, toolCallId);
    }
  }
  return map;
});

const completionsByTurn = computed(() => {
  const lastReadByAgent = new Map<string, number>(); // toolCallId → turnIndex

  for (const turn of turns.value) {
    for (const tc of turn.toolCalls) {
      if (tc.toolName === "read_agent" && !tc.parentToolCallId) {
        const agentName = parseAgentNameFromReadAgent(tc);
        if (agentName) {
          const toolCallId = agentNameToToolCallId.value.get(agentName);
          if (toolCallId) {
            lastReadByAgent.set(toolCallId, turn.turnIndex);
          }
        }
      }
    }
  }

  const byTurn = new Map<number, string[]>();
  for (const [toolCallId, turnIdx] of lastReadByAgent) {
    const sa = subagentMap.value.get(toolCallId);
    if (sa?.toolCall.isComplete) {
      const list = byTurn.get(turnIdx) ?? [];
      list.push(toolCallId);
      byTurn.set(turnIdx, list);
    }
  }
  return byTurn;
});

function completionLabel(toolCallId: string): string {
  const sa = subagentMap.value.get(toolCallId);
  if (sa) {
    const agentType = inferAgentTypeFromToolCall(sa.toolCall);
    const label = agentType.charAt(0).toUpperCase() + agentType.slice(1);
    return `${label} agent ${sa.toolCall.success === false ? "failed" : "completed"}`;
  }
  return "Agent completed";
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
    map.set(sa.turnIndex, color);
    for (const ct of sa.childTools) {
      if (ct.toolCallId) {
        const turnIdx = toolCallTurnIndex.value.get(ct.toolCallId);
        if (turnIdx != null) map.set(turnIdx, color);
      }
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
  const turn = turns.value.find((t) => t.turnIndex === turnIndex);
  if (!turn) return null;
  const tc = turn.toolCalls.find((t) => t.eventIndex === eventIndex);
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
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.add("cv-highlight");
    setTimeout(() => el?.classList.remove("cv-highlight"), 4000);
  });
}

defineExpose({ revealEvent });
</script>

<template>
  <div
    :class="['cv-root', { 'panel-active': panel.isPanelOpen.value }]"
    :style="{
      '--cv-panel-width': `${panelWidthPx}px`,
      '--cv-scroll-max-height': `${scrollMaxHeightPx}px`,
    }"
    ref="cvRootEl"
  >
    <!-- Main column (shrinks when panel is open) -->
    <div :class="['cv-main', { 'panel-open': panel.isPanelOpen.value }]">
      <div :class="['cv-scroll', { 'cv-scroll--panel-open': usePanelScrollViewport }]" ref="scrollEl">
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
                  v-for="(reasoning, rIdx) in renderDataFor(turn).reasoning"
                  :key="`r-${turn.turnIndex}-${rIdx}`"
                  :reasoning="[reasoning]"
                  :expanded="expandedReasoning.has(`${turn.turnIndex}-main-${rIdx}`)"
                  @toggle="expandedReasoning.toggle(`${turn.turnIndex}-main-${rIdx}`)"
                />

                <!-- Main messages -->
                <div
                  v-for="(msg, mIdx) in renderDataFor(turn).messages"
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
                  <MarkdownContent :content="msg.content" :render="renderMd" />
                </div>

                <!-- Tool segments -->
                <template
                  v-for="(segment, sIdx) in renderDataFor(turn).segments"
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

                        <!-- Ask-user (rich renderer) -->
                        <ToolCallItem
                          v-else-if="item.type === 'ask-user'"
                          :id="item.toolCall.eventIndex != null ? `event-${item.toolCall.eventIndex}` : undefined"
                          v-bind="tcProps(turn, item.toolCall)"
                          @toggle="toggleToolDetail(turn, item.toolCall)"
                          @load-full-result="handleLoadFullResult"
                          @retry-full-result="handleRetryResult"
                        />

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

                <!-- Subagent completion pills (at the turn of their final read_agent) -->
                <div
                  v-for="agentId in (completionsByTurn.get(turn.turnIndex) ?? [])"
                  :key="`complete-${agentId}`"
                  :class="['cv-subagent-complete-pill', subagentMap.get(agentId)?.toolCall.success === false ? 'failed' : 'completed']"
                  role="button"
                  tabindex="0"
                  @click="panel.selectSubagent(agentId)"
                  @keydown.enter="panel.selectSubagent(agentId)"
                >
                  <span class="cv-pill-icon" aria-hidden="true">{{ subagentMap.get(agentId)?.toolCall.success === false ? '✗' : '✓' }}</span>
                  <span class="cv-pill-label">{{ completionLabel(agentId) }}</span>
                  <span v-if="subagentMap.get(agentId)?.toolCall.durationMs" class="cv-pill-duration">
                    {{ formatDuration(subagentMap.get(agentId)!.toolCall.durationMs!) }}
                  </span>
                </div>
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
      :panel-width-px="panelWidthPx"
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
  transition: margin var(--transition-normal, 0.2s) ease;
}

.cv-root.panel-active {
  margin-left: calc(-1 * var(--breakout-left, 0px));
  margin-right: calc(-1 * var(--breakout-right, 0px));
}

.cv-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  transition: margin-right var(--transition-normal, 0.2s) ease;
}

.cv-main.panel-open {
  margin-right: var(--cv-panel-width, min(38vw, 650px));
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

.cv-scroll--panel-open {
  overflow-y: auto;
  max-height: var(--cv-scroll-max-height, none);
  scrollbar-gutter: stable;
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

.cv-agent-time {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-placeholder, #6e7681);
  font-weight: 400;
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
