/**
 * Composable for deriving conversation section data from turns.
 *
 * Pure computed data — no UI state, no side effects. Extracts the shared
 * data-derivation logic used by ConversationTab's three view modes.
 */

import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { type ComputedRef, computed } from "vue";
import { type AgentSection, buildSubagentIndex, groupTurnByAgent } from "../utils/agentGrouping";
import { formatArgsSummary } from "../utils/toolCall";

export interface ConversationSectionsReturn {
  /** Get agent-grouped sections for a given turn. */
  getSections: (turnIndex: number) => AgentSection[];
  /** Get the pre-computed args summary for a tool call. */
  getArgsSummary: (turnIndex: number, tcIdx: number) => string;
  /** Find a tool call's original flat index within the turn. */
  findToolCallIndex: (turn: ConversationTurn, tc: TurnToolCall) => number;
  /** Total tool calls across all turns. */
  totalToolCalls: ComputedRef<number>;
  /** Total duration across all turns. */
  totalDurationMs: ComputedRef<number>;
}

export function useConversationSections(
  getTurns: () => ConversationTurn[],
): ConversationSectionsReturn {
  // Session-wide subagent index for cross-turn attribution
  const globalSubagentMap = computed(() => buildSubagentIndex(getTurns()));

  // Agent-grouped sections are only needed by compact/timeline views. Chat
  // looks up tool indexes too, but has its own rendering groups.
  const groupedSections = computed(() => {
    const subMap = globalSubagentMap.value;
    const turns = getTurns();
    const map = new Map<number, AgentSection[]>();

    for (const turn of turns) {
      map.set(turn.turnIndex, groupTurnByAgent(turn, subMap));
    }
    return map;
  });

  // Keep index lookup independent so it does not build unused agent sections.
  const toolIndexMaps = computed(() => {
    const indexMaps = new Map<number, Map<string, number>>();
    for (const turn of getTurns()) {
      const idxMap = new Map<string, number>();
      for (let i = 0; i < turn.toolCalls.length; i++) {
        const tc = turn.toolCalls[i];
        if (tc.toolCallId) {
          idxMap.set(tc.toolCallId, i);
        }
      }
      indexMaps.set(turn.turnIndex, idxMap);
    }
    return indexMaps;
  });

  // Cache formatArgsSummary per tool call — prefer server-computed argsSummary
  const argsSummaryCache = computed(() => {
    const cache = new Map<string, string>();
    for (const turn of getTurns()) {
      for (let i = 0; i < turn.toolCalls.length; i++) {
        const tc = turn.toolCalls[i];
        const summary = tc.argsSummary || formatArgsSummary(tc.arguments, tc.toolName);
        cache.set(`${turn.turnIndex}-${i}`, summary);
      }
    }
    return cache;
  });

  function getSections(turnIndex: number): AgentSection[] {
    return groupedSections.value.get(turnIndex) ?? [];
  }

  function getArgsSummary(turnIndex: number, tcIdx: number): string {
    return argsSummaryCache.value.get(`${turnIndex}-${tcIdx}`) || "";
  }

  function findToolCallIndex(turn: ConversationTurn, tc: TurnToolCall): number {
    // Fast path: use pre-computed index map
    if (tc.toolCallId) {
      const idx = toolIndexMaps.value.get(turn.turnIndex)?.get(tc.toolCallId);
      if (idx !== undefined) return idx;
    }
    // Fallback: linear scan by toolCallId then identity
    if (tc.toolCallId) {
      const idx = turn.toolCalls.findIndex((t) => t.toolCallId === tc.toolCallId);
      if (idx >= 0) return idx;
    }
    return turn.toolCalls.indexOf(tc as (typeof turn.toolCalls)[0]);
  }

  const totalToolCalls = computed(() => getTurns().reduce((sum, t) => sum + t.toolCalls.length, 0));

  const totalDurationMs = computed(() =>
    getTurns().reduce((sum, t) => sum + (t.durationMs ?? 0), 0),
  );

  return {
    getSections,
    getArgsSummary,
    findToolCallIndex,
    totalToolCalls,
    totalDurationMs,
  };
}
