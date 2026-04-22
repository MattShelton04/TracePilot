import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { formatArgsSummary, formatDuration } from "@tracepilot/ui";
import { type ComputedRef, computed, type Ref } from "vue";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface Phase {
  index: number;
  label: string;
  turns: ConversationTurn[];
}

export interface AgentTimeRange {
  id: string;
  startedAt: string | null;
  completedAt?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Phase grouping                                                    */
/* ------------------------------------------------------------------ */

export function groupPhases(turns: ConversationTurn[]): Phase[] {
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
}

/* ------------------------------------------------------------------ */
/*  Phase summaries                                                   */
/* ------------------------------------------------------------------ */

export function phaseDurationMs(phase: Phase): number {
  return phase.turns.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
}

export function phaseToolCount(phase: Phase): number {
  return phase.turns.reduce((sum, t) => sum + t.toolCalls.length, 0);
}

export function phaseAgentCount(phase: Phase): number {
  return phase.turns.reduce((sum, t) => sum + t.toolCalls.filter((tc) => tc.isSubagent).length, 0);
}

/* ------------------------------------------------------------------ */
/*  Turn helpers                                                      */
/* ------------------------------------------------------------------ */

export function turnKey(phaseIdx: number, turn: ConversationTurn): string {
  return `${phaseIdx}-${turn.turnIndex}`;
}

export function agentKey(tKey: string, agent: TurnToolCall, idx: number): string {
  return `${tKey}-${agent.toolCallId ?? `${agent.toolName}-${idx}`}`;
}

export function subagents(turn: ConversationTurn): TurnToolCall[] {
  return turn.toolCalls.filter((tc) => tc.isSubagent);
}

export function turnSubagentCount(turn: ConversationTurn): number {
  return subagents(turn).length;
}

export function turnToolCount(turn: ConversationTurn): number {
  return turn.toolCalls.filter((tc) => !tc.isSubagent).length;
}

/* ------------------------------------------------------------------ */
/*  Duration bar width                                                */
/* ------------------------------------------------------------------ */

export function turnMaxDuration(turn: ConversationTurn): number {
  let max = 0;
  for (const tc of turn.toolCalls) {
    if (tc.durationMs && tc.durationMs > max) max = tc.durationMs;
  }
  return max || 1;
}

export function barWidthPct(tc: TurnToolCall, maxMs: number): string {
  const ms = tc.durationMs ?? 0;
  const pct = Math.max((ms / maxMs) * 100, 4); // min 4% for visibility
  return `${Math.min(pct, 100)}%`;
}

/* ------------------------------------------------------------------ */
/*  Status / tooltip                                                  */
/* ------------------------------------------------------------------ */

export function agentStatusIcon(agent: TurnToolCall): string {
  if (agent.success === false) return "❌";
  if (agent.isComplete) return "✓";
  return "⏳";
}

export function toolTooltip(tc: TurnToolCall): string {
  const parts = [tc.toolName];
  if (tc.arguments) parts.push(formatArgsSummary(tc.arguments, tc.toolName));
  if (tc.durationMs != null) parts.push(formatDuration(tc.durationMs));
  parts.push(tc.success === false ? "Failed" : tc.success === true ? "Success" : "In Progress");
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/*  Cross-turn tool filters (reactive wrapper)                        */
/* ------------------------------------------------------------------ */

export interface SwimlaneLayout {
  groupedPhases: ComputedRef<Phase[]>;
  allSubagentIds: ComputedRef<Set<string | undefined>>;
  allAgentToolCalls: ComputedRef<AgentTimeRange[]>;
  nestedTools: (agent: TurnToolCall) => TurnToolCall[];
  directTools: (turn: ConversationTurn) => TurnToolCall[];
  countNestedTools: (agent: TurnToolCall) => number;
}

export function useSwimlaneLayout(
  turns: Ref<ConversationTurn[]>,
  allToolCalls: Ref<TurnToolCall[]>,
): SwimlaneLayout {
  const groupedPhases = computed<Phase[]>(() => groupPhases(turns.value));

  const allSubagentIds = computed(
    () =>
      new Set(
        allToolCalls.value
          .filter((tc) => tc.isSubagent && tc.toolCallId)
          .map((tc) => tc.toolCallId),
      ),
  );

  const allAgentToolCalls = computed<AgentTimeRange[]>(() => {
    const agents: AgentTimeRange[] = [];

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

  function nestedTools(agent: TurnToolCall): TurnToolCall[] {
    if (!agent.toolCallId) return [];
    return allToolCalls.value.filter(
      (tc) => tc.parentToolCallId === agent.toolCallId && !tc.isSubagent,
    );
  }

  function directTools(turn: ConversationTurn): TurnToolCall[] {
    return turn.toolCalls.filter(
      (tc) =>
        !tc.isSubagent && (!tc.parentToolCallId || !allSubagentIds.value.has(tc.parentToolCallId)),
    );
  }

  function countNestedTools(agent: TurnToolCall): number {
    if (!agent.toolCallId) return 0;
    return allToolCalls.value.filter((tc) => tc.parentToolCallId === agent.toolCallId).length;
  }

  return {
    groupedPhases,
    allSubagentIds,
    allAgentToolCalls,
    nestedTools,
    directTools,
    countNestedTools,
  };
}
