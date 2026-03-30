<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import {
  Badge,
  categoryColor,
  EmptyState,
  ExpandChevron,
  extractPrompt,
  formatArgsSummary,
  formatDuration,
  formatLiveDuration,
  formatTime,
  getAgentColor,
  getToolStatusColor,
  inferAgentTypeFromToolCall,
  LoadingSpinner,
  TerminologyLegend,
  ToolDetailPanel,
  toolCategory,
  toolIcon,
  truncateText,
  useLiveDuration,
  useToggleSet,
} from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { useParallelAgentDetection } from "@/composables/useParallelAgentDetection";
import { useTimelineToolState } from "@/composables/useTimelineToolState";

// Define the turn ownership check logic for the composable
const turnOwnershipCheck = (turn: ConversationTurn, tool: TurnToolCall): boolean => {
  // If this is a non-subagent child tool of a subagent, only match the turn that owns the parent subagent.
  // This prevents double-matching when the tool object physically lives in a different
  // turn's toolCalls array but is rendered under the subagent's turn via nestedTools().
  // Note: nested subagents (isSubagent && parentToolCallId) should fall through to the
  // identity/ID check below, since they are rendered as lanes in their own turn.
  if (tool.parentToolCallId && !tool.isSubagent) {
    const turnSubagentIds = new Set(
      turn.toolCalls.filter((tc) => tc.isSubagent && tc.toolCallId).map((tc) => tc.toolCallId!),
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
  failedResults,
  loadFullResult,
  retryFullResult,
  allToolCalls,
  selectedTool,
  selectTool,
  isToolSelected: isSelected,
  clearSelection: closeDetail,
  turnOwnsSelected,
} = useTimelineToolState({ turnOwnershipCheck });

// ── Live-ticking for in-progress subagents ───────────────────
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

// ── Collapse / expand state ──────────────────────────────────

const phases = useToggleSet<number>(); // phase index → collapsed
const turnSet = useToggleSet<string>(); // `${phaseIdx}-${turnIdx}` → collapsed
const agentSet = useToggleSet<string>(); // `${turnKey}-${toolCallId}` → collapsed

// ── Expandable swimlane messages ─────────────────────────────
const expandedMessages = useToggleSet<string>(); // `${turnIndex}-user` or `${turnIndex}-assistant`
const assistantMsgIndex = ref(new Map<number, number>()); // turnIndex → current msg index

function getAssistantMsgIdx(turnIndex: number): number {
  return assistantMsgIndex.value.get(turnIndex) ?? 0;
}
function setAssistantMsgIdx(turnIndex: number, idx: number) {
  assistantMsgIndex.value.set(turnIndex, idx);
}

function countNestedTools(agent: TurnToolCall): number {
  if (!agent.toolCallId) return 0;
  return allToolCalls.value.filter((tc) => tc.parentToolCallId === agent.toolCallId).length;
}

// ── Subagent lane color ──────────────────────────────────────

function agentColor(agent: TurnToolCall): string {
  return getAgentColor(inferAgentTypeFromToolCall(agent));
}

// ── Phase grouping ───────────────────────────────────────────

interface Phase {
  index: number;
  label: string;
  turns: ConversationTurn[];
}

const groupedPhases = computed<Phase[]>(() => {
  const turns = store.turns;
  if (!turns.length) return [];

  const result: Phase[] = [];
  let current: Phase | null = null;

  for (const turn of turns) {
    if (turn.userMessage != null) {
      current = {
        index: result.length,
        label: turn.userMessage,
        turns: [turn],
      };
      result.push(current);
    } else if (current) {
      current.turns.push(turn);
    } else {
      // Turns before first user message → create implicit phase
      current = {
        index: result.length,
        label: "(system)",
        turns: [turn],
      };
      result.push(current);
    }
  }

  return result;
});

// ── Default collapsed for large sessions ─────────────────────
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

// ── Phase-level summaries ────────────────────────────────────

function phaseDurationMs(phase: Phase): number {
  return phase.turns.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
}

function phaseToolCount(phase: Phase): number {
  return phase.turns.reduce((sum, t) => sum + t.toolCalls.length, 0);
}

function phaseAgentCount(phase: Phase): number {
  return phase.turns.reduce((sum, t) => sum + t.toolCalls.filter((tc) => tc.isSubagent).length, 0);
}

// ── Turn-level helpers ───────────────────────────────────────

function turnKey(phaseIdx: number, turn: ConversationTurn): string {
  return `${phaseIdx}-${turn.turnIndex}`;
}

function subagents(turn: ConversationTurn): TurnToolCall[] {
  return turn.toolCalls.filter((tc) => tc.isSubagent);
}

function nestedTools(turn: ConversationTurn, agent: TurnToolCall): TurnToolCall[] {
  if (!agent.toolCallId) return [];
  return allToolCalls.value.filter(
    (tc) => tc.parentToolCallId === agent.toolCallId && !tc.isSubagent,
  );
}

// Set of all subagent toolCallIds across all turns (for filtering cross-turn children)
const allSubagentIds = computed(
  () =>
    new Set(
      allToolCalls.value.filter((tc) => tc.isSubagent && tc.toolCallId).map((tc) => tc.toolCallId),
    ),
);

function directTools(turn: ConversationTurn): TurnToolCall[] {
  return turn.toolCalls.filter(
    (tc) =>
      !tc.isSubagent && (!tc.parentToolCallId || !allSubagentIds.value.has(tc.parentToolCallId)),
  );
}

function turnSubagentCount(turn: ConversationTurn): number {
  return subagents(turn).length;
}

function turnToolCount(turn: ConversationTurn): number {
  return turn.toolCalls.filter((tc) => !tc.isSubagent).length;
}

// ── Duration bar width ───────────────────────────────────────

function turnMaxDuration(turn: ConversationTurn): number {
  let max = 0;
  for (const tc of turn.toolCalls) {
    if (tc.durationMs && tc.durationMs > max) max = tc.durationMs;
  }
  return max || 1;
}

function barWidthPct(tc: TurnToolCall, maxMs: number): string {
  const ms = tc.durationMs ?? 0;
  const pct = Math.max((ms / maxMs) * 100, 4); // min 4% for visibility
  return `${Math.min(pct, 100)}%`;
}

// ── Tool bar color ───────────────────────────────────────────

const toolBarColor = getToolStatusColor;

// ── Subagent status icon ─────────────────────────────────────

function agentStatusIcon(agent: TurnToolCall): string {
  if (agent.success === false) return "❌";
  if (agent.isComplete) return "✓";
  return "⏳";
}

// ── Tooltip text ─────────────────────────────────────────────

function toolTooltip(tc: TurnToolCall): string {
  const parts = [tc.toolName];
  if (tc.arguments) parts.push(formatArgsSummary(tc.arguments, tc.toolName));
  if (tc.durationMs != null) parts.push(formatDuration(tc.durationMs));
  parts.push(tc.success === false ? "Failed" : tc.success === true ? "Success" : "In Progress");
  return parts.join(" · ");
}

// ── Agent key for toggle ─────────────────────────────────────

function agentKey(tKey: string, agent: TurnToolCall, idx: number): string {
  return `${tKey}-${agent.toolCallId ?? `${agent.toolName}-${idx}`}`;
}

// ── Parallel agent detection ────────────────────────────────
// Detect which agents overlap in time (execute in parallel)
const allAgentToolCalls = computed(() => {
  const agents: Array<{
    id: string;
    startedAt: string | null;
    completedAt?: string | null;
  }> = [];

  for (const phase of groupedPhases.value) {
    for (const turn of phase.turns) {
      const agentCalls = turn.toolCalls.filter((tc) => tc.isSubagent);
      for (let i = 0; i < agentCalls.length; i++) {
        const a = agentCalls[i];
        // Use toolCallId if available, otherwise generate unique ID to prevent collisions
        const id = a.toolCallId ?? `${a.toolName}-turn${turn.turnIndex}-agent${i}`;
        agents.push({
          id,
          startedAt: a.startedAt ?? null,
          completedAt: a.completedAt ?? null,
        });
      }
    }
  }

  return agents;
});

const { parallelIds: parallelAgentIds } = useParallelAgentDetection(allAgentToolCalls, {
  generateLabels: false, // Only need the flat set for highlighting
});

// ── Terminology legend items ─────────────────────────────────
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
    <div
      v-for="phase in groupedPhases"
      :key="phase.index"
      class="phase-group"
    >
      <!-- Phase header -->
      <div
        class="phase-header"
        role="button"
        tabindex="0"
        :aria-label="`Toggle phase ${phase.index + 1}: ${phase.label}`"
        :aria-expanded="!phases.has(phase.index)"
        @click="phases.toggle(phase.index)"
        @keydown.enter.space.prevent="phases.toggle(phase.index)"
      >
        <ExpandChevron :expanded="!phases.has(phase.index)" size="md" />
        <span class="phase-label" :title="phase.label">
          Phase {{ phase.index + 1 }}:
          {{ truncateText(phase.label, 80) }}
        </span>
        <span class="phase-stats">
          <Badge variant="neutral">{{ formatDuration(phaseDurationMs(phase)) }}</Badge>
          <Badge variant="warning">{{ phaseToolCount(phase) }} tools</Badge>
          <Badge v-if="phaseAgentCount(phase) > 0" variant="accent">
            {{ phaseAgentCount(phase) }} agent{{ phaseAgentCount(phase) !== 1 ? "s" : "" }}
          </Badge>
        </span>
      </div>

      <!-- Phase body (collapsible) -->
      <div v-if="!phases.has(phase.index)" class="phase-body">
        <div
          v-for="turn in phase.turns"
          :key="turn.turnIndex"
          class="turn-group"
        >
          <!-- Turn header -->
          <div
            class="turn-header"
            role="button"
            tabindex="0"
            :aria-label="`Toggle turn ${turn.turnIndex}${turn.userMessage ? ': ' + truncateText(turn.userMessage, 60) : ''}`"
            :aria-expanded="!turnSet.has(turnKey(phase.index, turn))"
            @click="turnSet.toggle(turnKey(phase.index, turn))"
            @keydown.enter.space.prevent="turnSet.toggle(turnKey(phase.index, turn))"
          >
            <ExpandChevron
              :expanded="!turnSet.has(turnKey(phase.index, turn))"
              size="sm"
            />
            <span class="turn-label">
              Turn {{ turn.turnIndex }}
            </span>
            <span v-if="turn.userMessage" class="turn-user-msg">
              {{ truncateText(turn.userMessage, 60) }}
            </span>
            <span class="turn-stats">
              <span v-if="turnSubagentCount(turn) > 0" class="turn-stat">
                {{ turnSubagentCount(turn) }} agent{{ turnSubagentCount(turn) !== 1 ? "s" : "" }}
              </span>
              <span class="turn-stat">{{ turnToolCount(turn) }} tools</span>
              <span v-if="turn.durationMs" class="turn-stat">
                {{ formatDuration(turn.durationMs) }}
              </span>
              <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
            </span>
          </div>

          <!-- Turn body (collapsible) -->
          <div
            v-if="!turnSet.has(turnKey(phase.index, turn))"
            class="turn-body"
          >
            <!-- User message lane -->
            <div v-if="turn.userMessage" class="swimlane">
              <div class="swimlane-label">User</div>
              <div class="swimlane-track">
                <!-- Collapsed bar -->
                <div
                  v-if="!expandedMessages.has(`${turn.turnIndex}-user`)"
                  class="swimlane-bar swimlane-bar--user swimlane-bar--expandable"
                  :style="{ width: '30%' }"
                  :title="turn.userMessage"
                  role="button"
                  tabindex="0"
                  :aria-label="`Expand user message: ${truncateText(turn.userMessage, 50)}`"
                  @click="expandedMessages.toggle(`${turn.turnIndex}-user`)"
                  @keydown.enter.space.prevent="expandedMessages.toggle(`${turn.turnIndex}-user`)"
                >
                  {{ truncateText(turn.userMessage, 50) }}
                  <span v-if="turn.userMessage.length > 50" class="expand-hint">⤢</span>
                </div>
                <!-- Expanded content -->
                <div v-else class="swimlane-expanded swimlane-expanded--user">
                  <button
                    class="swimlane-collapse-btn"
                    @click="expandedMessages.toggle(`${turn.turnIndex}-user`)"
                  >
                    ▾ Collapse
                  </button>
                  <div class="swimlane-expanded-content">{{ turn.userMessage }}</div>
                </div>
              </div>
            </div>

            <!-- Assistant lane -->
            <div v-if="turn.assistantMessages.some(m => m.content.trim())" class="swimlane">
              <div class="swimlane-label">Assistant</div>
              <div class="swimlane-track">
                <!-- Collapsed bar -->
                <div
                  v-if="!expandedMessages.has(`${turn.turnIndex}-assistant`)"
                  class="swimlane-bar swimlane-bar--assistant swimlane-bar--expandable"
                  :style="{ width: '80%' }"
                  :title="turn.assistantMessages.find(m => m.content.trim())?.content.slice(0, 200)"
                  role="button"
                  tabindex="0"
                  aria-label="Expand assistant message"
                  @click="expandedMessages.toggle(`${turn.turnIndex}-assistant`)"
                  @keydown.enter.space.prevent="expandedMessages.toggle(`${turn.turnIndex}-assistant`)"
                >
                  {{ truncateText(turn.assistantMessages.find(m => m.content.trim())?.content ?? "", 80) }}
                  <span v-if="(turn.assistantMessages.find(m => m.content.trim())?.content ?? '').length > 80" class="expand-hint">⤢</span>
                </div>
                <!-- Expanded content: shows ONE assistant message at a time with pagination -->
                <div v-else class="swimlane-expanded swimlane-expanded--assistant">
                  <div class="swimlane-expanded-header">
                    <button
                      class="swimlane-collapse-btn"
                      @click="expandedMessages.toggle(`${turn.turnIndex}-assistant`)"
                    >
                      ▾ Collapse
                    </button>
                    <div v-if="turn.assistantMessages.filter(m => m.content.trim()).length > 1" class="msg-pagination">
                      <button
                        class="msg-nav-btn"
                        :disabled="getAssistantMsgIdx(turn.turnIndex) <= 0"
                        @click="setAssistantMsgIdx(turn.turnIndex, getAssistantMsgIdx(turn.turnIndex) - 1)"
                        title="Previous message"
                      >‹</button>
                      <span class="msg-nav-label">
                        {{ getAssistantMsgIdx(turn.turnIndex) + 1 }} / {{ turn.assistantMessages.filter(m => m.content.trim()).length }}
                      </span>
                      <button
                        class="msg-nav-btn"
                        :disabled="getAssistantMsgIdx(turn.turnIndex) >= turn.assistantMessages.filter(m => m.content.trim()).length - 1"
                        @click="setAssistantMsgIdx(turn.turnIndex, getAssistantMsgIdx(turn.turnIndex) + 1)"
                        title="Next message"
                      >›</button>
                    </div>
                  </div>
                  <div class="swimlane-expanded-content">{{ turn.assistantMessages.filter(m => m.content.trim())[getAssistantMsgIdx(turn.turnIndex)]?.content }}</div>
                </div>
              </div>
            </div>

            <!-- Subagent lanes -->
            <div
              v-for="(agent, agentIdx) in subagents(turn)"
              :key="agent.toolCallId ?? `${agent.toolName}-${agentIdx}`"
              class="subagent-lane"
              :style="{ '--agent-color': agentColor(agent) }"
            >
              <!-- Subagent header -->
              <div
                class="subagent-header"
                :class="{ 'subagent-header--selected': isSelected(agent) }"
                role="button"
                tabindex="0"
                :aria-label="`Select agent: ${agent.agentDisplayName ?? agent.toolName}`"
                :aria-expanded="!agentSet.has(agentKey(turnKey(phase.index, turn), agent, agentIdx))"
                @click="selectTool(agent)"
                @keydown.enter.space.prevent="selectTool(agent)"
              >
                <span
                  class="subagent-chevron"
                  role="button"
                  tabindex="0"
                  :aria-label="`Toggle ${agent.agentDisplayName ?? agent.toolName} expansion`"
                  @click.stop="agentSet.toggle(agentKey(turnKey(phase.index, turn), agent, agentIdx))"
                  @keydown.enter.space.stop.prevent="agentSet.toggle(agentKey(turnKey(phase.index, turn), agent, agentIdx))"
                >
                  <ExpandChevron
                    :expanded="!agentSet.has(agentKey(turnKey(phase.index, turn), agent, agentIdx))"
                    size="sm"
                  />
                </span>
                <span class="subagent-icon">{{ toolIcon(agent.toolName) }}</span>
                <span class="subagent-name">
                  {{ agent.agentDisplayName ?? agent.toolName }}
                </span>
                <span class="subagent-meta">
                  <span v-if="agentLiveDuration(agent)" class="subagent-duration">
                    {{ formatLiveDuration(agentLiveDuration(agent)) }}
                  </span>
                  <span class="subagent-tool-count">
                    {{ nestedTools(turn, agent).length }} tool{{ nestedTools(turn, agent).length !== 1 ? "s" : "" }}
                  </span>
                  <span v-if="parallelAgentIds.has(agent.toolCallId ?? agent.toolName)" class="subagent-parallel">
                    ‖ parallel
                  </span>
                  <span class="subagent-status" :class="{ 'subagent-status--fail': agent.success === false }">
                    {{ agentStatusIcon(agent) }}
                  </span>
                </span>
              </div>

              <!-- Subagent tool track (collapsible) -->
              <div
                v-if="!agentSet.has(agentKey(turnKey(phase.index, turn), agent, agentIdx))"
                class="subagent-track"
              >
                <div class="swimlane">
                  <div class="swimlane-label"></div>
                  <div class="swimlane-track">
                    <div
                      v-for="(tc, idx) in nestedTools(turn, agent)"
                      :key="tc.toolCallId ?? idx"
                      class="swimlane-bar swimlane-bar--tool"
                      :class="{ 'swimlane-bar--selected': isSelected(tc) }"
                      :style="{
                        width: barWidthPct(tc, turnMaxDuration(turn)),
                        background: toolBarColor(tc),
                        position: 'relative',
                      }"
                      :title="toolTooltip(tc)"
                      role="button"
                      tabindex="0"
                      :aria-label="`Select tool: ${tc.toolName}`"
                      @click.stop="selectTool(tc)"
                      @keydown.enter.space.prevent="selectTool(tc)"
                    >
                      <span class="bar-icon">{{ toolIcon(tc.toolName) }}</span>
                      {{ tc.toolName }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Direct tools lane -->
            <div v-if="directTools(turn).length" class="direct-tools-lane">
              <div class="swimlane">
                <div class="swimlane-label">Direct</div>
                <div class="swimlane-track">
                  <div
                    v-for="(tc, idx) in directTools(turn)"
                    :key="tc.toolCallId ?? idx"
                    class="swimlane-bar swimlane-bar--tool"
                    :class="{ 'swimlane-bar--selected': isSelected(tc) }"
                    :style="{
                      width: barWidthPct(tc, turnMaxDuration(turn)),
                      background: toolBarColor(tc),
                      position: 'relative',
                    }"
                    :title="toolTooltip(tc)"
                    role="button"
                    tabindex="0"
                    :aria-label="`Select tool: ${tc.toolName}`"
                    @click.stop="selectTool(tc)"
                    @keydown.enter.space.prevent="selectTool(tc)"
                  >
                    <span class="bar-icon">{{ toolIcon(tc.toolName) }}</span>
                    {{ tc.toolName }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Detail panel (shown when a tool in this turn is selected) -->
            <ToolDetailPanel
              v-if="selectedTool && turnOwnsSelected?.(turn)"
              :tc="selectedTool"
              :full-result="fullResults.get(selectedTool.toolCallId ?? '')"
              :loading-full-result="!!(selectedTool.toolCallId && loadingResults.has(selectedTool.toolCallId))"
              :rich-enabled="prefs.isRichRenderingEnabled(selectedTool.toolName)"
              :child-tool-count="selectedTool.isSubagent ? countNestedTools(selectedTool) : undefined"
              @close="selectedTool = null"
              @load-full-result="loadFullResult"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Root container ─────────────────────────────────────── */
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

/* ── Phase ──────────────────────────────────────────────── */
.phase-group {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--canvas-default);
  overflow: hidden;
}

.phase-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--canvas-raised);
  border-bottom: 1px solid var(--border-default);
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}

.phase-header:hover {
  background: var(--canvas-overlay);
}

.phase-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.phase-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.phase-body {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* ── Turn ───────────────────────────────────────────────── */
.turn-group {
  border-bottom: 1px solid var(--border-subtle);
}

.turn-group:last-child {
  border-bottom: none;
}

.turn-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px 8px 28px;
  background: var(--canvas-subtle);
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}

.turn-header:hover {
  background: var(--canvas-overlay);
}

.turn-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}

.turn-user-msg {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
}

.turn-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.turn-stat {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.turn-body {
  padding: 4px 0;
  transition: max-height var(--transition-slow);
}

/* ── Swimlane overrides (scoped) ────────────────────────── */
.nested-swimlanes .swimlane {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 0;
}

.nested-swimlanes .swimlane-label {
  padding: 6px 12px;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
}

.nested-swimlanes .swimlane-track {
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  overflow: hidden;
  flex-wrap: wrap;
}

.nested-swimlanes .swimlane-bar {
  height: 22px;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  font-size: 0.625rem;
  font-weight: 500;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
  transition: opacity var(--transition-fast), box-shadow var(--transition-fast);
  cursor: default;
}

.nested-swimlanes .swimlane-bar:hover {
  opacity: 0.85;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
}

.swimlane-bar--user {
  background: var(--accent-fg);
}

.swimlane-bar--assistant {
  background: var(--success-fg);
}

.swimlane-bar--tool .bar-icon {
  margin-right: 4px;
  font-size: 0.6875rem;
}

/* ── Expandable swimlane messages ──────────────────────── */
.nested-swimlanes .swimlane-bar.swimlane-bar--expandable {
  cursor: pointer;
  transition: filter 0.15s ease;
}
.nested-swimlanes .swimlane-bar.swimlane-bar--expandable:hover {
  filter: brightness(1.15);
}

.expand-hint {
  margin-left: 6px;
  font-size: 0.75rem;
  opacity: 0.7;
  flex-shrink: 0;
}

.swimlane-expanded {
  width: 100%;
  padding: 8px 12px;
  background: var(--canvas-subtle);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.swimlane-expanded--user {
  border-left: 3px solid var(--accent-fg);
}

.swimlane-expanded--assistant {
  border-left: 3px solid var(--success-fg);
}

.swimlane-expanded-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.swimlane-expanded-content {
  font-size: 0.75rem;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  font-family: var(--font-mono, monospace);
  line-height: 1.5;
}

.swimlane-expanded-content--subsequent {
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
}

.msg-pagination {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.msg-nav-btn {
  border: none;
  background: var(--canvas-overlay, rgba(255,255,255,0.06));
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  line-height: 1;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.msg-nav-btn:hover:not(:disabled) {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}
.msg-nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.msg-nav-label {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 32px;
  text-align: center;
}

.swimlane-collapse-btn {
  align-self: flex-start;
  border: none;
  background: none;
  color: var(--text-tertiary);
  font-size: 0.625rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.swimlane-collapse-btn:hover {
  background: var(--canvas-overlay);
  color: var(--text-primary);
}

/* ── Subagent lane ──────────────────────────────────────── */
.subagent-lane {
  margin: 2px 0 2px 40px;
  border-left: 3px solid var(--agent-color, var(--accent-fg));
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  background: var(--canvas-inset);
  overflow: hidden;
}

.subagent-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
  border-bottom: 1px solid var(--border-subtle);
}

.subagent-header:hover {
  background: var(--canvas-subtle);
}

.subagent-chevron {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}

.subagent-icon {
  font-size: 0.875rem;
  flex-shrink: 0;
}

.subagent-name {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--agent-color, var(--accent-fg));
  white-space: nowrap;
}

.subagent-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.subagent-duration {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.subagent-tool-count {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.subagent-parallel {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--warning-fg);
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--warning-subtle);
  white-space: nowrap;
}

.subagent-status {
  font-size: 0.75rem;
}

.subagent-status--fail {
  color: var(--danger-fg);
}

.subagent-track {
  transition: max-height var(--transition-slow);
}

/* ── Direct tools lane ──────────────────────────────────── */
.direct-tools-lane {
  margin-left: 40px;
  border-left: 3px solid var(--border-muted);
  background: var(--canvas-default);
}

/* ── Terminology legend ────────────────────────────────── */

/* ── Clickable bar styles ──────────────────────────────── */
.nested-swimlanes .swimlane-bar--tool {
  cursor: pointer;
}

.nested-swimlanes .swimlane-bar--selected {
  box-shadow: 0 0 0 2px var(--accent-fg), 0 0 8px rgba(56, 139, 253, 0.4);
  z-index: 1;
}

.subagent-header--selected {
  background: var(--canvas-subtle);
  box-shadow: inset 3px 0 0 0 var(--agent-color, var(--accent-fg));
}

/* ── Detail panel ──────────────────────────────────────── */
.detail-panel {
  margin: 6px 12px 8px 40px;
}

/* ── Responsive ─────────────────────────────────────────── */
@media (max-width: 768px) {
  .phase-header {
    flex-wrap: wrap;
  }

  .phase-stats {
    width: 100%;
    margin-top: 4px;
  }

  .turn-header {
    padding-left: 14px;
    flex-wrap: wrap;
  }

  .turn-stats {
    width: 100%;
    margin-top: 4px;
  }

  .subagent-lane,
  .direct-tools-lane {
    margin-left: 16px;
  }

  .nested-swimlanes .swimlane {
    grid-template-columns: 60px 1fr;
  }
}
</style>
