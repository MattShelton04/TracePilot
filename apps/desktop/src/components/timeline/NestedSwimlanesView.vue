<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { computed } from "vue";
import {
  Badge,
  ExpandChevron,
  EmptyState,
  formatDuration,
  formatTime,
  truncateText,
  toolIcon,
  toolCategory,
  categoryColor,
  formatArgsSummary,
  useToggleSet,
} from "@tracepilot/ui";
import { useSessionDetailStore } from "@/stores/sessionDetail";

const store = useSessionDetailStore();

// ── Collapse / expand state ──────────────────────────────────

const phases = useToggleSet<number>();    // phase index → collapsed
const turnSet = useToggleSet<string>();   // `${phaseIdx}-${turnIdx}` → collapsed
const agentSet = useToggleSet<string>();  // `${turnKey}-${toolCallId}` → collapsed

// ── Subagent lane color map ──────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  explore: "#22d3ee",
  "general-purpose": "#a78bfa",
  "code-review": "#f472b6",
  task: "#fbbf24",
};

function agentColor(toolName: string): string {
  const key = toolName.toLowerCase().replace(/[_ ]/g, "-");
  for (const [pattern, color] of Object.entries(AGENT_COLORS)) {
    if (key.includes(pattern)) return color;
  }
  return "var(--accent-fg)";
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

// ── Phase-level summaries ────────────────────────────────────

function phaseDurationMs(phase: Phase): number {
  return phase.turns.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
}

function phaseToolCount(phase: Phase): number {
  return phase.turns.reduce((sum, t) => sum + t.toolCalls.length, 0);
}

function phaseAgentCount(phase: Phase): number {
  return phase.turns.reduce(
    (sum, t) => sum + t.toolCalls.filter((tc) => tc.isSubagent).length,
    0,
  );
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
  return turn.toolCalls.filter(
    (tc) => tc.parentToolCallId === agent.toolCallId && !tc.isSubagent,
  );
}

function directTools(turn: ConversationTurn): TurnToolCall[] {
  const subagentIds = new Set(
    turn.toolCalls
      .filter((tc) => tc.isSubagent && tc.toolCallId)
      .map((tc) => tc.toolCallId),
  );
  return turn.toolCalls.filter(
    (tc) => !tc.isSubagent && (!tc.parentToolCallId || !subagentIds.has(tc.parentToolCallId)),
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

function toolBarColor(tc: TurnToolCall): string {
  if (tc.success === false) return "var(--danger-fg)";
  if (tc.toolName === "read_agent") return "var(--text-tertiary)";
  return "var(--warning-fg)";
}

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
  parts.push(tc.success === false ? "Failed" : "Success");
  return parts.join(" · ");
}

// ── Agent key for toggle ─────────────────────────────────────

function agentKey(tKey: string, agent: TurnToolCall, idx: number): string {
  return `${tKey}-${agent.toolCallId ?? `${agent.toolName}-${idx}`}`;
}

const parallelAgentIds = computed<Set<string>>(() => {
  const result = new Set<string>();
  for (const phase of groupedPhases.value) {
    for (const turn of phase.turns) {
      const agents = turn.toolCalls.filter((tc) => tc.isSubagent);
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (!a.startedAt || !a.completedAt) continue;
        const aStart = new Date(a.startedAt).getTime();
        const aEnd = new Date(a.completedAt).getTime();
        if (Number.isNaN(aStart) || Number.isNaN(aEnd)) continue;
        for (let j = i + 1; j < agents.length; j++) {
          const b = agents[j];
          if (!b.startedAt || !b.completedAt) continue;
          const bStart = new Date(b.startedAt).getTime();
          const bEnd = new Date(b.completedAt).getTime();
          if (Number.isNaN(bStart) || Number.isNaN(bEnd)) continue;
          if (aStart < bEnd && bStart < aEnd) {
            result.add(a.toolCallId ?? a.toolName);
            result.add(b.toolCallId ?? b.toolName);
          }
        }
      }
    }
  }
  return result;
});
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
      <span class="ns-loading-icon">⏳</span>
      <span>Loading timeline…</span>
    </div>

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
                <div
                  class="swimlane-bar swimlane-bar--user"
                  :style="{ width: '30%' }"
                  :title="turn.userMessage"
                >
                  {{ truncateText(turn.userMessage, 50) }}
                </div>
              </div>
            </div>

            <!-- Assistant lane -->
            <div v-if="turn.assistantMessages.length" class="swimlane">
              <div class="swimlane-label">Assistant</div>
              <div class="swimlane-track">
                <div
                  class="swimlane-bar swimlane-bar--assistant"
                  :style="{ width: '80%' }"
                  :title="turn.assistantMessages[0]?.slice(0, 200)"
                >
                  {{ truncateText(turn.assistantMessages[0] ?? "", 80) }}
                </div>
              </div>
            </div>

            <!-- Subagent lanes -->
            <div
              v-for="(agent, agentIdx) in subagents(turn)"
              :key="agent.toolCallId ?? `${agent.toolName}-${agentIdx}`"
              class="subagent-lane"
              :style="{ '--agent-color': agentColor(agent.toolName) }"
            >
              <!-- Subagent header -->
              <div
                class="subagent-header"
                role="button"
                tabindex="0"
                :aria-expanded="!agentSet.has(agentKey(turnKey(phase.index, turn), agent, agentIdx))"
                @click.stop="agentSet.toggle(agentKey(turnKey(phase.index, turn), agent, agentIdx))"
                @keydown.enter.space.prevent="agentSet.toggle(agentKey(turnKey(phase.index, turn), agent, agentIdx))"
              >
                <ExpandChevron
                  :expanded="!agentSet.has(agentKey(turnKey(phase.index, turn), agent, agentIdx))"
                  size="sm"
                />
                <span class="subagent-icon">{{ toolIcon(agent.toolName) }}</span>
                <span class="subagent-name">
                  {{ agent.agentDisplayName ?? agent.toolName }}
                </span>
                <span class="subagent-meta">
                  <span v-if="agent.durationMs" class="subagent-duration">
                    {{ formatDuration(agent.durationMs) }}
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
                      :style="{
                        width: barWidthPct(tc, turnMaxDuration(turn)),
                        background: toolBarColor(tc),
                        position: 'relative',
                      }"
                      :title="toolTooltip(tc)"
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
                    :style="{
                      width: barWidthPct(tc, turnMaxDuration(turn)),
                      background: toolBarColor(tc),
                      position: 'relative',
                    }"
                    :title="toolTooltip(tc)"
                  >
                    <span class="bar-icon">{{ toolIcon(tc.toolName) }}</span>
                    {{ tc.toolName }}
                  </div>
                </div>
              </div>
            </div>
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

.ns-loading-icon {
  font-size: 1.25rem;
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
