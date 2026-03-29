import { computed, type ComputedRef, type Ref } from "vue";
import type {
  ConversationTurn,
  TurnToolCall,
  AttributedMessage,
} from "@tracepilot/types";

/** Full activity data for a subagent, aggregated across turns. */
export interface SubagentFullData {
  agentId: string;
  turnIndex: number;
  toolCall: TurnToolCall;
  childTools: TurnToolCall[];
  childMessages: AttributedMessage[];
  childReasoning: AttributedMessage[];
}

/**
 * Collects subagent data across all turns, linking child tools/messages/reasoning
 * back to their parent subagent via parentToolCallId.
 *
 * Subagent output often spans multiple turns — a subagent launched in turn N
 * may have its child tool calls appear in turns N+1, N+2, etc.
 */
export function useCrossTurnSubagents(
  turns: Ref<ConversationTurn[]> | ComputedRef<ConversationTurn[]>,
) {
  const subagentMap = computed<Map<string, SubagentFullData>>(() => {
    const map = new Map<string, SubagentFullData>();
    const childToolsMap = new Map<string, TurnToolCall[]>();
    const childMsgsMap = new Map<string, AttributedMessage[]>();
    const childReasoningMap = new Map<string, AttributedMessage[]>();

    for (const turn of turns.value) {
      for (const tc of turn.toolCalls) {
        if (tc.parentToolCallId) {
          const arr = childToolsMap.get(tc.parentToolCallId);
          if (arr) arr.push(tc);
          else childToolsMap.set(tc.parentToolCallId, [tc]);
        }
      }

      for (const m of turn.assistantMessages) {
        if (m.parentToolCallId) {
          const arr = childMsgsMap.get(m.parentToolCallId);
          if (arr) arr.push(m);
          else childMsgsMap.set(m.parentToolCallId, [m]);
        }
      }

      for (const r of turn.reasoningTexts ?? []) {
        if (r.parentToolCallId) {
          const arr = childReasoningMap.get(r.parentToolCallId);
          if (arr) arr.push(r);
          else childReasoningMap.set(r.parentToolCallId, [r]);
        }
      }
    }

    for (const turn of turns.value) {
      for (const tc of turn.toolCalls) {
        if (tc.isSubagent && tc.toolCallId) {
          map.set(tc.toolCallId, {
            agentId: tc.toolCallId,
            turnIndex: turn.turnIndex,
            toolCall: tc,
            childTools: childToolsMap.get(tc.toolCallId) ?? [],
            childMessages: childMsgsMap.get(tc.toolCallId) ?? [],
            childReasoning: childReasoningMap.get(tc.toolCallId) ?? [],
          });
        }
      }
    }

    return map;
  });

  /** Flat ordered list of all subagents across all turns. */
  const allSubagents = computed(() => Array.from(subagentMap.value.values()));

  return { subagentMap, allSubagents };
}
