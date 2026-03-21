/**
 * Composable for deriving conversation section data from turns.
 *
 * Pure computed data — no UI state, no side effects. Extracts the shared
 * data-derivation logic used by ConversationTab's three view modes.
 */
import { computed, type ComputedRef } from "vue";
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { formatArgsSummary } from "../utils/toolCall";
import { buildSubagentIndex, groupTurnByAgent, type AgentSection } from "../utils/agentGrouping";

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

  // Agent-grouped sections per turn, with pre-computed original indices
  const groupedSections = computed(() => {
    const subMap = globalSubagentMap.value;
    const turns = getTurns();
    const map = new Map<number, AgentSection[]>();

    // Build a toolCallId → flat index lookup per turn
    const indexMaps = new Map<number, Map<string | undefined, number>>();
    for (const turn of turns) {
      const idxMap = new Map<string | undefined, number>();
      for (let i = 0; i < turn.toolCalls.length; i++) {
        const tc = turn.toolCalls[i];
        if (tc.toolCallId) {
          idxMap.set(tc.toolCallId, i);
        }
      }
      indexMaps.set(turn.turnIndex, idxMap);
      map.set(turn.turnIndex, groupTurnByAgent(turn, subMap));
    }

    // Store the index maps alongside for findToolCallIndex
    (map as IndexedSectionsMap)._indexMaps = indexMaps;
    return map;
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
    const indexMaps = (groupedSections.value as IndexedSectionsMap)._indexMaps;
    if (indexMaps && tc.toolCallId) {
      const idx = indexMaps.get(turn.turnIndex)?.get(tc.toolCallId);
      if (idx !== undefined) return idx;
    }
    // Fallback: linear scan by toolCallId then identity
    if (tc.toolCallId) {
      const idx = turn.toolCalls.findIndex((t) => t.toolCallId === tc.toolCallId);
      if (idx >= 0) return idx;
    }
    return turn.toolCalls.indexOf(tc as typeof turn.toolCalls[0]);
  }

  const totalToolCalls = computed(() =>
    getTurns().reduce((sum, t) => sum + t.toolCalls.length, 0),
  );

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

/** Internal type for attaching index maps to the grouped sections Map. */
interface IndexedSectionsMap extends Map<number, AgentSection[]> {
  _indexMaps?: Map<number, Map<string | undefined, number>>;
}
