<script setup lang="ts">
import { type CurrentObjective, ObjectiveBanner } from "@tracepilot/ui";
import { ref } from "vue";
import GapIndicator from "@/components/conversation/chat/GapIndicator.vue";
import TurnBlock from "@/components/conversation/chat/TurnBlock.vue";
import UserMessageAnchor from "@/components/conversation/chat/UserMessageAnchor.vue";
import PermissionEventRow from "@/components/conversation/PermissionEventRow.vue";
import SessionEventRow from "@/components/conversation/SessionEventRow.vue";
import { useChatViewModeData } from "@/composables/useChatViewModeData";
import { useChatViewPanelOffset } from "@/composables/useChatViewPanelOffset";
import { useRenderBudget } from "@/composables/useRenderBudget";
import SdkSteeringPanel from "./SdkSteeringPanel.vue";
import SubagentPanel from "./SubagentPanel.vue";
import SystemMessagePanel from "./SystemMessagePanel.vue";

type ObjectiveStatus = "running" | "completed" | "failed" | "idle";

const props = withDefaults(
  defineProps<{
    objective?: CurrentObjective | null;
    objectiveStatus?: ObjectiveStatus;
  }>(),
  {
    objective: null,
    objectiveStatus: "idle",
  },
);

const emit = defineEmits<{
  messageSent: [prompt: string];
  revealObjective: [info: { eventIndex?: number; toolCallId?: string }];
}>();

useRenderBudget({ key: "render.chatViewModeMs", budgetMs: 200, label: "ChatViewMode" });

const scrollEl = ref<HTMLElement | null>(null);
const cvRootEl = ref<HTMLElement | null>(null);

const {
  store,
  turns,
  renderMd,
  allSubagents,
  subagentMap,
  panel,
  expandedReasoning,
  expandedGroups,
  expandedToolDetails,
  fullResults,
  loadingResults,
  failedResults,
  handleLoadFullResult,
  handleRetryResult,
  findToolCallIndex,
  getArgsSummary,
  completionsByTurn,
  completionLabel,
  subagentTurnColors,
  renderDataFor,
  permissionDataFor,
  showGap,
  gapCount,
  revealEvent,
} = useChatViewModeData(cvRootEl);

// ─── Panel top offset (fixed position below sticky action bar) ────
const { panelTopPx } = useChatViewPanelOffset(cvRootEl);

/** When a steering message is sent, force-refresh turns to pick up new events faster. */
function handleSteeringMessage(_prompt: string) {
  // The steering panel already schedules its own refreshes (800ms + 3s),
  // but we also trigger an immediate refreshAll here for good measure.
  store.refreshAll();
  emit("messageSent", _prompt);
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

              <!-- Session events (with permission request/completion pairing) -->
              <template v-for="entry in permissionDataFor(turn).entries" :key="entry.key">
                <PermissionEventRow
                  v-if="entry.type === 'permission'"
                  :requested="entry.requested"
                  :completed="entry.completed"
                />
                <SessionEventRow
                  v-else
                  :event="entry.event"
                />
              </template>

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
                :permission-by-tool-call-id="permissionDataFor(turn).permissionByToolCallId"
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

      <div class="cv-bottom-stack">
        <ObjectiveBanner
          v-if="props.objective"
          class="cv-objective-strip"
          scope="session"
          :objective="props.objective"
          :status="props.objectiveStatus"
          @reveal="emit('revealObjective', $event)"
        />

        <!-- SDK Steering Panel (appears at bottom of chat when SDK is active) -->
        <SdkSteeringPanel :session-id="store.sessionId" :session-cwd="store.detail?.cwd ?? undefined" @message-sent="handleSteeringMessage" />
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
  padding: 24px 32px 96px;
}

.cv-stream {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.cv-bottom-stack {
  position: sticky;
  bottom: 0;
  z-index: 12;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 16px 8px;
  pointer-events: none;
}

.cv-objective-strip {
  margin: 0 0 8px;
  pointer-events: auto;
}

.cv-bottom-stack :deep(.sdk-steering-feature) {
  pointer-events: auto;
}

/* ─── Deep-link highlight animation ────────────────────────────── */

@keyframes cv-flash {
  0% {
    box-shadow: 0 0 0 2px var(--accent-emphasis);
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
