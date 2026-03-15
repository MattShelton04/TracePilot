<script setup lang="ts">
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { computed, ref, watch } from "vue";
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

// ── Terminology legend toggle ────────────────────────────────
const showLegend = ref(false);

// ── Click-to-select detail panel ─────────────────────────────
const selectedTool = ref<TurnToolCall | null>(null);

function selectTool(tc: TurnToolCall) {
  if (selectedTool.value?.toolCallId === tc.toolCallId && tc.toolCallId) {
    selectedTool.value = null;
  } else if (selectedTool.value === tc && !tc.toolCallId) {
    selectedTool.value = null;
  } else {
    selectedTool.value = tc;
    showFullArgs.value = false;
  }
}

function isSelected(tc: TurnToolCall): boolean {
  if (!selectedTool.value) return false;
  if (tc.toolCallId && selectedTool.value.toolCallId) {
    return tc.toolCallId === selectedTool.value.toolCallId;
  }
  return selectedTool.value === tc;
}

function closeDetail() {
  selectedTool.value = null;
}

function formatDetailTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
}

function truncateArgs(args: unknown, limit = 500): { text: string; truncated: boolean } {
  const raw = JSON.stringify(args, null, 2) ?? "";
  if (raw.length <= limit) return { text: raw, truncated: false };
  return { text: raw.slice(0, limit), truncated: true };
}

const showFullArgs = ref(false);

function selectedNestedCount(turn?: ConversationTurn): number {
  const sel = selectedTool.value;
  if (!sel?.isSubagent || !sel.toolCallId || !turn) return 0;
  return turn.toolCalls.filter((tc) => tc.parentToolCallId === sel.toolCallId).length;
}

function selectedTurnForTool(): ConversationTurn | undefined {
  const sel = selectedTool.value;
  if (!sel) return undefined;
  for (const phase of groupedPhases.value) {
    for (const turn of phase.turns) {
      if (turn.toolCalls.includes(sel)) return turn;
    }
  }
  return undefined;
}

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

// ── Default collapsed for large sessions ─────────────────────
watch(groupedPhases, (newPhases) => {
  if (newPhases.length > 3) {
    for (let i = 1; i < newPhases.length; i++) {
      phases.set.value.add(i);
    }
  }
}, { immediate: true });

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
  if (tc.success === undefined || tc.success === null) return "var(--text-tertiary)";
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
  parts.push(tc.success === false ? "Failed" : tc.success === true ? "Success" : "In Progress");
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

    <!-- Terminology legend -->
    <div v-if="store.turns.length" class="legend-container">
      <button class="legend-toggle" @click="showLegend = !showLegend">
        ℹ Terminology
        <span class="legend-chevron" :class="{ 'legend-chevron--open': showLegend }">›</span>
      </button>
      <div v-if="showLegend" class="legend-body">
        <dl class="legend-list">
          <div class="legend-item">
            <dt class="legend-term">Phase</dt>
            <dd class="legend-def">A group of turns initiated by one user prompt</dd>
          </div>
          <div class="legend-item">
            <dt class="legend-term">Turn</dt>
            <dd class="legend-def">A single assistant response cycle (may include tool calls and subagent invocations)</dd>
          </div>
          <div class="legend-item">
            <dt class="legend-term">Subagent</dt>
            <dd class="legend-def">An autonomous agent spawned to handle a specific subtask (e.g. explore, code-review)</dd>
          </div>
          <div class="legend-item">
            <dt class="legend-term">Direct Tools</dt>
            <dd class="legend-def">Tool calls made directly by the main agent (not delegated to subagents)</dd>
          </div>
        </dl>
      </div>
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
                :class="{ 'subagent-header--selected': isSelected(agent) }"
                role="button"
                tabindex="0"
                :aria-expanded="!agentSet.has(agentKey(turnKey(phase.index, turn), agent, agentIdx))"
                @keydown.enter.space.prevent="agentSet.toggle(agentKey(turnKey(phase.index, turn), agent, agentIdx)); selectTool(agent)"
              >
                <span class="subagent-chevron" @click.stop="agentSet.toggle(agentKey(turnKey(phase.index, turn), agent, agentIdx))">
                  <ExpandChevron
                    :expanded="!agentSet.has(agentKey(turnKey(phase.index, turn), agent, agentIdx))"
                    size="sm"
                  />
                </span>
                <span class="subagent-icon" @click.stop="selectTool(agent)">{{ toolIcon(agent.toolName) }}</span>
                <span class="subagent-name" @click.stop="selectTool(agent)">
                  {{ agent.agentDisplayName ?? agent.toolName }}
                </span>
                <span class="subagent-meta" @click.stop="selectTool(agent)">
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
                      :class="{ 'swimlane-bar--selected': isSelected(tc) }"
                      :style="{
                        width: barWidthPct(tc, turnMaxDuration(turn)),
                        background: toolBarColor(tc),
                        position: 'relative',
                      }"
                      :title="toolTooltip(tc)"
                      role="button"
                      tabindex="0"
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
            <div
              v-if="selectedTool && turn.toolCalls.includes(selectedTool)"
              class="detail-panel"
            >
              <div class="detail-header">
                <span class="detail-title">
                  <span class="detail-icon">{{ toolIcon(selectedTool.toolName) }}</span>
                  {{ selectedTool.toolName }}
                </span>
                <button class="detail-close" @click.stop="closeDetail" title="Close detail panel">✕ Close</button>
              </div>
              <div class="detail-body">
                <div class="detail-grid">
                  <template v-if="selectedTool.model">
                    <span class="detail-label">Model</span>
                    <span class="detail-value"><Badge variant="done">{{ selectedTool.model }}</Badge></span>
                  </template>
                  <span class="detail-label">Status</span>
                  <span class="detail-value">
                    <span class="detail-badge" :class="selectedTool.success === false ? 'detail-badge--fail' : selectedTool.success === true ? 'detail-badge--ok' : 'detail-badge--pending'">
                      {{ selectedTool.success === false ? '✕ Failed' : selectedTool.success === true ? '✓ Success' : '⏳ In Progress' }}
                    </span>
                  </span>
                  <template v-if="selectedTool.durationMs != null">
                    <span class="detail-label">Duration</span>
                    <span class="detail-value detail-mono">{{ formatDuration(selectedTool.durationMs) }}</span>
                  </template>
                  <template v-if="selectedTool.startedAt">
                    <span class="detail-label">Started at</span>
                    <span class="detail-value detail-mono">{{ formatDetailTime(selectedTool.startedAt) }}</span>
                  </template>
                  <template v-if="selectedTool.completedAt">
                    <span class="detail-label">Completed at</span>
                    <span class="detail-value detail-mono">{{ formatDetailTime(selectedTool.completedAt) }}</span>
                  </template>
                  <template v-if="selectedTool.isSubagent">
                    <span class="detail-label">Agent</span>
                    <span class="detail-value">{{ selectedTool.agentDisplayName ?? selectedTool.toolName }}</span>
                    <template v-if="selectedTool.agentDescription">
                      <span class="detail-label">Description</span>
                      <span class="detail-value detail-secondary">{{ selectedTool.agentDescription }}</span>
                    </template>
                    <span class="detail-label">Nested tools</span>
                    <span class="detail-value">{{ selectedNestedCount(selectedTurnForTool()) }}</span>
                  </template>
                </div>
                <template v-if="selectedTool.arguments">
                  <div class="detail-section">
                    <div class="detail-section-title" @click="showFullArgs = !showFullArgs" style="cursor: pointer;">
                      Arguments
                      <span class="detail-section-toggle">{{ showFullArgs ? '▾' : '▸' }}</span>
                    </div>
                    <pre v-if="showFullArgs" class="detail-args">{{ JSON.stringify(selectedTool.arguments, null, 2) }}</pre>
                    <pre v-else class="detail-args">{{ truncateArgs(selectedTool.arguments).text }}{{ truncateArgs(selectedTool.arguments).truncated ? '\n…' : '' }}</pre>
                    <button
                      v-if="!showFullArgs && truncateArgs(selectedTool.arguments).truncated"
                      class="detail-show-more"
                      @click.stop="showFullArgs = true"
                    >
                      Show more
                    </button>
                  </div>
                </template>
                <div v-if="selectedTool.error" class="detail-error">
                  <span class="detail-error-label">Error</span>
                  <span class="detail-error-msg">{{ selectedTool.error }}</span>
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
.legend-container {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-raised);
  overflow: hidden;
}

.legend-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--transition-fast);
}

.legend-toggle:hover {
  color: var(--text-primary);
}

.legend-chevron {
  margin-left: auto;
  font-size: 0.875rem;
  transition: transform var(--transition-fast);
  transform: rotate(0deg);
}

.legend-chevron--open {
  transform: rotate(90deg);
}

.legend-body {
  padding: 4px 12px 10px;
  border-top: 1px solid var(--border-subtle);
}

.legend-list {
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.legend-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.legend-term {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  min-width: 80px;
}

.legend-def {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin: 0;
}

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
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-raised);
  backdrop-filter: blur(8px);
  overflow: hidden;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--canvas-overlay);
}

.detail-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.detail-icon {
  font-size: 1rem;
}

.detail-close {
  border: none;
  background: none;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.detail-close:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
}

.detail-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.detail-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  align-items: baseline;
}

.detail-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.detail-value {
  font-size: 0.75rem;
  color: var(--text-primary);
}

.detail-value.detail-mono {
  font-family: var(--font-mono, monospace);
  font-variant-numeric: tabular-nums;
}

.detail-value.detail-secondary {
  color: var(--text-secondary);
  font-style: italic;
}

.detail-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-size: 0.625rem;
  font-weight: 600;
}

.detail-badge--ok {
  background: var(--success-subtle);
  color: var(--success-fg);
}

.detail-badge--fail {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}

.detail-badge--pending {
  background: var(--warning-subtle, rgba(251, 191, 36, 0.15));
  color: var(--warning-fg, #fbbf24);
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-section-title {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.detail-section-toggle {
  font-size: 0.625rem;
}

.detail-args {
  margin: 0;
  padding: 8px;
  font-size: 0.625rem;
  font-family: var(--font-mono, monospace);
  background: var(--canvas-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow-y: auto;
}

.detail-show-more {
  align-self: flex-start;
  border: none;
  background: none;
  color: var(--accent-fg);
  font-size: 0.625rem;
  cursor: pointer;
  padding: 2px 0;
}

.detail-show-more:hover {
  text-decoration: underline;
}

.detail-error {
  display: flex;
  gap: 8px;
  padding: 6px 8px;
  background: var(--danger-subtle);
  border: 1px solid var(--danger-muted, var(--danger-fg));
  border-radius: var(--radius-sm);
  align-items: baseline;
}

.detail-error-label {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--danger-fg);
  white-space: nowrap;
}

.detail-error-msg {
  font-size: 0.6875rem;
  color: var(--danger-fg);
  word-break: break-word;
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
