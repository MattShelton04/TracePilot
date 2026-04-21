<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import {
  EmptyState,
  LoadingSpinner,
  TerminologyLegend,
  useLiveDuration,
  useToggleSet,
} from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import SwimlanePhaseGroup from "@/components/timeline/swimlanes/SwimlanePhaseGroup.vue";
import { useParallelAgentDetection } from "@/composables/useParallelAgentDetection";
import { useSwimlaneLayout } from "@/composables/useSwimlaneLayout";
import { useTimelineToolState } from "@/composables/useTimelineToolState";

/* ------------------------------------------------------------------ */
/*  Turn ownership check for tool-state composable                    */
/* ------------------------------------------------------------------ */

const turnOwnershipCheck = (turn: ConversationTurn, tool: TurnToolCall): boolean => {
  // If this is a non-subagent child tool of a subagent, only match the turn that owns the parent subagent.
  // This prevents double-matching when the tool object physically lives in a different
  // turn's toolCalls array but is rendered under the subagent's turn via nestedTools().
  // Note: nested subagents (isSubagent && parentToolCallId) should fall through to the
  // identity/ID check below, since they are rendered as lanes in their own turn.
  if (tool.parentToolCallId && !tool.isSubagent) {
    const turnSubagentIds = new Set(
      turn.toolCalls
        .filter((tc) => tc.isSubagent && tc.toolCallId)
        .map((tc) => tc.toolCallId)
        .filter((id): id is string => id !== undefined),
    );
    return turnSubagentIds.has(tool.parentToolCallId);
  }

  // For direct tools / subagent headers, use object identity or ID match
  if (tool.toolCallId) {
    return turn.toolCalls.some((tc) => tc.toolCallId === tool.toolCallId);
  }
  return turn.toolCalls.includes(tool);
};

const {
  store,
  prefs,
  fullResults,
  loadingResults,
  loadFullResult,
  allToolCalls,
  selectedTool,
  selectTool,
  isToolSelected,
  clearSelection: closeDetail,
  turnOwnsSelected,
} = useTimelineToolState({ turnOwnershipCheck });

const turns = computed(() => store.turns);

/* ------------------------------------------------------------------ */
/*  Layout (pure math/grouping)                                       */
/* ------------------------------------------------------------------ */

const {
  groupedPhases,
  allAgentToolCalls,
  nestedTools,
  directTools,
  countNestedTools,
} = useSwimlaneLayout(turns, allToolCalls);

/* ------------------------------------------------------------------ */
/*  Live-ticking for in-progress subagents                            */
/* ------------------------------------------------------------------ */

const hasInProgressAgents = computed(() =>
  store.turns.some((t) => t.toolCalls.some((tc) => tc.isSubagent && !tc.isComplete)),
);
const { nowMs } = useLiveDuration(hasInProgressAgents);

function agentLiveDuration(agent: TurnToolCall): number | undefined {
  if (!agent.isComplete && agent.startedAt) {
    return nowMs.value - new Date(agent.startedAt).getTime();
  }
  return agent.durationMs;
}

/* ------------------------------------------------------------------ */
/*  Collapse / expand state                                           */
/* ------------------------------------------------------------------ */

const phases = useToggleSet<number>(); // phase index → collapsed
const turnSet = useToggleSet<string>(); // `${phaseIdx}-${turnIdx}` → collapsed
const agentSet = useToggleSet<string>(); // `${turnKey}-${toolCallId}` → collapsed

// Expandable swimlane messages
const expandedMessages = useToggleSet<string>(); // `${turnIndex}-user` or `${turnIndex}-assistant`
const assistantMsgIndex = ref(new Map<number, number>()); // turnIndex → current msg index

function getAssistantMsgIdx(turnIndex: number): number {
  return assistantMsgIndex.value.get(turnIndex) ?? 0;
}
function setAssistantMsgIdx(turnIndex: number, idx: number) {
  assistantMsgIndex.value.set(turnIndex, idx);
}

// Default collapsed for large sessions
let lastPhaseCount = 0;
watch(
  groupedPhases,
  (newPhases) => {
    // Only auto-collapse on initial load or when phase count changes
    // (not on soft refresh which returns the same structure)
    if (newPhases.length > 3 && newPhases.length !== lastPhaseCount) {
      for (let i = 1; i < newPhases.length; i++) {
        phases.set.value.add(i);
      }
    }
    lastPhaseCount = newPhases.length;
  },
  { immediate: true },
);

/* ------------------------------------------------------------------ */
/*  Parallel agent detection                                          */
/* ------------------------------------------------------------------ */

const { parallelIds: parallelAgentIds } = useParallelAgentDetection(allAgentToolCalls, {
  generateLabels: false, // Only need the flat set for highlighting
});

/* ------------------------------------------------------------------ */
/*  Terminology legend items                                          */
/* ------------------------------------------------------------------ */

const swimlaneTerms = [
  { term: "Phase", definition: "A group of turns initiated by one user prompt" },
  {
    term: "Turn",
    definition:
      "A single assistant response cycle (may include tool calls and subagent invocations)",
  },
  {
    term: "Subagent",
    definition:
      "An autonomous agent spawned to handle a specific subtask (e.g. explore, code-review)",
  },
  {
    term: "Direct Tools",
    definition: "Tool calls made directly by the main agent (not delegated to subagents)",
  },
];

function onLoadFullResult(toolCallId: string) {
  loadFullResult(toolCallId);
}
</script>

<template>
  <div class="nested-swimlanes">
    <!-- Empty state -->
    <EmptyState
      v-if="!store.turns.length && !store.loading"
      title="No Timeline Data"
      message="This session has no conversation turns to visualize."
      icon="📊"
    />

    <!-- Loading state -->
    <div v-else-if="store.loading && !store.turns.length" class="ns-loading">
      <LoadingSpinner size="lg" />
      <span>Loading timeline…</span>
    </div>

    <!-- Terminology legend -->
    <TerminologyLegend v-if="store.turns.length" :items="swimlaneTerms" />

    <!-- Phases -->
    <SwimlanePhaseGroup
      v-for="phase in groupedPhases"
      :key="phase.index"
      :phase="phase"
      :collapsed="phases.has(phase.index)"
      :turn-set="turnSet"
      :expanded-messages="expandedMessages"
      :agent-set="agentSet"
      :nested-tools="nestedTools"
      :direct-tools="directTools"
      :count-nested-tools="countNestedTools"
      :parallel-agent-ids="parallelAgentIds"
      :selected-tool="selectedTool"
      :full-results="fullResults"
      :loading-results="loadingResults"
      :prefs="prefs"
      :turn-owns-selected="turnOwnsSelected"
      :is-tool-selected="isToolSelected"
      :agent-live-duration="agentLiveDuration"
      :get-assistant-msg-idx="getAssistantMsgIdx"
      @toggle-phase="phases.toggle(phase.index)"
      @select-tool="selectTool"
      @close-detail="closeDetail"
      @load-full-result="onLoadFullResult"
      @set-assistant-idx="setAssistantMsgIdx"
    />
  </div>
</template>

<style scoped>
.nested-swimlanes {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ns-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 24px 16px;
  color: var(--text-secondary);
  font-size: 0.875rem;
}
</style>
