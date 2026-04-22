import type { TurnToolCall } from "@tracepilot/types";
import { formatArgsSummary } from "@tracepilot/ui";
import { type ComputedRef, computed } from "vue";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";

export type ActivityPillType = "intent" | "memory" | "read_agent";

export type ActivityItem =
  | { kind: "reasoning"; index: number; sortKey: number; content: string; agentName?: string }
  | { kind: "tool"; index: number; sortKey: number; toolCall: TurnToolCall }
  | {
      kind: "pill";
      index: number;
      sortKey: number;
      type: ActivityPillType;
      label: string;
      toolCall: TurnToolCall;
    }
  | { kind: "message"; index: number; sortKey: number; content: string; agentName?: string }
  | { kind: "nested-subagent"; index: number; sortKey: number; toolCall: TurnToolCall };

const PILL_TOOLS = new Set(["report_intent", "store_memory", "read_agent"]);

/**
 * Builds the chronologically-sorted activity stream for a subagent panel
 * (reasoning, tool calls, pills, nested subagents, and trailing messages).
 *
 * Sort key policy (preserved from pre-decomposition behavior):
 * - Reasoning items use a negative-offset `-1000 + idx` so they render first
 *   within a turn (no stable eventIndex is available for reasoning blocks).
 * - Tool calls sort by their `eventIndex` (falling back to insertion index).
 * - Agent messages use `Infinity` so final responses always render last.
 */
export function useSubagentActivities(subagent: ComputedRef<SubagentFullData | null>) {
  return computed<ActivityItem[]>(() => {
    const sa = subagent.value;
    if (!sa) return [];
    const items: ActivityItem[] = [];
    let idx = 0;

    for (const r of sa.childReasoning) {
      items.push({
        kind: "reasoning",
        index: idx++,
        sortKey: -1000 + idx,
        content: r.content,
        agentName: r.agentDisplayName,
      });
    }

    for (const tc of sa.childTools) {
      const sortKey = tc.eventIndex ?? idx;
      if (tc.isSubagent) {
        items.push({ kind: "nested-subagent", index: idx++, sortKey, toolCall: tc });
      } else if (PILL_TOOLS.has(tc.toolName)) {
        const pillType: ActivityPillType =
          tc.toolName === "report_intent"
            ? "intent"
            : tc.toolName === "store_memory"
              ? "memory"
              : "read_agent";
        const label =
          tc.toolName === "report_intent"
            ? formatArgsSummary(tc.arguments, tc.toolName) || "Intent update"
            : tc.toolName === "store_memory"
              ? formatArgsSummary(tc.arguments, tc.toolName) || "Stored memory"
              : formatArgsSummary(tc.arguments, tc.toolName) || "Read agent";
        items.push({ kind: "pill", index: idx++, sortKey, type: pillType, label, toolCall: tc });
      } else {
        items.push({ kind: "tool", index: idx++, sortKey, toolCall: tc });
      }
    }

    for (const m of sa.childMessages) {
      items.push({
        kind: "message",
        index: idx++,
        sortKey: Infinity,
        content: m.content,
        agentName: m.agentDisplayName,
      });
    }

    // Sort by eventIndex-based key for chronological ordering
    items.sort((a, b) => a.sortKey - b.sortKey);

    return items;
  });
}
