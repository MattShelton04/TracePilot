<script setup lang="ts">
import type { ConversationTurn } from "@tracepilot/types";
import { useConversationSections, useToggleSet } from "@tracepilot/ui";
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import GapIndicator from "@/components/conversation/chat/GapIndicator.vue";
import TurnBlock from "@/components/conversation/chat/TurnBlock.vue";
import UserMessageAnchor from "@/components/conversation/chat/UserMessageAnchor.vue";
import SessionEventRow from "@/components/conversation/SessionEventRow.vue";
import { useChatViewPanelOffset } from "@/composables/useChatViewPanelOffset";
import { useCrossTurnSubagents } from "@/composables/useCrossTurnSubagents";
import { useRenderBudget } from "@/composables/useRenderBudget";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSubagentCompletions } from "@/composables/useSubagentCompletions";
import { useSubagentPanel } from "@/composables/useSubagentPanel";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";
import {
  getMainMessages,
  getMainReasoning,
  segmentToolCalls,
  type ToolSegment,
} from "./chatViewUtils";
import SdkSteeringPanel from "./SdkSteeringPanel.vue";
import SubagentPanel from "./SubagentPanel.vue";
import SystemMessagePanel from "./SystemMessagePanel.vue";

// ─── Store & Route ────────────────────────────────────────────────

const store = useSessionDetailContext();
const sdk = useSdkStore();

useRenderBudget({ key: "render.chatViewModeMs", budgetMs: 200, label: "ChatViewMode" });
const preferences = usePreferencesStore();
const route = useRoute();
const persistedTurns = computed(() => store.turns);
const liveConversationTurn = computed<ConversationTurn | null>(() => {
  const sessionId = store.sessionId;
  if (!sessionId) return null;
  const live = sdk.liveTurnsBySessionId[sessionId];
  if (!live || (!live.assistantText.trim() && !live.reasoningText.trim())) return null;
  if (live.turnId && persistedTurns.value.some((turn) => turn.turnId === live.turnId)) {
    return null;
  }
  const last = persistedTurns.value[persistedTurns.value.length - 1];
  return {
    turnIndex: (last?.turnIndex ?? 0) + 1,
    turnId: live.turnId ?? undefined,
    assistantMessages: live.assistantText.trim() ? [{ content: live.assistantText }] : [],
    reasoningTexts: live.reasoningText.trim() ? [{ content: live.reasoningText }] : [],
    toolCalls: [],
    timestamp: live.updatedAt,
    isComplete: false,
  };
});
const turns = computed(() => {
  const liveTurn = liveConversationTurn.value;
  return liveTurn ? [...persistedTurns.value, liveTurn] : persistedTurns.value;
});
watch(
  () => [
    store.sessionId,
    persistedTurns.value.length,
    sdk.liveTurnsBySessionId[store.sessionId ?? ""]?.turnId,
  ],
  () => {
    const sessionId = store.sessionId;
    if (!sessionId) return;
    const live = sdk.liveTurnsBySessionId[sessionId];
    if (live?.turnId && persistedTurns.value.some((turn) => turn.turnId === live.turnId)) {
      sdk.clearLiveTurn(sessionId);
    }
  },
);
const renderMd = computed(() => preferences.isFeatureEnabled("renderMarkdown"));
const emit = defineEmits<{
  messageSent: [prompt: string];
}>();

// ─── Cross-turn subagent data ─────────────────────────────────────

const { subagentMap, allSubagents } = useCrossTurnSubagents(persistedTurns);

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

const { findToolCallIndex, getArgsSummary } = useConversationSections(() => turns.value);

// ─── Scroll ───────────────────────────────────────────────────────

const scrollEl = ref<HTMLElement | null>(null);
const cvRootEl = ref<HTMLElement | null>(null);

// ─── Panel top offset (fixed position below sticky action bar) ────

const { panelTopPx } = useChatViewPanelOffset(cvRootEl);

// ─── Computed helpers ─────────────────────────────────────────────

function showGap(turn: ConversationTurn, ti: number): boolean {
  if (ti === 0) return false;
  return turn.turnIndex - turns.value[ti - 1].turnIndex > 1;
}

function gapCount(turn: ConversationTurn, ti: number): number {
  return turn.turnIndex - turns.value[ti - 1].turnIndex - 1;
}

// ─── Memoized per-turn render data ────────────────────────────────
// Computed once when turns change, avoids re-segmenting on every render.

interface TurnRenderData {
  reasoning: string[];
  messages: ReturnType<typeof getMainMessages>;
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

// ─── Subagent completions + turn colors ───────────────────────────

const { completionsByTurn, completionLabel, subagentTurnColors } = useSubagentCompletions(
  turns,
  subagentMap,
  allSubagents,
  toolCallTurnIndex,
);

/** When a steering message is sent, force-refresh turns to pick up new events faster. */
function handleSteeringMessage(_prompt: string) {
  // The steering panel already schedules its own refreshes (800ms + 3s),
  // but we also trigger an immediate refreshAll here for good measure.
  store.refreshAll();
  emit("messageSent", _prompt);
}

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
  const root = cvRootEl.value;
  if (!root) return;

  const elId =
    eventIndex != null ? `[data-event-idx="${eventIndex}"]` : `[data-turn-idx="${turnIndex}"]`;
  let el = root.querySelector<HTMLElement>(elId);

  // If event not in DOM, check if it belongs to a subagent and open the panel
  if (!el && eventIndex != null) {
    const agentId = findOwningSubagent(turnIndex, eventIndex);
    if (agentId) {
      panel.selectSubagent(agentId);
      // Scroll to the subagent card wrapper instead
      const cardEl = root.querySelector<HTMLElement>(`[data-agent-id="${agentId}"]`);
      if (cardEl) el = cardEl;
    }
  }

  if (!el) {
    // Final fallback: scroll to the turn block
    el = root.querySelector<HTMLElement>(`[data-turn-idx="${turnIndex}"]`);
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
  <div :class="['cv-root', { 'panel-active': panel.isPanelOpen.value }]" ref="cvRootEl">
    <!-- Main column (shrinks when panel is open) -->
    <div :class="['cv-main', { 'panel-open': panel.isPanelOpen.value }]">
      <div class="cv-scroll" ref="scrollEl">
        <div class="cv-content">
          <div class="cv-stream">
            <template v-for="(turn, ti) in turns" :key="turn.turnIndex">
              <!-- Gap indicator -->
              <GapIndicator v-if="showGap(turn, ti)" :count="gapCount(turn, ti)" />

              <!-- System message(s) — one per turn in auto-model sessions (CLI v1.0.32+) -->
              <SystemMessagePanel
                v-for="(msg, idx) in (turn.systemMessages ?? [])"
                :key="`sysmsg-${turn.turnIndex}-${idx}`"
                :content="msg"
                :index="idx"
              />

              <!-- Session events -->
              <SessionEventRow
                v-for="evt in (turn.sessionEvents ?? [])"
                :key="evt.timestamp"
                :event="evt"
              />

              <!-- User message anchor -->
              <UserMessageAnchor
                v-if="turn.userMessage"
                :content="turn.userMessage"
                :turn-index="turn.turnIndex"
                :timestamp="turn.timestamp"
                :event-index="turn.eventIndex"
                :render-markdown="renderMd"
              />

              <!-- Turn block with timeline line -->
              <TurnBlock
                :turn="turn"
                :render-data="renderDataFor(turn)"
                :subagent-map="subagentMap"
                :completion-ids="completionsByTurn.get(turn.turnIndex) ?? []"
                :turn-color="subagentTurnColors.get(turn.turnIndex)"
                :selected-agent-id="panel.selectedAgentId.value"
                :render-markdown="renderMd"
                :expanded-reasoning="expandedReasoning"
                :expanded-groups="expandedGroups"
                :expanded-tool-details="expandedToolDetails"
                :full-results="fullResults"
                :loading-results="loadingResults"
                :failed-results="failedResults"
                :completion-label="completionLabel"
                :find-tool-call-index="findToolCallIndex"
                :get-args-summary="getArgsSummary"
                @load-full-result="handleLoadFullResult"
                @retry-full-result="handleRetryResult"
                @select-subagent="panel.selectSubagent"
              />
            </template>
          </div>
        </div>
      </div>

      <!-- SDK Steering Panel (appears at bottom of chat when SDK is active) -->
      <SdkSteeringPanel :session-id="store.sessionId" :session-cwd="store.detail?.cwd ?? undefined" @message-sent="handleSteeringMessage" />
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
      @select-subagent="panel.selectSubagent"
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
  margin-right: min(38vw, 650px);
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

.cv-highlight,
:deep(.cv-highlight) {
  animation: cv-flash 2s ease-out 2;
  border-radius: var(--radius-sm, 4px);
}
</style>
