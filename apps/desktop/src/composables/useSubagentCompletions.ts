import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { getToolArgs } from "@tracepilot/types";
import { getAgentColor, inferAgentTypeFromToolCall } from "@tracepilot/ui";
import { type ComputedRef, computed } from "vue";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";

/**
 * Parse the agent identifier from a `read_agent` tool call, trying common
 * argument names. Returns `null` if no usable identifier is found.
 *
 * Bridge: read_agent uses agent_name (e.g. "explore-rust-backend") while
 * subagentMap is keyed by toolCallId (e.g. "tooluse_QVH..."). The launch
 * tool call's arguments.name provides the bridge.
 */
export function parseAgentNameFromReadAgent(tc: TurnToolCall): string | null {
  try {
    const args = typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : getToolArgs(tc);
    const candidates = [args?.agent_id, args?.agent_name, args?.name];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Derives per-turn subagent completion pills + border colors for the chat
 * view.
 *
 * - `completionsByTurn`: `turnIndex` → subagent toolCallIds whose LAST
 *   `read_agent` appears in that turn (one pill per subagent, positioned at
 *   the final read).
 * - `subagentTurnColors`: `turnIndex` → agent color for turns that contain
 *   subagent-owned content (launches or child tool calls).
 */
export function useSubagentCompletions(
  turns: ComputedRef<ConversationTurn[]>,
  subagentMap: ComputedRef<Map<string, SubagentFullData>>,
  allSubagents: ComputedRef<SubagentFullData[]>,
  toolCallTurnIndex: ComputedRef<Map<string, number>>,
) {
  /** Reverse map: possible read_agent identifiers → subagentMap toolCallId */
  const agentNameToToolCallId = computed(() => {
    const map = new Map<string, string>();
    for (const [toolCallId, sa] of subagentMap.value) {
      const args = getToolArgs(sa.toolCall);
      const identifiers = [args.name, args.agent_id, args.agent_name, sa.toolCall.toolCallId];
      for (const identifier of identifiers) {
        if (typeof identifier === "string" && identifier.trim().length > 0) {
          map.set(identifier, toolCallId);
        }
      }
    }
    return map;
  });

  const completionsByTurn = computed(() => {
    const lastReadByAgent = new Map<string, number>(); // toolCallId → turnIndex

    for (const turn of turns.value) {
      for (const tc of turn.toolCalls) {
        if (tc.toolName === "read_agent" && !tc.parentToolCallId) {
          const agentName = parseAgentNameFromReadAgent(tc);
          if (agentName) {
            const toolCallId = agentNameToToolCallId.value.get(agentName);
            if (toolCallId) {
              lastReadByAgent.set(toolCallId, turn.turnIndex);
            }
          }
        }
      }
    }

    const byTurn = new Map<number, string[]>();
    for (const [toolCallId, turnIdx] of lastReadByAgent) {
      const sa = subagentMap.value.get(toolCallId);
      if (sa?.toolCall.isComplete) {
        const list = byTurn.get(turnIdx) ?? [];
        list.push(toolCallId);
        byTurn.set(turnIdx, list);
      }
    }
    return byTurn;
  });

  function completionLabel(toolCallId: string): string {
    const sa = subagentMap.value.get(toolCallId);
    if (sa) {
      const agentType = inferAgentTypeFromToolCall(sa.toolCall);
      const label = agentType.charAt(0).toUpperCase() + agentType.slice(1);
      return `${label} agent ${sa.toolCall.success === false ? "failed" : "completed"}`;
    }
    return "Agent completed";
  }

  /** Map turnIndex → agent color for turns that have subagent-owned content */
  const subagentTurnColors = computed(() => {
    const map = new Map<number, string>();
    for (const sa of allSubagents.value) {
      const color = getAgentColor(inferAgentTypeFromToolCall(sa.toolCall));
      map.set(sa.turnIndex, color);
      for (const ct of sa.childTools) {
        if (ct.toolCallId) {
          const turnIdx = toolCallTurnIndex.value.get(ct.toolCallId);
          if (turnIdx != null) map.set(turnIdx, color);
        }
      }
    }
    return map;
  });

  return {
    agentNameToToolCallId,
    completionsByTurn,
    completionLabel,
    subagentTurnColors,
  };
}
