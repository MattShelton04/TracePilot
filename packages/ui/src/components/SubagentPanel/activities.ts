// Pure activity-stream builder for a subagent. Accepts a structural input
// (not `SubagentFullData`) so both the conversation and agent-tree adapters can
// produce activity items without synthesizing fake AttributedMessage objects.

import type { TurnToolCall } from "@tracepilot/types";
import { formatArgsSummary } from "../../utils/toolCall";
import type { SubagentActivityItem, SubagentActivityPillType } from "./types";

const PILL_TOOLS = new Set(["report_intent", "store_memory", "read_agent"]);

export interface SubagentActivityInput {
  parentId: string;
  childTools: TurnToolCall[];
  childReasoning: { content: string; agentDisplayName?: string; eventIndex?: number }[];
}

/**
 * Builds an activity stream interleaving reasoning blocks with tool calls,
 * sorted by event index when available. Final assistant messages are NOT
 * included here — hosts render them in a separate "Output" section.
 *
 * Sort key strategy:
 *  - Items with `eventIndex` use that as their primary sort key (chronological).
 *  - Items missing `eventIndex` fall back to a positional zip (reasoning[i] just
 *    before tool[i]) so older sessions still produce sensible output.
 */
export function buildSubagentActivities(input: SubagentActivityInput): SubagentActivityItem[] {
  const items: SubagentActivityItem[] = [];

  const reasoningHasIndex = input.childReasoning.some((r) => typeof r.eventIndex === "number");
  const toolsHaveIndex = input.childTools.some((t) => typeof t.eventIndex === "number");
  const useEventIndex = reasoningHasIndex && toolsHaveIndex;

  // Stable ordinal counter to preserve original order when event indices collide.
  let ordinal = 0;
  const nextOrdinal = () => ordinal++;

  if (useEventIndex) {
    for (let i = 0; i < input.childReasoning.length; i++) {
      const r = input.childReasoning[i];
      const sortKey = (r.eventIndex ?? Number.MAX_SAFE_INTEGER) + nextOrdinal() * 1e-6;
      items.push({
        kind: "reasoning",
        key: `reasoning:${input.parentId}:${i}`,
        sortKey,
        content: r.content,
        agentName: r.agentDisplayName,
      });
    }

    for (let i = 0; i < input.childTools.length; i++) {
      const tc = input.childTools[i];
      const idKey = tc.toolCallId ?? `t:${input.parentId}:${i}`;
      const sortKey = (tc.eventIndex ?? Number.MAX_SAFE_INTEGER) + nextOrdinal() * 1e-6;
      pushToolActivity(items, tc, idKey, sortKey);
    }
  } else {
    // Positional zip fallback for sessions without event indices.
    const maxPaired = Math.max(input.childReasoning.length, input.childTools.length);
    for (let i = 0; i < maxPaired; i++) {
      const r = input.childReasoning[i];
      if (r) {
        items.push({
          kind: "reasoning",
          key: `reasoning:${input.parentId}:${i}`,
          sortKey: i,
          content: r.content,
          agentName: r.agentDisplayName,
        });
      }
      const tc = input.childTools[i];
      if (tc) {
        const idKey = tc.toolCallId ?? `t:${input.parentId}:${i}`;
        pushToolActivity(items, tc, idKey, i + 0.5);
      }
    }
  }

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items;
}

function pushToolActivity(
  items: SubagentActivityItem[],
  tc: TurnToolCall,
  idKey: string,
  sortKey: number,
): void {
  if (tc.isSubagent) {
    items.push({ kind: "nested-subagent", key: `nested:${idKey}`, sortKey, toolCall: tc });
    return;
  }
  if (PILL_TOOLS.has(tc.toolName)) {
    const pillType: SubagentActivityPillType =
      tc.toolName === "report_intent"
        ? "intent"
        : tc.toolName === "store_memory"
          ? "memory"
          : "read_agent";
    const label = formatArgsSummary(tc.arguments, tc.toolName) || tc.toolName;
    items.push({
      kind: "pill",
      key: `pill:${idKey}`,
      sortKey,
      type: pillType,
      label,
      toolCall: tc,
    });
    return;
  }
  items.push({ kind: "tool", key: `tool:${idKey}`, sortKey, toolCall: tc });
}
